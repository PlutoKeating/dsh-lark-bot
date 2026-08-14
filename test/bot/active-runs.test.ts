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
});
