import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_REPLY_POLICY, ReplyPolicyStore } from '../../src/bot/reply-policy-store.js';

describe('ReplyPolicyStore', () => {
  it('persists a scope policy with owner-only permissions and reloads it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reply-policy-'));
    const path = join(dir, 'policies.json');
    const store = new ReplyPolicyStore(path);
    await store.set('chat-a', { mergeWindowMs: 5_000, maxBatchSize: 3, minIntervalMs: 10_000, dedupeWindowMs: 60_000 });
    const reloaded = new ReplyPolicyStore(path);
    await reloaded.load();
    expect(reloaded.get('chat-a')).toEqual({ mergeWindowMs: 5_000, maxBatchSize: 3, minIntervalMs: 10_000, dedupeWindowMs: 60_000 });
    await expect((await import('node:fs/promises')).stat(path).then((value) => value.mode & 0o777)).resolves.toBe(0o600);
    expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).toBe(1);
  });

  it('returns the compatibility default and rolls memory back after persistence failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reply-policy-'));
    const parent = join(dir, 'target');
    const path = join(parent, 'policies.json');
    const store = new ReplyPolicyStore(path);
    await store.load();
    await writeFile(parent, 'not a directory');
    await expect(store.set('chat-a', { ...DEFAULT_REPLY_POLICY, mergeWindowMs: 1_000 })).rejects.toThrow();
    expect(store.get('chat-a')).toEqual(DEFAULT_REPLY_POLICY);
  });
});
