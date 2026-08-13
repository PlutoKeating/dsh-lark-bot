import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDoctor } from '../../../src/cli/commands/doctor.js';
import { ConfigStore } from '../../../src/config/profile-store.js';

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.DSH_LARK_HOME;
  delete process.env.DSH_LARK_DSH_COMMAND;
  delete process.env.DSH_LARK_DSH_ARGS;
  process.exitCode = 0;
});

describe('runDoctor', () => {
  it('reports an existing profile and local dsh availability', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-doctor-'));
    process.env.DSH_LARK_HOME = root;
    process.env.DSH_LARK_DSH_COMMAND = 'node';
    const store = new ConfigStore(join(root, 'config.json'));
    await store.load();
    await store.saveProfile('default', {
      tenant: 'feishu',
      appId: 'cli_test',
      appSecret: 'secret',
      workspace: join(root, 'workspace'),
    });

    const outputChunks: string[] = [];
    try {
      await runDoctor({ version: 'test', output: (text) => outputChunks.push(text) });
    } finally {
      await rm(root, { recursive: true, force: true });
    }

    const output = outputChunks.join('');
    expect(output).toContain('config: ok');
    expect(output).toContain('app_secret=present');
    expect(output).toContain('dsh: ok');
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('marks missing profiles as a critical diagnostic', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-doctor-empty-'));
    process.env.DSH_LARK_HOME = root;
    process.env.DSH_LARK_DSH_COMMAND = 'node';
    const outputChunks: string[] = [];

    try {
      await runDoctor({ version: 'test', output: (text) => outputChunks.push(text) });
    } finally {
      await rm(root, { recursive: true, force: true });
    }

    expect(process.exitCode).toBe(1);
  });
});
