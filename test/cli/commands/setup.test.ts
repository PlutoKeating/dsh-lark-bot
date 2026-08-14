import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSetup } from '../../../src/cli/commands/setup.js';

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
  it('pre-approves pnpm builds and installs the bundle via dsh plugin add', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-setup-'));
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

      await runSetup({ profile: 'demo', dshHome: home, bin: '/fake/dsh/bin.js' });

      const workspaceYaml = await readFile(join(home, 'profiles', 'demo', 'pnpm-workspace.yaml'), 'utf8');
      expect(workspaceYaml).toContain('allowBuilds:');
      expect(workspaceYaml).toContain('protobufjs: true');
      expect(spawnMock).toHaveBeenCalledWith(
        'node',
        ['/fake/dsh/bin.js', 'plugin', '--profile', 'demo', 'add', 'dsh-lark-bot'],
        { stdio: 'inherit' },
      );
      expect(stdout.join('')).toContain('dsh --profile demo');
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('installs the safety-net guardian when --guardian is requested', async () => {
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
});
