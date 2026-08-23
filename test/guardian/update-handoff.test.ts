import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  GuardianUpdateHandoff,
  guardianUpdateFailureHint,
  runGuardianUpdateWorker,
} from '../../src/guardian/update-handoff.js';

describe('GuardianUpdateHandoff', () => {
  it.each([
    ['filesystem-access', '文件权限', 'file permissions'],
    ['registry-unavailable', 'npm 正式源', 'npm registry'],
    ['bootstrap-unavailable', 'npm/npx', 'npm/npx'],
    ['upgrade-failed', '/doctor', '/doctor'],
  ] as const)('renders an actionable safe hint for %s', (code, zh, en) => {
    expect(guardianUpdateFailureHint(code).zh).toContain(zh);
    expect(guardianUpdateFailureHint(code).en).toContain(en);
  });

  it('durably accepts one in-flight update and hands it to an isolated worker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-channel-upgrade-'));
    const file = join(root, 'guardian', 'update.json');
    const launch = vi.fn().mockResolvedValue(undefined);
    const handoff = new GuardianUpdateHandoff({
      file,
      dshProfile: 'dsh-lark',
      packageName: 'dsh-lark-bot',
      launch,
      now: () => new Date('2026-08-24T00:00:00.000Z'),
      id: () => 'update-1',
    });

    const first = await handoff.start('0.19.0', {
      chatId: 'oc_chat', threadId: 'omt_thread', requesterId: 'ou_admin',
    });
    const second = await handoff.start('0.20.0', {
      chatId: 'oc_other', requesterId: 'ou_admin',
    });

    expect(first).toEqual({ accepted: true, id: 'update-1' });
    expect(second).toEqual({ accepted: false, reason: 'busy', id: 'update-1' });
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      id: 'update-1', targetVersion: '0.19.0', dshProfile: 'dsh-lark', stateFile: file,
    }));
    const saved = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    expect(saved).toMatchObject({
      schemaVersion: 1, id: 'update-1', status: 'running', targetVersion: '0.19.0',
      route: { chatId: 'oc_chat', threadId: 'omt_thread', requesterId: 'ou_admin' },
    });
    if (process.platform !== 'win32') {
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
  });

  it('runs the exact npm release through the full guardian-aware upgrade path and records completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-channel-upgrade-worker-'));
    const file = join(root, 'guardian', 'update.json');
    const handoff = new GuardianUpdateHandoff({
      file, dshProfile: 'dsh-lark', packageName: 'dsh-lark-bot',
      launch: vi.fn().mockResolvedValue(undefined), id: () => 'update-2',
    });
    await handoff.start('0.19.0', { chatId: 'oc_chat', requesterId: 'ou_admin' });
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: 'ok', stderr: '' });

    await runGuardianUpdateWorker({ stateFile: file, id: 'update-2' }, { run, delayMs: 0 });

    const workerRoot = join(root, 'guardian', 'update-worker');
    const requestCache = join(workerRoot, 'npm-cache', '1c3a6f1f63695bd1c77d59ad9ce128913d4ad733d132f1b4f6b68b05acd0b4cf');
    expect(run).toHaveBeenCalledWith(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['--yes', '--cache', requestCache, '--registry', 'https://registry.npmjs.org', 'dsh-lark-bot@0.19.0', 'upgrade', '--profile', 'dsh-lark', '--yes', '--restart', '--package', 'dsh-lark-bot@0.19.0'],
      30 * 60_000,
      { cwd: join(workerRoot, 'cwd'), umask: 0o077 },
    );
    if (process.platform !== 'win32') {
      expect((await stat(workerRoot)).mode & 0o777).toBe(0o700);
      expect((await stat(join(workerRoot, 'npm-cache'))).mode & 0o777).toBe(0o700);
      expect((await stat(requestCache)).mode & 0o777).toBe(0o700);
      expect((await stat(join(workerRoot, 'cwd'))).mode & 0o777).toBe(0o700);
    }
    const saved = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    expect(saved).toMatchObject({ id: 'update-2', status: 'succeeded', delivered: false });
    expect(saved.finishedAt).toEqual(expect.any(String));
  });

  it('delivers a terminal result once, including after the bridge has restarted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-channel-upgrade-result-'));
    const file = join(root, 'guardian', 'update.json');
    const base = new GuardianUpdateHandoff({
      file, dshProfile: 'dsh-lark', packageName: 'dsh-lark-bot',
      launch: vi.fn().mockResolvedValue(undefined), id: () => 'update-3',
    });
    await base.start('0.19.0', { chatId: 'oc_chat', requesterId: 'ou_admin' });
    await runGuardianUpdateWorker(
      { stateFile: file, id: 'update-3' },
      { run: vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' }), delayMs: 0 },
    );
    const afterRestart = new GuardianUpdateHandoff({
      file, dshProfile: 'dsh-lark', packageName: 'dsh-lark-bot',
      launch: vi.fn().mockResolvedValue(undefined),
    });
    const deliver = vi.fn().mockResolvedValue(undefined);

    await expect(afterRestart.deliverResult(deliver)).resolves.toBe(true);
    await expect(afterRestart.deliverResult(deliver)).resolves.toBe(false);
    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({
      status: 'succeeded', targetVersion: '0.19.0',
      route: { chatId: 'oc_chat', requesterId: 'ou_admin' },
    }));
  });

  it('reconciles a worker interrupted by its own managed-profile restart from the reloaded version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-channel-upgrade-reconcile-'));
    const file = join(root, 'guardian', 'update.json');
    const handoff = new GuardianUpdateHandoff({
      file, dshProfile: 'dsh-lark', packageName: 'dsh-lark-bot',
      launch: vi.fn().mockResolvedValue(undefined), id: () => 'update-4',
    });
    await handoff.start('0.19.0', { chatId: 'oc_chat', requesterId: 'ou_admin' });

    await expect(handoff.reconcile('0.19.0')).resolves.toBe('succeeded');
    const deliver = vi.fn().mockResolvedValue(undefined);
    await expect(handoff.deliverResult(deliver)).resolves.toBe(true);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded' }));
  });

  it('records a bounded safe failure category without persisting raw worker output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-channel-upgrade-failure-'));
    const file = join(root, 'guardian', 'update.json');
    const handoff = new GuardianUpdateHandoff({
      file, dshProfile: 'dsh-lark', packageName: 'dsh-lark-bot',
      launch: vi.fn().mockResolvedValue(undefined), id: () => 'update-5',
    });
    await handoff.start('0.19.0', { chatId: 'oc_chat', requesterId: 'ou_admin' });
    await runGuardianUpdateWorker(
      { stateFile: file, id: 'update-5' },
      {
        run: vi.fn().mockResolvedValue({
          code: 1,
          stdout: '',
          stderr: `npm ERR! EACCES token=super-secret /home/private/${'x'.repeat(3_000)}`,
        }),
        delayMs: 0,
      },
    );

    const deliver = vi.fn().mockResolvedValue(undefined);
    await handoff.deliverResult(deliver);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      errorCode: 'filesystem-access',
      error: 'upgrade worker could not access its private working files',
    }));
    const saved = await readFile(file, 'utf8');
    expect(saved).not.toContain('super-secret');
    expect(saved).not.toContain('/home/private');
    expect(saved.length).toBeLessThan(1_000);
  });

  it('turns an unexpected runner rejection into a durable terminal failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-channel-upgrade-rejection-'));
    const file = join(root, 'guardian', 'update.json');
    const handoff = new GuardianUpdateHandoff({
      file, dshProfile: 'dsh-lark', packageName: 'dsh-lark-bot',
      launch: vi.fn().mockResolvedValue(undefined), id: () => 'update-rejected',
    });
    await handoff.start('0.19.0', { chatId: 'oc_chat', requesterId: 'ou_admin' });

    await expect(runGuardianUpdateWorker(
      { stateFile: file, id: 'update-rejected' },
      { run: vi.fn().mockRejectedValue(new Error('EACCES: private path')), delayMs: 0 },
    )).resolves.toBeUndefined();

    const saved = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    expect(saved).toMatchObject({
      status: 'failed',
      delivered: false,
      errorCode: 'filesystem-access',
    });
    expect(saved.error).not.toContain('private path');
  });

  it('restores owner-only worker directory modes under a hostile umask', async () => {
    if (process.platform === 'win32') return;
    const root = await mkdtemp(join(tmpdir(), 'dsh-channel-upgrade-umask-'));
    const file = join(root, 'guardian', 'update.json');
    const handoff = new GuardianUpdateHandoff({
      file, dshProfile: 'dsh-lark', packageName: 'dsh-lark-bot',
      launch: vi.fn().mockResolvedValue(undefined), id: () => 'update-umask',
    });
    await handoff.start('0.19.0', { chatId: 'oc_chat', requesterId: 'ou_admin' });
    const staleCache = join(root, 'guardian', 'update-worker', 'npm-cache', 'stale');
    await mkdir(staleCache, { recursive: true });
    const staleCwd = join(root, 'guardian', 'update-worker', 'cwd');
    await mkdir(staleCwd, { recursive: true });
    await writeFile(join(staleCwd, 'package.json'), '{"name":"dsh-lark-bot"}\n');
    const previousUmask = process.umask(0o177);
    try {
      await runGuardianUpdateWorker(
        { stateFile: file, id: 'update-umask' },
        { run: vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' }), delayMs: 0 },
      );
    } finally {
      process.umask(previousUmask);
    }
    const workerRoot = join(root, 'guardian', 'update-worker');
    expect((await stat(workerRoot)).mode & 0o777).toBe(0o700);
    expect((await stat(join(workerRoot, 'npm-cache'))).mode & 0o777).toBe(0o700);
    const requestCaches = await readdir(join(workerRoot, 'npm-cache'));
    expect(requestCaches).toHaveLength(1);
    expect(requestCaches).not.toContain('stale');
    expect((await stat(join(workerRoot, 'npm-cache', requestCaches[0] ?? ''))).mode & 0o777).toBe(0o700);
    expect((await stat(join(workerRoot, 'cwd'))).mode & 0o777).toBe(0o700);
    expect(await readdir(join(workerRoot, 'cwd'))).toEqual([]);
  });

  it('serializes simultaneous confirmations so only one worker can start', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-channel-upgrade-race-'));
    const file = join(root, 'guardian', 'update.json');
    const launch = vi.fn().mockResolvedValue(undefined);
    let sequence = 0;
    const handoff = new GuardianUpdateHandoff({
      file, dshProfile: 'dsh-lark', packageName: 'dsh-lark-bot', launch,
      id: () => `update-${++sequence}`,
    });

    const [first, second] = await Promise.all([
      handoff.start('0.19.0', { chatId: 'oc_a', requesterId: 'ou_admin' }),
      handoff.start('0.20.0', { chatId: 'oc_b', requesterId: 'ou_admin' }),
    ]);

    expect([first.accepted, second.accepted].sort()).toEqual([false, true]);
    expect(launch).toHaveBeenCalledOnce();
  });

  it('does not reopen a result already reconciled and delivered by the restarted bridge', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-channel-upgrade-restart-race-'));
    const file = join(root, 'guardian', 'update.json');
    const handoff = new GuardianUpdateHandoff({
      file, dshProfile: 'dsh-lark', packageName: 'dsh-lark-bot',
      launch: vi.fn().mockResolvedValue(undefined), id: () => 'update-6',
    });
    await handoff.start('0.19.0', { chatId: 'oc_chat', requesterId: 'ou_admin' });
    const delivered = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockImplementation(async () => {
      await handoff.reconcile('0.19.0');
      await handoff.deliverResult(delivered);
      return { code: 0, stdout: '', stderr: '' };
    });

    await runGuardianUpdateWorker({ stateFile: file, id: 'update-6' }, { run, delayMs: 0 });

    await expect(handoff.deliverResult(delivered)).resolves.toBe(false);
    expect(delivered).toHaveBeenCalledOnce();
  });

  it('serializes overlapping result polls so a slow Feishu send is still delivered once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-channel-upgrade-delivery-race-'));
    const file = join(root, 'guardian', 'update.json');
    const handoff = new GuardianUpdateHandoff({
      file, dshProfile: 'dsh-lark', packageName: 'dsh-lark-bot',
      launch: vi.fn().mockResolvedValue(undefined), id: () => 'update-7',
    });
    await handoff.start('0.19.0', { chatId: 'oc_chat', requesterId: 'ou_admin' });
    await handoff.reconcile('0.19.0');
    const deliver = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    const outcomes = await Promise.all([
      handoff.deliverResult(deliver),
      handoff.deliverResult(deliver),
    ]);

    expect(outcomes.sort()).toEqual([false, true]);
    expect(deliver).toHaveBeenCalledOnce();
  });
});
