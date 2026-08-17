import { spawn } from 'cross-spawn';
import { existsSync, realpathSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DSH_COMPATIBILITY } from '../../config/dsh-compat.js';
import { discoverDshBin, resolveDshHome } from '../../config/dsh-runtime.js';
import type { OwnPackageInfo } from './own-package.js';
import { ownPackageInfo } from './own-package.js';

export const ACP_PACKAGE = '@deepseek-ai/dsh-acp';
export const ACP_VERSION = DSH_COMPATIBILITY.acp;
export const ACP_BASE_BUNDLE = '@deepseek-ai/dsh-base';
export const DEFAULT_ACP_PROFILE = 'dsh-lark-acp';

export interface AcpRuntimeOptions {
  home: string;
  env?: NodeJS.ProcessEnv;
  command?: string;
  args?: string[];
  bin?: string;
  profile?: string;
  provider?: string;
  model?: string;
  install?: (profileRoot: string) => Promise<void>;
}

export interface AcpLaunchSpec {
  command: string;
  args: string[];
  profile: string;
}

export interface AcpProfileEnsureResult {
  ok: boolean;
  created: boolean;
  error?: string;
}

export function acpProfileRoot(home: string, profile: string, env?: NodeJS.ProcessEnv): string {
  return join(resolveDshHome(home, env), 'profiles', profile);
}

function packageJsonFor(profile: string): string {
  const own = ownPackageInfo();
  return `${JSON.stringify(
    {
      name: `dsh-profile-${profile}`,
      private: true,
      dependencies: {
        [ACP_PACKAGE]: ACP_VERSION,
        [own.name]: `link:${own.root}`,
      },
      dsh: {
        profile: {
          bundles: [ACP_BASE_BUNDLE],
        },
      },
    },
    null,
    2,
  )}\n`;
}

export function acpPatchYaml(provider: string, model: string): string {
  const own = ownPackageInfo();
  return [
    '# dsh-lark ACP JSON-RPC runtime overlay (managed by dsh-lark-bot).',
    '# stdout is reserved for ACP JSON-RPC frames; no console logger may load.',
    '- insert:',
    '    - id: acp',
    `      name: '${ACP_PACKAGE}'`,
    '      config:',
    `        provider: ${provider}`,
    `        model: ${model}`,
    '',
    '# Unattended IM runtime: interactive user questions cannot be answered',
    '# through Feishu, so the tool is disabled (default-deny).',
    '- id: user-questions',
    '  disabled: true',
    '',
    '- id: system-prompt',
    '  config:',
    '    persona: >-',
    '      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.',
    '',
    '- id: hmr',
    '  disabled: true',
    '',
    // In-process bridge callback tool (same contract as the SDK runtime).
    '- insert:',
    '    - id: lark-notify',
    `      name: '${own.name}/notify'`,
    '      config:',
    '        endpoint: !!js process.env.DSH_LARK_NOTIFY_URL',
    '        token: !!js process.env.DSH_LARK_NOTIFY_TOKEN',
    '',
    // Question-card tool (same contract as the SDK runtime).
    '- insert:',
    '    - id: lark-ask',
    `      name: '${own.name}/ask'`,
    '      config:',
    '        endpoint: !!js process.env.DSH_LARK_ASK_URL',
    '        token: !!js process.env.DSH_LARK_NOTIFY_TOKEN',
    '',
  ].join('\n');
}

function acpPluginInstalled(profileRoot: string): boolean {
  const candidates = [
    join(profileRoot, 'node_modules', ACP_PACKAGE),
    join(profileRoot, '..', 'node_modules', ACP_PACKAGE),
  ];
  return candidates.some((path) => existsSync(path));
}

export function isAcpProfileReady(profileRoot: string): boolean {
  const own = ownPackageInfo();
  return (
    existsSync(join(profileRoot, 'package.json')) &&
    existsSync(join(profileRoot, 'cordis.yml')) &&
    existsSync(join(profileRoot, 'cordis.patch.yml')) &&
    acpPluginInstalled(profileRoot) &&
    ownPackageLinked(profileRoot, own)
  );
}

/**
 * True when the profile's node_modules link resolves to THIS package root.
 * A stale link to an older published copy passes the name/patch checks but
 * would boot a broken entry set (e.g. the missing `ask` artifact of v0.9.0),
 * so the resolved real path must equal the running package root.
 */
function ownPackageLinked(profileRoot: string, own: OwnPackageInfo): boolean {
  const linkPath = join(profileRoot, 'node_modules', own.name);
  try {
    const real = realpathSync(linkPath);
    const pkg = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8')) as {
      name?: unknown;
      dsh?: { bundle?: { patch?: unknown } };
    };
    return (
      pkg.name === own.name &&
      pkg.dsh?.bundle?.patch !== undefined &&
      real === realpathSync(own.root)
    );
  } catch {
    return false;
  }
}

function runPnpmInstall(profileRoot: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['install'], {
      cwd: profileRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const tail = output.trim().split('\n').slice(-8).join('\n');
      reject(new Error(`pnpm install exited with code ${String(code)}\n${tail}`));
    });
  });
}

/**
 * Ensure the ACP runtime profile exists under the shared dsh installation.
 * The profile composes `@deepseek-ai/dsh-base` with the official
 * `@deepseek-ai/dsh-acp` plugin (approval policy stays `ask`; the bridge
 * answers through `session/request_permission`).
 */
export async function ensureAcpProfile(
  options: AcpRuntimeOptions,
): Promise<AcpProfileEnsureResult> {
  const profile = options.profile ?? DEFAULT_ACP_PROFILE;
  const root = acpProfileRoot(options.home, profile, options.env);
  const provider = options.provider ?? 'deepseek-official';
  const model = options.model ?? 'deepseek-v4-flash';
  const ready = isAcpProfileReady(root);

  try {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'package.json'), packageJsonFor(profile), 'utf8');
    await writeFile(join(root, 'cordis.yml'), '[]\n', 'utf8');
    await writeFile(join(root, 'cordis.patch.yml'), acpPatchYaml(provider, model), 'utf8');
    if (!ready) {
      const install = options.install ?? runPnpmInstall;
      await install(root);
    }
    if (!isAcpProfileReady(root)) {
      return {
        ok: false,
        created: true,
        error: `${ACP_PACKAGE}@${ACP_VERSION} or bridge package was not found after install`,
      };
    }
    return { ok: true, created: !ready };
  } catch (error) {
    return {
      ok: false,
      created: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Resolve the launch spec for the ACP runtime subprocess. */
export function resolveAcpLaunch(options: AcpRuntimeOptions): AcpLaunchSpec {
  const profile = options.profile ?? DEFAULT_ACP_PROFILE;
  if (options.command || options.args) {
    return {
      command: options.command ?? 'node',
      args: options.args ?? ['--profile', profile],
      profile,
    };
  }
  const bin = options.bin ?? discoverDshBin(options.home, options.env);
  if (bin) {
    return { command: 'node', args: [bin, '--profile', profile], profile };
  }
  return { command: 'dsh', args: ['--profile', profile], profile };
}
