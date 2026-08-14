import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AppPaths } from '../config/app-paths.js';
import { resolveAppPaths } from '../config/app-paths.js';
import { writeFileAtomic } from '../platform/atomic-write.js';
import { resolveCliJsPath, serviceNameFor, launchdLabelFor } from './command.js';
import { snapshotServiceEnv, writeServiceEnv } from './env-snapshot.js';
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

export interface ServiceMetadata {
  schemaVersion: 1;
  serviceName: string;
  profile: string;
  platform: ServicePlatform;
  version: string;
  installedAt: string;
}

export interface ServiceManagerDeps {
  profile?: string;
  env?: NodeJS.ProcessEnv;
  paths?: AppPaths;
  version?: string;
  controller?: ServiceController;
}

export class ServiceManager {
  private readonly profile: string;
  private readonly sourceEnv: NodeJS.ProcessEnv;
  private readonly paths: AppPaths;
  private readonly version: string;
  private readonly controllerOverride: ServiceController | undefined;

  constructor(deps: ServiceManagerDeps = {}) {
    this.profile = deps.profile ?? 'default';
    this.sourceEnv = deps.env ?? process.env;
    this.paths = deps.paths ?? resolveAppPaths();
    this.version = deps.version ?? '0.0.0';
    this.controllerOverride = deps.controller;
  }

  private buildSpec(): ServiceSpec {
    const serviceName = serviceNameFor(this.profile);
    return {
      serviceName,
      label: launchdLabelFor(this.profile),
      profile: this.profile,
      nodePath: process.execPath,
      cliJsPath: resolveCliJsPath(),
      envFile: this.paths.serviceEnvFile,
      logFile: this.paths.serviceLogFile(this.profile),
      env: snapshotServiceEnv(this.sourceEnv),
    };
  }

  async resolveController(): Promise<ServiceController> {
    if (this.controllerOverride) return this.controllerOverride;
    if (process.platform === 'darwin') return new LaunchdServiceController();
    if (process.platform === 'win32') return new WindowsTaskServiceController({
      scriptDir: this.paths.serviceDir,
    });
    const systemd = new SystemdServiceController();
    if (await isSystemdUserAvailable()) return systemd;
    return new PortableServiceController({ serviceDir: this.paths.serviceDir });
  }

  private async saveMetadata(platform: ServicePlatform): Promise<void> {
    const metadata: ServiceMetadata = {
      schemaVersion: 1,
      serviceName: this.buildSpec().serviceName,
      profile: this.profile,
      platform,
      version: this.version,
      installedAt: new Date().toISOString(),
    };
    await writeFileAtomic(this.paths.serviceMetadataFile, `${JSON.stringify(metadata, null, 2)}\n`);
  }

  async readMetadata(): Promise<ServiceMetadata | undefined> {
    try {
      return JSON.parse(await readFile(this.paths.serviceMetadataFile, 'utf8')) as ServiceMetadata;
    } catch {
      return undefined;
    }
  }

  private async prepareFiles(spec: ServiceSpec): Promise<void> {
    await mkdir(dirname(spec.logFile), { recursive: true });
    await mkdir(dirname(spec.envFile), { recursive: true });
    await writeServiceEnv(spec.envFile, spec.env);
  }

  async start(): Promise<ServiceStatus> {
    const controller = await this.resolveController();
    const spec = this.buildSpec();
    await this.prepareFiles(spec);
    await controller.installAndStart(spec);
    await this.saveMetadata(controller.platform);
    return controller.status(spec);
  }

  async stop(): Promise<ServiceStatus> {
    const controller = await this.resolveController();
    const spec = this.buildSpec();
    await controller.stop(spec);
    return controller.status(spec);
  }

  async restart(): Promise<ServiceStatus> {
    const controller = await this.resolveController();
    const spec = this.buildSpec();
    const before = await controller.status(spec);
    if (!before.installed) {
      throw new Error('后台服务尚未安装，请先运行 dsh-lark-bot start');
    }
    await this.prepareFiles(spec);
    await controller.restart(spec);
    await this.saveMetadata(controller.platform);
    return controller.status(spec);
  }

  async status(): Promise<ServiceStatus> {
    const controller = await this.resolveController();
    const spec = this.buildSpec();
    return controller.status(spec);
  }
}
