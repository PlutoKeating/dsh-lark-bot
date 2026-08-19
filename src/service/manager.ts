import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { AppPaths } from '../config/app-paths.js';
import { resolveAppPaths } from '../config/app-paths.js';
import { discoverDshBin, resolveDshHome } from '../config/dsh-runtime.js';
import { DshProviderManager } from '../config/dsh-config.js';
import { resolveGuardianCliEntry } from '../guardian/install.js';
import { writeFileAtomic } from '../platform/atomic-write.js';
import { resolveCliJsPath, serviceNameFor, launchdLabelFor } from './command.js';
import { secureWindowsServiceEnv, snapshotServiceEnv, writeServiceEnv } from './env-snapshot.js';
import { isSystemdUserAvailable, SystemdServiceController } from './linux-systemd.js';
import { LaunchdServiceController } from './macos-launchd.js';
import { PortableServiceController } from './portable.js';
import { WindowsTaskServiceController } from './windows-task.js';
import type {
  ServiceController,
  ServicePlatform,
  ServiceSpec,
  ServiceStatus,
} from './types.js';
import { findProfileProcess, type ProfileProcess } from '../guardian/process.js';

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface ServiceMetadata {
  schemaVersion: 2;
  serviceName: string;
  profile: string;
  platform: ServicePlatform;
  version: string;
  installedAt: string;
  dshBin: string;
}

export interface ServiceIntent {
  schemaVersion: 1;
  desiredState: 'running' | 'stopped';
  updatedAt: string;
}

export interface ManagedRestartDecision {
  installed: boolean;
  suppressed: boolean;
  status?: ServiceStatus;
}

export interface ServiceManagerDeps {
  profile?: string;
  env?: NodeJS.ProcessEnv;
  paths?: AppPaths;
  version?: string;
  controller?: ServiceController;
  dshBin?: string;
  home?: string;
  providerManager?: Pick<DshProviderManager, 'listProviders'>;
  findProcess?: (profile: string) => Promise<ProfileProcess | undefined>;
}

/**
 * Owns the OS service lifecycle for the canonical runtime command
 * `dsh --profile <name>`. It never boots a second bridge implementation.
 */
export class ServiceManager {
  private readonly profile: string;
  private readonly sourceEnv: NodeJS.ProcessEnv;
  private readonly paths: AppPaths;
  private readonly version: string;
  private readonly controllerOverride: ServiceController | undefined;
  private readonly dshBinOverride: string | undefined;
  private readonly home: string;
  private readonly providerManager: Pick<DshProviderManager, 'listProviders'>;
  private readonly findProcess: (profile: string) => Promise<ProfileProcess | undefined>;

  constructor(deps: ServiceManagerDeps = {}) {
    this.profile = deps.profile ?? 'dsh-lark';
    this.sourceEnv = deps.env ?? process.env;
    this.paths = deps.paths ?? resolveAppPaths();
    this.version = deps.version ?? '0.0.0';
    this.controllerOverride = deps.controller;
    this.dshBinOverride = deps.dshBin;
    this.home = deps.home ?? homedir();
    this.providerManager = deps.providerManager ?? new DshProviderManager({
      home: this.home,
      env: this.sourceEnv,
    });
    this.findProcess = deps.findProcess ?? (
      deps.controller ? async () => undefined : findProfileProcess
    );
  }

  private metadataFile(): string {
    return this.paths.serviceMetadataFile(this.profile);
  }

  async readIntent(): Promise<ServiceIntent | undefined> {
    try {
      const parsed = JSON.parse(
        await readFile(this.paths.serviceIntentFile(this.profile), 'utf8'),
      ) as Partial<ServiceIntent>;
      if (parsed.schemaVersion !== 1 || !['running', 'stopped'].includes(parsed.desiredState ?? '')) {
        return undefined;
      }
      return parsed as ServiceIntent;
    } catch {
      return undefined;
    }
  }

