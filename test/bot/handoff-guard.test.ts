import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BotHandoffGuard } from '../../src/bot/handoff-guard.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('BotHandoffGuard', () => {
  it('counts globally across instances, deduplicates delivery and resets on any human message', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-handoff-'));
    roots.push(root);
    const path = join(root, 'handoffs.json');
    const a = new BotHandoffGuard(path);
    const b = new BotHandoffGuard(path);

    expect(await a.recordBot('chat-1', 'm1', 2)).toEqual({ allowed: true, firstTrip: false, count: 1 });
    expect(await b.recordBot('chat-1', 'm1', 2)).toEqual({ allowed: true, firstTrip: false, count: 1 });
    expect(await b.recordBot('chat-1', 'm2', 2)).toEqual({ allowed: true, firstTrip: false, count: 2 });
    expect(await a.recordBot('chat-1', 'm3', 2)).toEqual({ allowed: false, firstTrip: true, count: 3 });
    expect(await b.recordBot('chat-1', 'm4', 2)).toEqual({ allowed: false, firstTrip: false, count: 4 });

    await a.recordHuman('chat-1');
    expect(await b.recordBot('chat-1', 'm5', 2)).toEqual({ allowed: true, firstTrip: false, count: 1 });
  });
});
