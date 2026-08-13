import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkspaceStore } from '../../src/workspace/store.js';

describe('WorkspaceStore', () => {
  it('persists per-scope cwd and named workspaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-workspace-'));
    const path = join(root, 'workspaces.json');

    try {
      const store = new WorkspaceStore(path);
      store.setCwd('chat-a', '/tmp/project-a');
      store.saveNamed('api', '/tmp/project-api');
      await store.flush();

      const reloaded = new WorkspaceStore(path);
      await reloaded.load();

      expect(reloaded.cwdFor('chat-a')).toBe('/tmp/project-a');
      expect(reloaded.getNamed('api')).toBe('/tmp/project-api');
      expect(reloaded.listIndex()).toHaveLength(1);
      expect(reloaded.listIndex()[0]?.name).toBe('api');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
