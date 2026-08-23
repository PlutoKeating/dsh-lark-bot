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

export const SDK_SERVER_PACKAGE = '@deepseek-ai/dsh-sdk-jsonrpc-server';
export const SDK_SERVER_VERSION = DSH_COMPATIBILITY.sdkServer;
export const SDK_BASE_BUNDLE = '@deepseek-ai/dsh-base';
export const DEFAULT_SDK_PROFILE = 'dsh-lark-sdk';
/** Core-only SDK profile used by the safety-net guardian's safe mode. */
export const DEFAULT_SAFE_SDK_PROFILE = 'dsh-lark-safe-sdk';

export interface SdkRuntimeOptions {
  /** OS home directory used to resolve the shared dsh installation. */
  home: string;
  /** Environment snapshot for dsh home resolution (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
  /** Explicit runtime command; overrides auto-discovery (from DSH_LARK_DSH_COMMAND). */
  command?: string;
  /** Explicit runtime args; overrides auto-discovery (from DSH_LARK_DSH_ARGS). */
  args?: string[];
  /** Discovered dsh bin path; used when command/args are not explicit. */
  bin?: string;
  /** Profile name for the SDK runtime composition. */
  profile?: string;
  /**
   * Mount the bridge callback tools (`lark_notify`, `lark_ask_user`, and
   * `lark_request_plan_approval`, and the one-shot approval answerer) in the runtime overlay. The full bridge needs
   * them; the guardian's core-only safe profile must not (it has no callback
   * server). Defaults to `true`.
   */
  bridgeTools?: boolean;
  /** Injectable installer for tests. */
  install?: (profileRoot: string) => Promise<void>;
}

export interface SdkLaunchSpec {
  command: string;
  args: string[];
  profile: string;
}

export interface SdkProfileEnsureResult {
  ok: boolean;
  created: boolean;
  error?: string;
}

export function sdkProfileRoot(home: string, profile: string, env?: NodeJS.ProcessEnv): string {
  return join(resolveDshHome(home, env), 'profiles', profile);
}

function packageJsonFor(profile: string): string {
  const own = ownPackageInfo();
  return `${JSON.stringify(
    {
      name: `dsh-profile-${profile}`,
      private: true,
      dependencies: {
        [SDK_SERVER_PACKAGE]: SDK_SERVER_VERSION,
        [own.name]: `link:${own.root}`,
      },
      dsh: {
        profile: {
          bundles: [SDK_BASE_BUNDLE],
        },
      },
    },
    null,
    2,
  )}\n`;
}

export function patchYamlFor(options?: { bridgeTools?: boolean }): string {
  const own = ownPackageInfo();
  const bridgeTools = options?.bridgeTools ?? true;
  const lines = [
    '# dsh-lark SDK JSON-RPC runtime overlay (managed by dsh-lark-bot).',
    '# stdout is reserved for SDK JSON-RPC frames; no console logger may load.',
    '- insert:',
    '    - id: sdk-jsonrpc-server',
    `      name: '${bridgeTools ? `${own.name}/sdk-server` : SDK_SERVER_PACKAGE}'`,
    '      config:',
    '        maxTokensAsSuccess: true',
    '',
    '# Host-native interactive questions are disabled because this IM runtime',
    '# uses lark_ask_user for interactive answers through Feishu/Lark.',
    '- id: user-questions',
    '  disabled: true',
    '',
    '- id: system-prompt',
    '  config:',
    '    persona: >-',
    bridgeTools
      ? `      ${BRIDGE_RUNTIME_PERSONA}`
      : '      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.',
    '',
    '- id: hmr',
    '  disabled: true',
    '',
  ];
  if (bridgeTools) {
    lines.push(
      // In-process bridge callback tool: lets the agent mention users and push
      // messages to other chats/topics through the running bridge process.
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
      // Question-card tool: the agent asks the user for decisions / missing
      // information; the bridge shows a card and returns the answer.
      '- insert:',
      '    - id: lark-ask',
      `      name: '${own.name}/ask'`,
      '      config:',
      '        endpoint: !!js process.env.DSH_LARK_ASK_URL',
      '        token: !!js process.env.DSH_LARK_NOTIFY_TOKEN',
      '',
      // Plan gate: send the complete plan, then wait for approve/revise.
      '- insert:',
      '    - id: lark-plan-approval',
      `      name: '${own.name}/plan'`,
      '      config:',
      '        endpoint: !!js process.env.DSH_LARK_PLAN_URL',
      '        token: !!js process.env.DSH_LARK_NOTIFY_TOKEN',
      '        mode: !!js process.env.DSH_LARK_PLAN_GATE',
      '',
      // Default-runtime answerer for the official dsh user-approval seam.
      '- insert:',
      '    - id: lark-approval-answerer',
      `      name: '${own.name}/approval'`,
      '      config:',
      '        endpoint: !!js process.env.DSH_LARK_APPROVAL_URL',
      '        token: !!js process.env.DSH_LARK_NOTIFY_TOKEN',
      '',
    );
  }
  return lines.join('\n');
}

export function isSdkProfileReady(profileRoot: string): boolean {
  const own = ownPackageInfo();
  return (
    existsSync(join(profileRoot, 'package.json')) &&
    existsSync(join(profileRoot, 'cordis.yml')) &&
    existsSync(join(profileRoot, 'cordis.patch.yml')) &&
    profilePackageMatches(profileRoot, SDK_SERVER_PACKAGE, SDK_SERVER_VERSION) &&
    ownPackageLinked(profileRoot, own)
  );
}

/** Package readiness plus exact managed overlay content for this bridge version. */
export function isSdkManagedProfileCurrent(
  profileRoot: string,
  options?: { bridgeTools?: boolean },
): boolean {
  return (
    isSdkProfileReady(profileRoot) &&
    readFileIfPresent(join(profileRoot, 'cordis.patch.yml')) === patchYamlFor(options)
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
 * Ensure the SDK runtime profile exists under the shared dsh installation.
 * The profile is a managed composition: `@deepseek-ai/dsh-base` bundle plus
 * the official JSON-RPC server plus the bridge's attachment-upload extension. Idempotent.
 */
export async function ensureSdkProfile(
  options: SdkRuntimeOptions,
): Promise<SdkProfileEnsureResult> {
  const profile = options.profile ?? DEFAULT_SDK_PROFILE;
  const root = sdkProfileRoot(options.home, profile, options.env);
  const patchOptions = options.bridgeTools === undefined
    ? {}
    : { bridgeTools: options.bridgeTools };
  const expectedPatch = patchYamlFor(patchOptions);
  if (isSdkManagedProfileCurrent(root, patchOptions)) {
    return { ok: true, created: false };
  }

  try {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'package.json'), packageJsonFor(profile), 'utf8');
    await writeFile(join(root, 'cordis.yml'), '[]\n', 'utf8');
    await writeFile(
      join(root, 'cordis.patch.yml'),
      expectedPatch,
      'utf8',
    );
    const install = options.install ?? runPnpmInstall;
    if (!isSdkProfileReady(root)) {
      await install(root);
    }
    if (!isSdkProfileReady(root)) {
      return {
        ok: false,
        created: true,
        error: `${SDK_SERVER_PACKAGE}@${SDK_SERVER_VERSION} was not found after install`,
      };
    }
    return { ok: true, created: true };
  } catch (error) {
    return {
      ok: false,
      created: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readFileIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** Resolve the launch spec for the SDK runtime subprocess. */
export function resolveSdkLaunch(options: SdkRuntimeOptions): SdkLaunchSpec {
  const profile = options.profile ?? DEFAULT_SDK_PROFILE;
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
