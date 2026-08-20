import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExecutionModeStore } from '../../src/bot/execution-mode-store.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('ExecutionModeStore', () => {
  it('persists per-scope modes with balanced as the default', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-mode-'));
    tempDirs.push(dir);
    const path = join(dir, 'execution-modes.json');
    const store = new ExecutionModeStore(path);
    await store.load();

    expect(store.get('chat-a')).toBe('balanced');
    await store.set('chat-a', 'deep');
    await store.set('chat-b', 'quick');

    const restored = new ExecutionModeStore(path);
    await restored.load();
    expect(restored.get('chat-a')).toBe('deep');
    expect(restored.get('chat-b')).toBe('quick');
    expect((await readFile(path, 'utf8')).endsWith('\n')).toBe(true);
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    await restored.set('chat-a', 'balanced');
    const reset = new ExecutionModeStore(path);
    await reset.load();
    expect(reset.get('chat-a')).toBe('balanced');
  });

  it('rolls back the in-memory selection when durable persistence fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-mode-failure-'));
    tempDirs.push(dir);
    const blocked = join(dir, 'blocked');
    await writeFile(blocked, 'not a directory');
    const store = new ExecutionModeStore(join(blocked, 'execution-modes.json'));

    await expect(store.set('chat-a', 'deep')).rejects.toBeTruthy();
    expect(store.get('chat-a')).toBe('balanced');
  });
});
