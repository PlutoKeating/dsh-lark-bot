import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runServiceRuntime } from '../../../src/cli/commands/service-run.js';
import { resolveAppPaths } from '../../../src/config/app-paths.js';
import { writeServiceEnv } from '../../../src/service/env-snapshot.js';

describe('runServiceRuntime', () => {
  it('loads the private snapshot and launches the canonical dsh profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-service-run-'));
    const paths = resolveAppPaths(root);
    await writeServiceEnv(paths.serviceEnvFile('work'), {
      DSH_LARK_MODEL: 'gateway/model-a',
      PROVIDER_TOKEN: 'secret',
    });
    const child = new EventEmitter() as EventEmitter & {
      killed: boolean;
      kill: ReturnType<typeof vi.fn>;
    };
    child.killed = false;
    child.kill = vi.fn();
    const spawn = vi.fn().mockImplementation(() => {
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    });
    const previousExitCode = process.exitCode;
    try {
      await runServiceRuntime({ profile: 'work' }, {
        paths,
        dshBin: '/opt/dsh.js',
        env: { PATH: '/usr/bin' },
        spawn: spawn as never,
      });
      expect(spawn).toHaveBeenCalledWith(
        process.execPath,
        ['/opt/dsh.js', '--profile', 'work'],
        expect.objectContaining({
          stdio: 'inherit',
          env: expect.objectContaining({ PROVIDER_TOKEN: 'secret' }),
        }),
      );
    } finally {
      process.exitCode = previousExitCode;
      await rm(root, { recursive: true, force: true });
    }
  });
});
