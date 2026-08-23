import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  GuardianUpdateHandoff,
  runGuardianUpdateWorker,
} from '../../src/guardian/update-handoff.js';

describe('GuardianUpdateHandoff', () => {
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

    expect(run).toHaveBeenCalledWith(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['--yes', '--registry', 'https://registry.npmjs.org', 'dsh-lark-bot@0.19.0', 'upgrade', '--profile', 'dsh-lark', '--yes', '--restart', '--package', 'dsh-lark-bot@0.19.0'],
      30 * 60_000,
    );
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

  it('records bounded worker output for local failure logging', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-channel-upgrade-failure-'));
    const file = join(root, 'guardian', 'update.json');
    const handoff = new GuardianUpdateHandoff({
      file, dshProfile: 'dsh-lark', packageName: 'dsh-lark-bot',
      launch: vi.fn().mockResolvedValue(undefined), id: () => 'update-5',
    });
    await handoff.start('0.19.0', { chatId: 'oc_chat', requesterId: 'ou_admin' });
    await runGuardianUpdateWorker(
      { stateFile: file, id: 'update-5' },
      { run: vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: 'x'.repeat(3_000) }), delayMs: 0 },
    );

    const deliver = vi.fn().mockResolvedValue(undefined);
    await handoff.deliverResult(deliver);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed', error: 'x'.repeat(2_000),
    }));
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
});
