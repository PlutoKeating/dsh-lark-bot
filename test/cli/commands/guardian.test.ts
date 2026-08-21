import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { statusGuardianCommand, runGuardian } from '../../../src/cli/commands/guardian.js';
import { newGuardianState, saveGuardianState } from '../../../src/guardian/state.js';

const tempDirs: string[] = [];
const originalEnv = { ...process.env };

afterEach(async () => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('guardian CLI commands', () => {
  it('prints guardian status from local state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-guardian-cli-'));
    tempDirs.push(dir);
    process.env.DSH_LARK_HOME = dir;
    await saveGuardianState(
      join(dir, 'guardian.json'),
      newGuardianState({ dshProfile: 'dsh-lark', bridgeProfile: 'default' }),
    );
    const heartbeatDir = join(dir, 'profiles', 'default', 'guardian');
    await mkdir(heartbeatDir, { recursive: true });
    await writeFile(join(heartbeatDir, 'heartbeat.json'), '{}', 'utf8');
    const stdout: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await statusGuardianCommand({});
      const output = stdout.join('');
      expect(output).toContain('dsh profile：dsh-lark');
      expect(output).toContain('安全 profile：dsh-lark-safe');
      expect(output).toContain('模式：standby');
      expect(output).toContain('守护进程 pid：未发现');
      expect(output).not.toContain(`守护进程 pid：${process.pid}`);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('runGuardian exits early when disabled by env', async () => {
    process.env.DSH_LARK_GUARDIAN_DISABLED = '1';
    const stdout: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await runGuardian({});
      expect(stdout.join('')).toContain('DSH_LARK_GUARDIAN_DISABLED');
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
