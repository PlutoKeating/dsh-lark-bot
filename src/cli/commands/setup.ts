import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { discoverDshBin, resolveDshHome } from '../../config/dsh-runtime.js';
import { ownPackageInfo } from '../../adapters/dsh/own-package.js';

export interface SetupOptions {
  /** dsh profile to install the bundle into (default `dsh-lark`). */
  profile?: string;
  /** Package spec for `dsh plugin add` (defaults to this package's npm name). */
  packageSpec?: string;
  /** DSH_HOME override (tests). */
  dshHome?: string;
  /** dsh CLI bin override (tests). */
  bin?: string;
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
  const packageSpec = options.packageSpec ?? process.env.DSH_LARK_SETUP_PACKAGE ?? own.name;
  const dshHome = options.dshHome ?? resolveDshHome(homedir(), process.env);
  const bin = options.bin ?? discoverDshBin(homedir(), process.env);
  if (!bin) {
    throw new Error(
      '未找到本机 dsh 安装（`@deepseek-ai/dsh`）。请先安装 DeepSeek Harness，再运行本命令。',
    );
  }

  // Pre-approve pnpm >= 10 build scripts so the first `dsh plugin add`
  // succeeds without a manual pnpm-workspace.yaml edit (protobufjs is a
  // transitive dependency of the Feishu channel SDK).
  const profileDir = join(dshHome, 'profiles', profile);
  await mkdir(profileDir, { recursive: true });
  await approveBuilds(profileDir);

  process.stdout.write(
    `正在把 ${packageSpec} 安装到 dsh profile \`${profile}\`（$DSH_HOME=${dshHome}）...\n`,
  );
  await runDshPlugin(bin, profile, packageSpec);

  process.stdout.write(
    [
      '',
      '✅ 安装完成。启动方式（唯一的部署路径）：',
      '',
      `  dsh --profile ${profile}`,
      '',
      '首次启动会在终端打印二维码，用飞书 / Lark 扫码完成一次性绑定；',
      '绑定后 dsh 即以标准插件方式加载 dsh-lark-bot 的桥接引擎。',
      '',
    ].join('\n'),
  );
}

function runDshPlugin(bin: string, profile: string, packageSpec: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'node',
      [bin, 'plugin', '--profile', profile, 'add', packageSpec],
      { stdio: 'inherit' },
    );
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`dsh plugin add exited with code ${String(code)}`));
    });
  });
}

async function approveBuilds(profileDir: string): Promise<void> {
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
