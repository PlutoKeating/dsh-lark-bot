import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDshHome } from '../config/dsh-runtime.js';

/**
 * Core-only "safe mode" dsh profile provisioning.
 *
 * Safe mode must mount the dsh main core and NO third-party plugins (this is
 * what makes it useful when a broken plugin kills the full profile boot).
 * The minimal composition is the official core bundle plus the official
 * one-shot headless app — exactly the shipped `headless` template, under a
 * dedicated profile name we own (`<dsh-profile>-safe`) so it can never be
 * polluted by plugins installed into other profiles.
 *
 * Both bundles resolve from the dsh installation's own dependency closure
 * (dsh heals `$DSH_HOME/profiles/node_modules` on boot), so no pnpm install
 * is needed and the safe profile boots even when the normal profile's
 * node_modules / third-party plugins are broken.
 */

export const SAFE_CORE_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-headless',
] as const;

export interface SafeProfileEnsureOptions {
  /** OS home used to resolve `~/.dsh` (same as the bridge runtime). */
  home: string;
  /** dsh profile name whose safe variant we manage (`dsh-lark` → `dsh-lark-safe`). */
  dshProfile: string;
  env?: NodeJS.ProcessEnv;
}

export interface SafeProfileEnsureResult {
  root: string;
  created: boolean;
}

export function safeProfileName(dshProfile: string): string {
  return `${dshProfile}-safe`;
}

export function safeProfileRoot(
  home: string,
  dshProfile: string,
  env?: NodeJS.ProcessEnv,
): string {
  return join(resolveDshHome(home, env), 'profiles', safeProfileName(dshProfile));
}

/**
 * Create the safe profile files when missing (existing files are never
 * overwritten, so a manually adjusted safe profile keeps working). Returns
 * the profile root and whether anything was created.
 */
export async function ensureSafeProfile(
  options: SafeProfileEnsureOptions,
): Promise<SafeProfileEnsureResult> {
  const root = safeProfileRoot(options.home, options.dshProfile, options.env);
  const name = safeProfileName(options.dshProfile);
  await mkdir(root, { recursive: true });
  let created = false;

  const manifest = join(root, 'package.json');
  if (!existsSync(manifest)) {
    await writeFile(
      manifest,
      `${JSON.stringify(
        {
          name: `dsh-profile-${name}`,
          private: true,
          dependencies: {},
          dsh: {
            profile: {
              bundles: [...SAFE_CORE_BUNDLES],
            },
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    created = true;
  }

  const rootConfig = join(root, 'cordis.yml');
  if (!existsSync(rootConfig)) {
    await writeFile(
      rootConfig,
      '# dsh profile root - an empty entry list; the tree is composed as patches.\n[]\n',
      'utf8',
    );
    created = true;
  }

  const userPatch = join(root, 'cordis.patch.yml');
  if (!existsSync(userPatch)) {
    // Deliberately empty: safe mode mounts only the core bundles, no
    // third-party rows and no bridge plugin.
    await writeFile(userPatch, '[]\n', 'utf8');
    created = true;
  }

  const workspace = join(root, 'pnpm-workspace.yaml');
  if (!existsSync(workspace)) {
    await writeFile(
      workspace,
      [
        'packages:',
        '  - .',
        '',
        '',
        'nodeLinker: hoisted',
        'autoInstallPeers: false',
        '',
      ].join('\n'),
      'utf8',
    );
    created = true;
  }

  return { root, created };
}

export interface SafeProfileProbeOptions {
  /** Absolute dsh bin (`@deepseek-ai/dsh/lib/bin.js`) or the `dsh` launcher. */
  bin: string;
  /** dsh profile name whose safe variant is probed. */
  dshProfile: string;
  /** OS home used to resolve `~/.dsh`. */
  home: string;
  env?: NodeJS.ProcessEnv;
  /** Injectable runner for tests. */
  run?: (
    command: string,
    args: readonly string[],
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
}

export interface SafeProfileProbeResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

async function defaultRun(
  command: string,
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error: Error) => {
      resolve({ code: 1, stdout, stderr: `${error.message}\n` });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * Probe the safe profile with the boot-free `dsh --dump-config` invocation:
 * it composes the bundle layers and the user patch without mounting any
 * plugin, which is exactly the "can the core still resolve" check. Failures
 * (unresolvable bundles / broken patch) are surfaced to the user in Feishu.
 */
export async function probeSafeProfile(
  options: SafeProfileProbeOptions,
): Promise<SafeProfileProbeResult> {
  const run = options.run ?? defaultRun;
  const profile = safeProfileName(options.dshProfile);
  const result = await run(options.bin, ['--profile', profile, '--dump-config']);
  if (result.code === 0) {
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  }
  const tail = result.stderr.trim().split('\n').slice(-5).join('\n');
  return {
    ok: false,
    stdout: result.stdout,
    stderr: result.stderr,
    error: tail || `dsh --profile ${profile} --dump-config exited with code ${result.code}`,
  };
}
