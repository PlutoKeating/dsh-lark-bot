/**
 * Runtime-profile consistency repair for `dsh-lark-bot upgrade` (issue #10).
 *
 * The SDK / ACP runtime profiles (`dsh-lark-sdk` / `dsh-lark-acp`) link this
 * package in via `node_modules/<name> -> <package root>` so their patch rows
 * (`dsh-lark-bot/plugin`, `lark-notify`, `lark-ask`) resolve. After a package
 * upgrade the link still points at the OLD package root; the readiness checks
 * (`isSdkProfileReady` / `isAcpProfileReady`) treat that as not-ready and the
 * next boot re-provisions the profile. This module performs the targeted
 * fix — re-link the own package to the running root — so upgraded profiles
 * stay ready immediately, and reports profiles that need a full re-provision.
 */

import { existsSync } from 'node:fs';
import { mkdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ownPackageInfo } from '../adapters/dsh/own-package.js';
import {
  DEFAULT_SDK_PROFILE,
  isSdkProfileReady,
  sdkProfileRoot,
} from '../adapters/dsh/sdk-runtime.js';
import {
  DEFAULT_ACP_PROFILE,
  acpProfileRoot,
  isAcpProfileReady,
} from '../adapters/dsh/acp-runtime.js';

export interface RuntimeProfileState {
  /** Which runtime profile this entry describes. */
  profile: 'dsh-lark-sdk' | 'dsh-lark-acp';
  /** The profile directory existed before the repair attempt. */
  existed: boolean;
  /** The own-package link was stale and has been relinked to the running root. */
  repaired: boolean;
  /** The profile is fully ready after the attempt (or was already). */
  ok: boolean;
}

export interface RepairRuntimeOptions {
  /** dsh home containing `profiles/<name>`. */
  dshHome: string;
  env?: NodeJS.ProcessEnv;
  /** Injectable link replacement (tests). */
  relinkFn?: (linkPath: string, target: string) => Promise<void>;
}

async function defaultRelink(linkPath: string, target: string): Promise<void> {
  await rm(linkPath, { recursive: true, force: true });
  await mkdir(join(linkPath, '..'), { recursive: true });
  await symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

export async function repairRuntimeProfiles(
  options: RepairRuntimeOptions,
): Promise<RuntimeProfileState[]> {
  const own = ownPackageInfo();
  const env = options.env ?? process.env;
  const relink = options.relinkFn ?? defaultRelink;
  const results: RuntimeProfileState[] = [];

  const targets = [
    {
      profile: DEFAULT_SDK_PROFILE as 'dsh-lark-sdk',
      root: sdkProfileRoot(options.dshHome, DEFAULT_SDK_PROFILE, env),
      isReady: isSdkProfileReady,
    },
    {
      profile: DEFAULT_ACP_PROFILE as 'dsh-lark-acp',
      root: acpProfileRoot(options.dshHome, DEFAULT_ACP_PROFILE, env),
      isReady: isAcpProfileReady,
    },
  ];

  for (const { profile, root, isReady } of targets) {
    const existed = existsSync(join(root, 'package.json'));
    if (!existed) {
      // Never provisioned yet — nothing to repair.
      results.push({ profile, existed: false, repaired: false, ok: true });
      continue;
    }
    if (isReady(root)) {
      results.push({ profile, existed: true, repaired: false, ok: true });
      continue;
    }
    const linkPath = join(root, 'node_modules', own.name);
    try {
      await relink(linkPath, own.root);
    } catch {
      results.push({ profile, existed: true, repaired: false, ok: false });
      continue;
    }
    results.push({
      profile,
      existed: true,
      repaired: true,
      ok: isReady(root),
    });
  }

  return results;
}
