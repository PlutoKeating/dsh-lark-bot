import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveBuilds,
  runSetup,
} from '../../../src/cli/commands/setup.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));


const tempDirs: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('dsh-lark-bot setup', () => {
  it('pins Corepack to the pnpm version recorded by the existing profile install', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-setup-pnpm-'));
    tempDirs.push(home);
    const profileDir = join(home, 'profile');
    await mkdir(join(profileDir, 'node_modules'), { recursive: true });
    await writeFile(
      join(profileDir, 'package.json'),
      `${JSON.stringify({ name: 'dsh-profile-demo', private: true, packageManager: 'pnpm@11.21.0' }, null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      join(profileDir, 'node_modules', '.modules.yaml'),
      `${JSON.stringify({ packageManager: 'pnpm@10.33.0-rc.1+managed.2', storeDir: '/store/v10' }, null, 2)}\n`,
      'utf8',
    );

    await approveBuilds(profileDir);

    const profilePackage = JSON.parse(
      await readFile(join(profileDir, 'package.json'), 'utf8'),
    ) as { packageManager?: string };
    expect(profilePackage.packageManager).toBe('pnpm@10.33.0-rc.1+managed.2');
  });

  it('does not create package.json for a fresh profile without pnpm install metadata', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-setup-fresh-'));
    tempDirs.push(home);

    await approveBuilds(home);

    await expect(readFile(join(home, 'package.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('pre-approves pnpm builds, installs the bundle and the guardian by default', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-setup-'));
    tempDirs.push(home);
    const pkg = JSON.parse(
      await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    const stdout: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const spawnMock = vi.mocked(spawn);
      spawnMock.mockImplementation((() => {
        const child = new EventEmitter();
        queueMicrotask(() => child.emit('exit', 0));
        return child as unknown as ReturnType<typeof spawn>;
      }) as never);

      const installGuardianFn = vi.fn().mockResolvedValue({
        ok: true,
        messages: ['守护状态已写入 /tmp/guardian.json'],
      });
      await runSetup({
        profile: 'demo',
        dshHome: home,
        bin: '/fake/dsh/bin.js',
        installGuardianFn,
      });

      const workspaceYaml = await readFile(join(home, 'profiles', 'demo', 'pnpm-workspace.yaml'), 'utf8');
      expect(workspaceYaml).toContain('allowBuilds:');
      expect(workspaceYaml).toContain('protobufjs: true');
      expect(installGuardianFn).toHaveBeenCalledWith(
        expect.objectContaining({ dshProfile: 'demo' }),
      );
      expect(spawnMock).toHaveBeenCalledWith(
        'node',
        ['/fake/dsh/bin.js', 'plugin', '--profile', 'demo', 'add', `dsh-lark-bot@${pkg.version}`],
        { stdio: 'inherit', env: expect.objectContaining({ DSH_HOME: home }) },
      );
      expect(stdout.join('')).toContain('dsh --profile demo');
      expect(stdout.join('')).toContain('安全网守护已默认安装');
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('honours an explicit package spec instead of the pinned version', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-setup-spec-'));
    tempDirs.push(home);
    const stdout: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const spawnMock = vi.mocked(spawn);
      spawnMock.mockImplementation((() => {
        const child = new EventEmitter();
        queueMicrotask(() => child.emit('exit', 0));
        return child as unknown as ReturnType<typeof spawn>;
      }) as never);

      await runSetup({
        profile: 'demo',
        dshHome: home,
        bin: '/fake/dsh/bin.js',
        packageSpec: '/tmp/dsh-lark-bot-0.9.1.tgz',
        guardian: false,
      });

      expect(spawnMock).toHaveBeenCalledWith(
        'node',
        ['/fake/dsh/bin.js', 'plugin', '--profile', 'demo', 'add', '/tmp/dsh-lark-bot-0.9.1.tgz'],
        { stdio: 'inherit', env: expect.objectContaining({ DSH_HOME: home }) },
      );
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('installs the safety-net guardian when guardian is explicitly enabled', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-setup-guardian-'));
    tempDirs.push(home);
    const stdout: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const spawnMock = vi.mocked(spawn);
      spawnMock.mockImplementation((() => {
        const child = new EventEmitter();
        queueMicrotask(() => child.emit('exit', 0));
        return child as unknown as ReturnType<typeof spawn>;
      }) as never);

      const installGuardianFn = vi.fn().mockResolvedValue({
        ok: true,
        messages: ['守护状态已写入 /tmp/guardian.json（dsh profile=demo）'],
      });
      await runSetup({
        profile: 'demo',
        dshHome: home,
        bin: '/fake/dsh/bin.js',
        guardian: true,
        installGuardianFn,
      });

      expect(installGuardianFn).toHaveBeenCalledWith(
        expect.objectContaining({ dshProfile: 'demo' }),
      );
      expect(stdout.join('')).toContain('守护状态已写入');
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('skips the safety-net guardian when guardian is explicitly disabled', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-setup-no-guardian-'));
    tempDirs.push(home);
    const stdout: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const spawnMock = vi.mocked(spawn);
      spawnMock.mockImplementation((() => {
        const child = new EventEmitter();
        queueMicrotask(() => child.emit('exit', 0));
        return child as unknown as ReturnType<typeof spawn>;
      }) as never);

      const installGuardianFn = vi.fn();
      await runSetup({
        profile: 'demo',
        dshHome: home,
        bin: '/fake/dsh/bin.js',
        guardian: false,
        installGuardianFn,
      });

      expect(installGuardianFn).not.toHaveBeenCalled();
      expect(stdout.join('')).toContain('--no-guardian');
      expect(stdout.join('')).toContain('未安装安全网守护');
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