  private async saveIntent(desiredState: ServiceIntent['desiredState']): Promise<void> {
    await writeFileAtomic(
      this.paths.serviceIntentFile(this.profile),
      `${JSON.stringify({ schemaVersion: 1, desiredState, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      { mode: 0o600 },
    );
  }

  private async withLifecycleLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockDir = this.paths.serviceLockDir(this.profile);
    await mkdir(dirname(lockDir), { recursive: true });
    try {
      await mkdir(lockDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let ownerPid: number | undefined;
      try {
        const owner = JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8')) as { pid?: unknown };
        if (typeof owner.pid === 'number') ownerPid = owner.pid;
      } catch {
        // A newly created lock may not have written its owner file yet: fail
        // closed rather than stealing an active lifecycle operation.
      }
      if (ownerPid === undefined || isPidAlive(ownerPid)) {
        throw new Error('另一个后台服务生命周期操作正在执行，请稍后重试。');
      }
      const staleDir = `${lockDir}.stale-${process.pid}-${Date.now()}`;
      try {
        await rename(lockDir, staleDir);
        await mkdir(lockDir);
        await rm(staleDir, { recursive: true, force: true });
      } catch {
        throw new Error('另一个后台服务生命周期操作正在执行，请稍后重试。');
      }
    }
    try {
      await writeFileAtomic(
        join(lockDir, 'owner.json'),
        `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
        { mode: 0o600 },
      );
      return await operation();
    } finally {
      await rm(lockDir, { recursive: true, force: true });
    }
  }

  private async rejectUnmanagedDuplicate(
    controller: ServiceController,
    spec: ServiceSpec,
  ): Promise<void> {
    const serviceStatus = await controller.status(spec);
    if (serviceStatus.state === 'running') return;
    const process = await this.findProcess(this.profile);
    if (process) {
      throw new Error(
        `检测到未受管的 dsh --profile ${this.profile}（pid ${process.pid}）。请先在原终端停止它，再重试。`,
      );
    }
  }

  private async buildSpec(requireProfile = false): Promise<ServiceSpec> {
    const previous = await this.readMetadata();
    const dshBin =
      this.dshBinOverride ??
      discoverDshBin(this.home, this.sourceEnv) ??
      previous?.dshBin;
    if (!dshBin) {
      if (requireProfile) {
        throw new Error('未找到 dsh CLI，无法启动后台服务。请先安装 @deepseek-ai/dsh。');
      }
    }
    if (requireProfile && !this.controllerOverride) {
      const profilePackage = join(
        resolveDshHome(this.home, this.sourceEnv),
        'profiles',
        this.profile,
        'package.json',
      );
      try {
        if (!(await stat(profilePackage)).isFile()) throw new Error('not a file');
      } catch {
        throw new Error(
          `dsh profile \`${this.profile}\` 尚未安装；请先运行 dsh-lark-bot setup --profile ${this.profile}。`,
        );
      }
    }
    let credentialKeys: string[] = [];
    try {
      credentialKeys = (await this.providerManager.listProviders())
        .map((provider) => provider.credentialRef)
        .filter((value): value is string => Boolean(value));
    } catch {
      // A malformed dsh settings file is reported by doctor; service install
      // can still proceed with the standard environment keys.
    }
    const serviceName = serviceNameFor(this.profile);
    const cliJsPath = this.controllerOverride
      ? resolveCliJsPath()
      : resolveGuardianCliEntry(this.profile, this.home, this.sourceEnv);
    return {
      serviceName,
      label: launchdLabelFor(this.profile),
      profile: this.profile,
      nodePath: process.execPath,
      cliJsPath,
      dshBin: dshBin ?? '',
      commandPath: process.execPath,
      commandArgs: [
        cliJsPath,
        'service-run',
        '--profile',
        this.profile,
        '--env-file',
        this.paths.serviceEnvFile(this.profile),
      ],
      envFile: this.paths.serviceEnvFile(this.profile),
      logFile: this.paths.serviceLogFile(this.profile),
      env: snapshotServiceEnv(this.sourceEnv, credentialKeys),
    };
  }

  async resolveController(): Promise<ServiceController> {
    if (this.controllerOverride) return this.controllerOverride;
    const metadata = await this.readMetadata();
    const platform = metadata?.platform;
    if (platform === 'darwin-launchd' || (!platform && process.platform === 'darwin')) {
      return new LaunchdServiceController();
    }
    if (platform === 'win32-task' || (!platform && process.platform === 'win32')) {
      return new WindowsTaskServiceController({ scriptDir: this.paths.serviceDir });
    }
    if (platform === 'linux-systemd') return new SystemdServiceController();
    if (platform === 'linux-portable') {
      return new PortableServiceController({ serviceDir: this.paths.serviceDir });
    }
    const systemd = new SystemdServiceController();
    if (await isSystemdUserAvailable()) return systemd;
    return new PortableServiceController({ serviceDir: this.paths.serviceDir });
  }

  private async saveMetadata(platform: ServicePlatform, spec: ServiceSpec): Promise<void> {
    const metadata: ServiceMetadata = {
      schemaVersion: 2,
      serviceName: spec.serviceName,
      profile: this.profile,
      platform,
      version: this.version,
      installedAt: new Date().toISOString(),
      dshBin: spec.dshBin,
    };
    await writeFileAtomic(this.metadataFile(), `${JSON.stringify(metadata, null, 2)}\n`, {
      mode: 0o600,
    });
  }

  async readMetadata(): Promise<ServiceMetadata | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.metadataFile(), 'utf8')) as Partial<ServiceMetadata>;
      if (parsed.schemaVersion !== 2 || typeof parsed.profile !== 'string') return undefined;
      return parsed as ServiceMetadata;
    } catch {
      return undefined;
    }
  }

  private async prepareFiles(spec: ServiceSpec, platform: ServicePlatform): Promise<void> {
    await mkdir(dirname(spec.logFile), { recursive: true });
    await mkdir(dirname(spec.envFile), { recursive: true });
    await writeServiceEnv(spec.envFile, spec.env);
    if (platform === 'win32-task') {
      try {
        await secureWindowsServiceEnv(spec.envFile);
      } catch (error) {
        await rm(spec.envFile, { force: true });
        throw error;
      }
    }
  }

  async install(): Promise<ServiceStatus> {
    return this.withLifecycleLock(async () => {
      const controller = await this.resolveController();
      const spec = await this.buildSpec(true);
      await this.rejectUnmanagedDuplicate(controller, spec);
      await this.prepareFiles(spec, controller.platform);
      await controller.installAndStart(spec);
      await this.saveMetadata(controller.platform, spec);
      await this.saveIntent('running');
      return controller.status(spec);
    });
  }

  async start(): Promise<ServiceStatus> {
    return this.withLifecycleLock(async () => {
      const controller = await this.resolveController();
      const spec = await this.buildSpec(true);
      const before = await controller.status(spec);
      if (!before.installed) throw new Error('后台服务尚未安装，请先运行 service install。');
      await this.rejectUnmanagedDuplicate(controller, spec);
      await this.prepareFiles(spec, controller.platform);
      await controller.start(spec);
      await this.saveIntent('running');
      return controller.status(spec);
    });
  }

  async stop(): Promise<ServiceStatus> {
    return this.withLifecycleLock(async () => {
      const controller = await this.resolveController();
      const spec = await this.buildSpec();
      await this.saveIntent('stopped');
      await controller.stop(spec);
      return controller.status(spec);
    });
  }

  private async restartUnlocked(): Promise<ServiceStatus> {
    const controller = await this.resolveController();
    const spec = await this.buildSpec(true);
    const before = await controller.status(spec);
    if (!before.installed) throw new Error('后台服务尚未安装，请先运行 service install。');
    await this.rejectUnmanagedDuplicate(controller, spec);
    await this.prepareFiles(spec, controller.platform);
    await controller.restart(spec);
    await this.saveMetadata(controller.platform, spec);
    await this.saveIntent('running');
    return controller.status(spec);
  }

  async restart(): Promise<ServiceStatus> {
    return this.withLifecycleLock(() => this.restartUnlocked());
  }

  /** Atomically check the operator intent and restart under the same profile lock. */
  async restartManaged(options: { respectIntent?: boolean } = {}): Promise<ManagedRestartDecision> {
    return this.withLifecycleLock(async () => {
      const metadata = await this.readMetadata();
      if (
        options.respectIntent !== false &&
        (await this.readIntent())?.desiredState === 'stopped'
      ) {
        return { installed: Boolean(metadata), suppressed: true };
      }
      if (!metadata) return { installed: false, suppressed: false };
      return {
        installed: true,
        suppressed: false,
        status: await this.restartUnlocked(),
      };
    });
  }

  async uninstall(): Promise<ServiceStatus> {
    return this.withLifecycleLock(async () => {
      const controller = await this.resolveController();
      const spec = await this.buildSpec();
      await this.saveIntent('stopped');
      await controller.uninstall(spec);
      await rm(this.metadataFile(), { force: true });
      await rm(spec.envFile, { force: true });
      return controller.status(spec);
    });
  }

  async status(): Promise<ServiceStatus> {
    const controller = await this.resolveController();
    return controller.status(await this.buildSpec());
  }

  async logs(lines = 100): Promise<{ path: string; text: string }> {
    const path = this.paths.serviceLogFile(this.profile);
    try {
      const content = await readFile(path, 'utf8');
      return { path, text: content.split(/\r?\n/).slice(-Math.max(1, lines)).join('\n') };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, text: '' };
      throw error;
    }
  }
}
