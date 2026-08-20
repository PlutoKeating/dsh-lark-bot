import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatEnvFile,
  parseEnvFile,
  snapshotServiceEnv,
  writeServiceEnv,
  secureWindowsServiceEnv,
} from '../../src/service/env-snapshot.js';

describe('snapshotServiceEnv', () => {
  it('captures DSH_LARK_* variables and essential runtime keys', () => {
    const env = snapshotServiceEnv({
      DSH_LARK_ADAPTER: 'sdk',
      DSH_LARK_MODEL: 'deepseek-v4-flash',
      DEEPSEEK_API_KEY: 'sk-test-secret',
      PATH: '/usr/local/bin:/usr/bin',
      HOME: '/home/user',
      DSH_HOME: '/home/user/.dsh',
      UNRELATED: 'ignored',
    });

    expect(env).toEqual({
      DSH_LARK_ADAPTER: 'sdk',
      DSH_LARK_MODEL: 'deepseek-v4-flash',
      DEEPSEEK_API_KEY: 'sk-test-secret',
      PATH: '/usr/local/bin:/usr/bin',
      HOME: '/home/user',
      DSH_HOME: '/home/user/.dsh',
    });
  });

  it('captures configured provider credential keys without broad env leakage', () => {
    const env = snapshotServiceEnv(
      { CUSTOM_PROVIDER_TOKEN: 'secret', UNRELATED_SECRET: 'nope' },
      ['CUSTOM_PROVIDER_TOKEN'],
    );
    expect(env).toEqual({ CUSTOM_PROVIDER_TOKEN: 'secret' });
  });
});

describe('writeServiceEnv', () => {
  it('writes credential snapshots with owner-only permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-service-env-'));
    const file = join(root, 'service.env');
    try {
      await writeServiceEnv(file, { PROVIDER_TOKEN: 'secret' });
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('replaces inherited Windows ACLs with current-user access', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    await secureWindowsServiceEnv(
      'C:\\Users\\me\\.dsh-lark\\service\\default.env',
      async (command, args) => {
        calls.push({ command, args: [...args] });
        if (command === 'whoami.exe') {
          return { code: 0, stdout: '"WORKSTATION\\me","S-1-5-21-123-456-789-1001"\r\n', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    );
    expect(calls).toEqual([
      { command: 'whoami.exe', args: ['/user', '/fo', 'csv', '/nh'] },
      {
        command: 'icacls.exe',
        args: expect.arrayContaining(['/inheritance:r', '/grant:r', '*S-1-5-21-123-456-789-1001:(F)']),
      },
    ]);
  });

  it('fails closed when the current Windows token SID cannot be resolved', async () => {
    await expect(secureWindowsServiceEnv('C:\\service.env', async () => ({
      code: 0,
      stdout: 'unexpected output',
      stderr: '',
    }))).rejects.toThrow(/token SID/);
  });
});

describe('formatEnvFile / parseEnvFile', () => {
  it('round-trips values containing spaces, quotes and backslashes', () => {
    const env = {
      PATH: '/home/user/.local/share/pnpm:/usr/bin',
      DSH_LARK_MODEL: 'deepseek-v4-flash',
      DSH_LARK_WORKSPACE: 'C:\\Users\\name with spaces',
    };
    const parsed = parseEnvFile(formatEnvFile(env));
    expect(parsed).toEqual(env);
  });

  it('rejects newlines in values', () => {
    expect(() => formatEnvFile({ DSH_LARK_MODEL: 'a\nb' })).toThrow(/newline/);
  });
});
