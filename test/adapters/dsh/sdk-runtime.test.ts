import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SDK_PROFILE,
  ensureSdkProfile,
  isSdkProfileReady,
  resolveSdkLaunch,
  sdkProfileRoot,
  SDK_SERVER_PACKAGE,
} from '../../../src/adapters/dsh/sdk-runtime.js';
import { ownPackageInfo } from '../../../src/adapters/dsh/own-package.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('resolveSdkLaunch', () => {
  it('uses the discovered bin with the SDK profile', () => {
    const launch = resolveSdkLaunch({ home: '/home/x', bin: '/home/x/bin.js' });
    expect(launch.command).toBe('node');
    expect(launch.args).toEqual(['/home/x/bin.js', '--profile', DEFAULT_SDK_PROFILE]);
  });

  it('honours explicit command overrides', () => {
    const launch = resolveSdkLaunch({ home: '/home/x', command: 'dsh', args: ['--profile', 'custom'] });
    expect(launch.args).toEqual(['--profile', 'custom']);
  });
});

describe('ensureSdkProfile', () => {
  it('creates the managed profile and installs the server plugin', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-home-'));
    tempDirs.push(home);
    const profileRoot = sdkProfileRoot(home, DEFAULT_SDK_PROFILE);
    expect(isSdkProfileReady(profileRoot)).toBe(false);

    const result = await ensureSdkProfile({
      home,
      install: async (root) => {
        const own = ownPackageInfo();
        await mkdir(join(root, 'node_modules', '@deepseek-ai', SDK_SERVER_PACKAGE.split('/')[1] ?? ''), {
          recursive: true,
        });
        await writeFile(
          join(root, 'node_modules', SDK_SERVER_PACKAGE, 'package.json'),
          JSON.stringify({ name: SDK_SERVER_PACKAGE }),
        );
        await mkdir(join(root, 'node_modules', own.name), { recursive: true });
      },
    });

    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(isSdkProfileReady(profileRoot)).toBe(true);
    expect(await ensureSdkProfile({ home })).toMatchObject({ ok: true, created: false });
  });

  it('reports install failures', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-home-fail-'));
    tempDirs.push(home);
    const result = await ensureSdkProfile({
      home,
      install: async () => {
        throw new Error('offline');
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('offline');
  });
});
