import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { discoverDshBin, resolveDshHome } from '../../config/dsh-runtime.js';
import { ownPackageInfo } from '../../adapters/dsh/own-package.js';
import { loadRuntimeEnv } from '../../config/env.js';
import { installGuardian } from '../../guardian/install.js';

export interface SetupOptions {
  /** dsh profile to install the bundle into (default `dsh-lark`). */
  profile?: string;
  /** Package spec for `dsh plugin add` (defaults to this package's npm name). */
  packageSpec?: string;
  /** DSH_HOME override (tests). */
  dshHome?: string;
  /** dsh CLI bin override (tests). */
  bin?: string;
  /**
   * Install the safety-net guardian as a system service. Defaults to true:
   * the guardian is a core, always-installed feature; pass `false` to opt out.
   */
  guardian?: boolean;
  /** Injectable guardian installer (tests). */
  installGuardianFn?: typeof installGuardian;
}

/**
 * The single install-deploy path: installs this package as a standard dsh
 * profile bundle into `<name>`, pre-approving pnpm's build-script policy so
 * `dsh plugin add` succeeds out of the box. First boot of the profile prints
 * the QR code for one-time Feishu binding.
 */
export async function runSetup(options: SetupOptions = {}): Promise<void> {
  const profile = options.profile ?? 'dsh-lark';
  const own = ownPackageInfo();
  // Pin the running package's exact version. Registry installs MUST NOT rely
  // on pnpm's bare-name `latest` resolution: on some environments it resolves
  // an arbitrarily old published version (observed: dsh-lark-bot -> 0.5.1 even
  // though latest is 0.9.x), which is not even a dsh bundle and silently
  // breaks the profile. An explicit name@version is deterministic.
  const packageSpec =
    options.packageSpec ??
    process.env.DSH_LARK_SETUP_PACKAGE ??
    (own.version ? `${own.name}@${own.version}` : own.name);
  const dshHome = options.dshHome ?? resolveDshHome(homedir(), process.env);
  const bin = options.bin ?? discoverDshBin(homedir(), process.env);
  if (!bin) {
    throw new Error(
      '未找到本机 dsh 安装（`@deepseek-ai/dsh`）。请先安装 DeepSeek Harness，再运行本命令。',
    );
  }
  const installGuardianService = options.guardian !== false;

  // Pre-approve pnpm >= 10 build scripts so the first `dsh plugin add`
  // succeeds without a manual pnpm-workspace.yaml edit (protobufjs is a
  // transitive dependency of the Feishu channel SDK).
  const profileDir = join(dshHome, 'profiles', profile);
  await mkdir(profileDir, { recursive: true });
  await approveBuilds(profileDir);

  process.stdout.write(
    `正在把 ${packageSpec} 安装到 dsh profile \`${profile}\`（$DSH_HOME=${dshHome}）...\n`,
  );
  await runDshPlugin(bin, profile, packageSpec, { ...process.env, DSH_HOME: dshHome });

  if (installGuardianService) {
    const install = options.installGuardianFn ?? installGuardian;
    const guardianResult = await install({
      env: loadRuntimeEnv(process.env),
      dshProfile: profile,
    });
    for (const message of guardianResult.messages) {
      process.stdout.write(`${message}\n`);
    }
    if (!guardianResult.ok) {
      process.stdout.write(
        '\n注意：guardian 服务未完全启用，请按上方提示手动执行；也可稍后重跑 `dsh-lark-bot guardian install`。\n',
      );
    }
  }

  process.stdout.write(
    [
      '',
      '✅ 安装完成。启动方式（唯一的部署路径）：',
      '',
      `  ${options.dshHome ? `DSH_HOME=${JSON.stringify(dshHome)} ` : ''}dsh --profile ${profile}`,
      '',
      '首次启动会在终端打印二维码，用飞书 / Lark 扫码完成一次性绑定；',
      '绑定后 dsh 即以标准插件方式加载 dsh-lark-bot 的桥接引擎。',
      ...(installGuardianService
        ? [
            '',
            '安全网守护已默认安装：dsh 全部下线后仍可通过飞书发送 /safemode 进入仅核心安全模式自救。',
            '查看状态：dsh-lark-bot guardian status',
            '不需要时可跳过安装：npx dsh-lark-bot@latest setup --no-guardian',
          ]
        : [
            '',
            '提示：本次未安装安全网守护（--no-guardian）。需要时随时执行 dsh-lark-bot guardian install。',
          ]),
      '',
    ].join('\n'),
  );
}

export function runDshPlugin(
  bin: string,
  profile: string,
  packageSpec: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'node',
      [bin, 'plugin', '--profile', profile, 'add', packageSpec],
      { stdio: 'inherit', env },
    );
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`dsh plugin add exited with code ${String(code)}`));
    });
  });
}

export async function approveBuilds(profileDir: string): Promise<void> {
  await preserveInstalledPnpmVersion(profileDir);
  const workspaceFile = join(profileDir, 'pnpm-workspace.yaml');
  let existing = '';
  try {
    existing = await readFile(workspaceFile, 'utf8');
  } catch {
    // No workspace file yet; create one.
  }
  const allowBuilds = [
    'protobufjs: true',
    ...(ownPackageInfo().name.startsWith('@') ? [] : [`${ownPackageInfo().name}: true`]),
  ].join('\n');
  if (!existing.includes('allowBuilds')) {
    existing = existing.trimEnd() ? `${existing.trimEnd()}\n\nallowBuilds:\n  ${allowBuilds}\n` : `allowBuilds:\n  ${allowBuilds}\n`;
  } else if (!existing.includes('protobufjs: true')) {
    existing = existing.replace(/(allowBuilds:\s*\n)/, `$1  ${allowBuilds}\n`);
  }
  await writeFile(workspaceFile, existing, 'utf8');
}

/**
 * Keep Corepack on the pnpm release that created this profile's node_modules.
 *
 * dsh invokes bare `pnpm` with the profile as cwd. Generated profiles do not
 * normally declare `packageManager`, so a source-managed dsh installation can
 * make Corepack select a different major and fail with
 * ERR_PNPM_UNEXPECTED_STORE. pnpm records the exact creator release in
 * node_modules/.modules.yaml; copy that value into an existing profile
 * manifest before dsh runs. Do not create a manifest for a fresh profile,
 * because dsh still owns first-time profile initialization.
 */
export async function preserveInstalledPnpmVersion(profileDir: string): Promise<void> {
  const packageFile = join(profileDir, 'package.json');
  const modulesFile = join(profileDir, 'node_modules', '.modules.yaml');
  let packageText: string;
  let modulesText: string;
  try {
    [packageText, modulesText] = await Promise.all([
      readFile(packageFile, 'utf8'),
      readFile(modulesFile, 'utf8'),
    ]);
  } catch {
    return;
  }

  try {
    const profilePackage = JSON.parse(packageText) as Record<string, unknown>;
    const modules = parse(modulesText) as { packageManager?: unknown } | null;
    const packageManager = modules?.packageManager;
    if (
      typeof packageManager !== 'string' ||
      !/^pnpm@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(packageManager) ||
      profilePackage.packageManager === packageManager
    ) {
      return;
    }
    profilePackage.packageManager = packageManager;
    await writeFile(packageFile, `${JSON.stringify(profilePackage, null, 2)}\n`, 'utf8');
  } catch {
    // Invalid or partial install metadata must not prevent dsh's own recovery.
  }
}
