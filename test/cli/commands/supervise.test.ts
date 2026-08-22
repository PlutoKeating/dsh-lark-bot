import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runSupervise } from '../../../src/cli/commands/supervise.js';
import { resolveAppPaths } from '../../../src/config/app-paths.js';
import { writeServiceEnv } from '../../../src/service/env-snapshot.js';

describe('runSupervise', () => {
  it('escalates a hung dsh child from SIGTERM to SIGKILL before exiting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervise-'));
    const paths = resolveAppPaths(root);
    const envFile = paths.serviceEnvFile('work');
    await writeServiceEnv(envFile, { DSH_LARK_HOME: root });
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      kill: ReturnType<typeof vi.fn>;
    };
    child.pid = 777;
    child.kill = vi.fn().mockImplementation((signal: string) => {
      if (signal === 'SIGKILL') queueMicrotask(() => child.emit('exit', null, 'SIGKILL'));
      return true;
    });
    let markSpawned: (() => void) | undefined;
    const spawned = new Promise<void>((resolve) => {
      markSpawned = resolve;
    });
    const run = runSupervise(
      { profile: 'work', envFile },
      {
        dshBin: '/opt/dsh.js',
        childStopGraceMs: 5,
        spawn: vi.fn().mockImplementation(() => {
          markSpawned?.();
          return child;
        }) as never,
      },
    );
    await spawned;
    process.emit('SIGTERM');
    await run;
    expect(child.kill.mock.calls.map((call) => call[0])).toEqual(['SIGTERM', 'SIGKILL']);
    await rm(root, { recursive: true, force: true });
  });
});
