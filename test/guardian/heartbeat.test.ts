import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  channelHealthLabel,
  isHeartbeatFresh,
  readHeartbeat,
  startHeartbeat,
} from '../../src/guardian/heartbeat.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('guardian heartbeat', () => {
  it('writes a fresh heartbeat and reports staleness', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-heartbeat-'));
    tempDirs.push(dir);
    const file = join(dir, 'heartbeat.json');
    const handle = startHeartbeat(file, 4242, 20);
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      const payload = await readHeartbeat(file);
      expect(payload?.pid).toBe(4242);
      expect(typeof payload?.startedAt).toBe('string');
      expect(isHeartbeatFresh(payload, 10_000)).toBe(true);
      expect(isHeartbeatFresh(payload, 0)).toBe(false);
    } finally {
      handle.stop();
    }
  });

  it('treats a missing heartbeat as not fresh', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-heartbeat-missing-'));
    tempDirs.push(dir);
    const file = join(dir, 'missing.json');
    expect(await readHeartbeat(file)).toBeUndefined();
    expect(isHeartbeatFresh(undefined, 10_000)).toBe(false);
  });

  it('embeds and reads back the channel readiness snapshot (issue #108)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-heartbeat-channel-'));
    tempDirs.push(dir);
    const file = join(dir, 'heartbeat.json');
    const channel = {
      state: 'reconnecting',
      ready: false,
      generation: 3,
      reconnectAttempts: 2,
      lastError: 'pong timeout',
    };
    const handle = startHeartbeat(file, 4242, 20, () => channel);
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      const payload = await readHeartbeat(file);
      expect(payload?.pid).toBe(4242);
      expect(payload?.channel).toMatchObject({ state: 'reconnecting', ready: false });
      expect(payload?.channel?.generation).toBe(3);
    } finally {
      handle.stop();
    }
  });

  it('renders a compact channel-health label', () => {
    expect(channelHealthLabel(undefined)).toBe('未上报');
    expect(channelHealthLabel({ state: 'ready', ready: true, generation: 7 })).toContain('ready');
    expect(channelHealthLabel({ state: 'reconnecting', ready: false, reconnectAttempts: 4 }))
      .toContain('reconnecting');
    expect(channelHealthLabel({ state: 'failed', ready: false })).toBe('failed');
  });
});
