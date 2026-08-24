/**
 * Runtime-profile consistency repair for `dsh-lark-bot upgrade` (issue #10).
 *
 * The SDK / ACP runtime profiles (`dsh-lark-sdk` / `dsh-lark-acp`) link this
 * package in via `node_modules/<name> -> <package root>` so their patch rows
 * (`dsh-lark-bot/plugin`, `lark-notify`, `lark-ask`, `lark-plan-approval`) resolve. After a package
 * upgrade the link still points at the OLD package root; the readiness checks
 * (`isSdkManagedProfileCurrent` / `isAcpManagedProfileCurrent`) treat that as
 * not-ready and the
 * next boot re-provisions the profile. This module performs the targeted
 * fix — re-link the own package and idempotently re-provision stale upstream
 * runtime packages — so upgraded profiles stay ready immediately.
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ownPackageInfo, type OwnPackageInfo } from '../adapters/dsh/own-package.js';
import {
  DEFAULT_SDK_PROFILE,
  ensureSdkProfile,
  isSdkManagedProfileCurrent,
  sdkProfileRoot,
} from '../adapters/dsh/sdk-runtime.js';
import {
  DEFAULT_ACP_PROFILE,
  acpProfileRoot,
  ensureAcpProfile,
  isAcpManagedProfileCurrent,
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
  /** Newly installed profile package; never point managed runtimes at a transient npx worker. */
  ownPackage?: OwnPackageInfo;
  /** Injectable link replacement (tests). */
  relinkFn?: (linkPath: string, target: string) => Promise<void>;
  /** Current route used when regenerating the managed ACP overlay. */
  provider?: string;
  model?: string;
  /** Injectable managed-profile provisioners (tests). */
  ensureSdkFn?: typeof ensureSdkProfile;
  ensureAcpFn?: typeof ensureAcpProfile;
}

async function defaultRelink(linkPath: string, target: string): Promise<void> {
  await rm(linkPath, { recursive: true, force: true });
  await mkdir(join(linkPath, '..'), { recursive: true });
  await symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

function existingAcpRoute(profileRoot: string): { provider: string; model: string } | undefined {
  try {
    const patch = readFileSync(join(profileRoot, 'cordis.patch.yml'), 'utf8');
    const provider = patch.match(/^\s*provider:\s*(\S+)\s*$/m)?.[1];
    const model = patch.match(/^\s*model:\s*(\S+)\s*$/m)?.[1];
    return provider && model ? { provider, model } : undefined;
  } catch {
    return undefined;
  }
}

export async function repairRuntimeProfiles(
  options: RepairRuntimeOptions,
): Promise<RuntimeProfileState[]> {
  const own = options.ownPackage ?? ownPackageInfo();
  const env = options.env ?? process.env;
  const relink = options.relinkFn ?? defaultRelink;
  const managedEnv = { ...env, DSH_HOME: options.dshHome };
  const ensureSdk = options.ensureSdkFn ?? ensureSdkProfile;
  const ensureAcp = options.ensureAcpFn ?? ensureAcpProfile;
  const results: RuntimeProfileState[] = [];
  const sdkRoot = sdkProfileRoot(options.dshHome, DEFAULT_SDK_PROFILE, managedEnv);
  const acpRoot = acpProfileRoot(options.dshHome, DEFAULT_ACP_PROFILE, managedEnv);
  const preservedAcpRoute = existingAcpRoute(acpRoot);
  const acpRoute = {
    provider: preservedAcpRoute?.provider ?? options.provider ?? '',
    model: preservedAcpRoute?.model ?? options.model ?? '',
  };

  const targets = [
    {
      profile: DEFAULT_SDK_PROFILE as 'dsh-lark-sdk',
      root: sdkRoot,
      isReady: (root: string) => isSdkManagedProfileCurrent(root, undefined, own),
      ensure: () => ensureSdk({ home: options.dshHome, env: managedEnv, ownPackage: own }),
    },
    {
      profile: DEFAULT_ACP_PROFILE as 'dsh-lark-acp',
      root: acpRoot,
      isReady: (root: string) =>
        isAcpManagedProfileCurrent(root, acpRoute.provider, acpRoute.model, own),
      ensure: () => ensureAcp({
        home: options.dshHome,
        env: managedEnv,
        provider: acpRoute.provider,
        model: acpRoute.model,
        ownPackage: own,
      }),
    },
  ];

  for (const { profile, root, isReady, ensure } of targets) {
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
    if (!isReady(root)) {
      const provisioned = await ensure();
      if (!provisioned.ok) {
        results.push({ profile, existed: true, repaired: true, ok: false });
        continue;
      }
    }
    results.push({ profile, existed: true, repaired: true, ok: isReady(root) });
  }

  return results;
}
