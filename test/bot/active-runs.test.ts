import { describe, expect, it, vi } from 'vitest';
import { ActiveRuns } from '../../src/bot/active-runs.js';

describe('ActiveRuns', () => {
  it('tracks and interrupts scoped runs', async () => {
    const runs = new ActiveRuns();
    const stop = vi.fn().mockResolvedValue(undefined);

    runs.set('chat-a', { runId: 'run-1', stop });
    expect(runs.get('chat-a')?.runId).toBe('run-1');

    await expect(runs.interrupt('chat-a')).resolves.toBe(true);
    expect(stop).toHaveBeenCalledOnce();
    expect(runs.get('chat-a')).toBeUndefined();
  });
});
