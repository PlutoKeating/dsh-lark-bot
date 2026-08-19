import { describe, expect, it, vi } from 'vitest';
import { ActiveRuns } from '../../src/bot/active-runs.js';

describe('ActiveRuns', () => {
  it('tracks multiple scoped runs and interrupts them all', async () => {
    const runs = new ActiveRuns();
    const stop1 = vi.fn().mockResolvedValue(undefined);
    const stop2 = vi.fn().mockResolvedValue(undefined);

    runs.set('chat-a', { runId: 'run-1', stop: stop1 });
    runs.set('chat-a', { runId: 'run-2', stop: stop2 });
    expect(runs.count('chat-a')).toBe(2);
    expect(runs.list('chat-a').map((run) => run.runId).sort()).toEqual(['run-1', 'run-2']);

    await expect(runs.interrupt('chat-a')).resolves.toBe(2);
    expect(stop1).toHaveBeenCalledOnce();
    expect(stop2).toHaveBeenCalledOnce();
    expect(runs.get('chat-a')).toBeUndefined();
    expect(runs.has('chat-a')).toBe(false);
  });

  it('interrupts a single run by id without touching the others', async () => {
    const runs = new ActiveRuns();
    const stop1 = vi.fn().mockResolvedValue(undefined);
    const stop2 = vi.fn().mockResolvedValue(undefined);

    runs.set('chat-a', { runId: 'run-1', stop: stop1 });
    runs.set('chat-a', { runId: 'run-2', stop: stop2 });

    await expect(runs.interruptRun('chat-a', 'run-1')).resolves.toBe(true);
    expect(stop1).toHaveBeenCalledOnce();
    expect(stop2).not.toHaveBeenCalled();
    expect(runs.count('chat-a')).toBe(1);
    expect(runs.get('chat-a')?.runId).toBe('run-2');

    expect(runs.delete('chat-a', 'run-2')).toBe(true);
    expect(runs.has('chat-a')).toBe(false);
  });

  it('interrupts only runs owned by the selected workspace', async () => {
    const runs = new ActiveRuns();
    const stopA = vi.fn().mockResolvedValue(undefined);
    const stopB = vi.fn().mockResolvedValue(undefined);
    runs.set('chat-a', { runId: 'run-a', workspaceCwd: '/tmp/a', stop: stopA });
    runs.set('chat-a', { runId: 'run-b', workspaceCwd: '/tmp/b', stop: stopB });

    await expect(runs.interruptWorkspace('chat-a', '/tmp/b')).resolves.toBe(1);
    expect(stopA).not.toHaveBeenCalled();
    expect(stopB).toHaveBeenCalledOnce();
    expect(runs.listWorkspace('chat-a', '/tmp/a').map((run) => run.runId)).toEqual(['run-a']);
  });
});
