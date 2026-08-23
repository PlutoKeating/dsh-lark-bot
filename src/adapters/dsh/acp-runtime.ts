import { spawn } from 'cross-spawn';
import { existsSync, realpathSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DSH_COMPATIBILITY } from '../../config/dsh-compat.js';
import { discoverDshBin, resolveDshHome } from '../../config/dsh-runtime.js';
import { BRIDGE_RUNTIME_PERSONA } from './bridge-persona.js';
import type { OwnPackageInfo } from './own-package.js';
import { ownPackageInfo } from './own-package.js';
import { profilePackageMatches } from './profile-package.js';

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
  install?: (profileRoot: string, options?: { force?: boolean }) => Promise<void>;
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
    '# Host-native interactive questions are disabled because this IM runtime',
    '# uses lark_ask_user for interactive answers through Feishu/Lark.',
    '- id: user-questions',
    '  disabled: true',
    '',
    '- id: system-prompt',
    '  config:',
    '    persona: >-',
    `      ${BRIDGE_RUNTIME_PERSONA}`,
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
    // Local result-file upload tool.
    '- insert:',
    '    - id: lark-file',
    `      name: '${own.name}/file'`,
    '      config:',
    '        endpoint: !!js process.env.DSH_LARK_FILE_URL',
    '        token: !!js process.env.DSH_LARK_NOTIFY_TOKEN',
    '',
    // Owner-only secure value collection; values bypass the agent process.
    '- insert:',
    '    - id: lark-secret',
    `      name: '${own.name}/secret'`,
    '      config:',
    '        endpoint: !!js process.env.DSH_LARK_SECRET_URL',
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
    // Plan gate (same contract as the SDK runtime).
    '- insert:',
    '    - id: lark-plan-approval',
    `      name: '${own.name}/plan'`,
    '      config:',
    '        endpoint: !!js process.env.DSH_LARK_PLAN_URL',
    '        policyEndpoint: !!js process.env.DSH_LARK_APPROVAL_URL',
    '        token: !!js process.env.DSH_LARK_NOTIFY_TOKEN',
    '        mode: !!js process.env.DSH_LARK_PLAN_GATE',
    '',
  ].join('\n');
}

export function isAcpProfileReady(profileRoot: string): boolean {
  const own = ownPackageInfo();
  return (
    existsSync(join(profileRoot, 'package.json')) &&
    existsSync(join(profileRoot, 'cordis.yml')) &&
    existsSync(join(profileRoot, 'cordis.patch.yml')) &&
    profilePackageMatches(profileRoot, ACP_PACKAGE, ACP_VERSION) &&
    ownPackageLinked(profileRoot, own)
  );
}

/** Package readiness plus the exact managed ACP overlay for the active route. */
export function isAcpManagedProfileCurrent(
  profileRoot: string,
  provider: string,
  model: string,
): boolean {
  if (!isAcpProfileReady(profileRoot)) return false;
  try {
    return readFileSync(join(profileRoot, 'cordis.patch.yml'), 'utf8') ===
      acpPatchYaml(provider, model);
  } catch {
    return false;
  }
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

function runPnpmInstall(profileRoot: string, options: { force?: boolean } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['install', ...(options.force ? ['--force'] : [])], {
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
  const provider = options.provider?.trim();
  const model = options.model?.trim();
  const ready = isAcpProfileReady(root);

  try {
    if (!provider || !model) {
      throw new Error(
        'ACP runtime requires a configured provider/model route; set DSH_LARK_PROVIDER and DSH_LARK_MODEL.',
      );
    }
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'package.json'), packageJsonFor(profile), 'utf8');
    await writeFile(join(root, 'cordis.yml'), '[]\n', 'utf8');
    await writeFile(join(root, 'cordis.patch.yml'), acpPatchYaml(provider, model), 'utf8');
    if (!ready) {
      const install = options.install ?? runPnpmInstall;
      await install(root, { force: true });
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
