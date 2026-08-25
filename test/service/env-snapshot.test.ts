import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatEnvFile,
  parseEnvFile,
  snapshotServiceEnv,
  writeServiceEnv,
  secureWindowsServiceEnv,
} from '../../src/service/env-snapshot.js';

// sanitizeServicePath prepends the Node binary directory so the service always
// resolves node/pnpm from a stable location.
const NODE_BIN_DIR = dirname(process.execPath);

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
      PATH: `${NODE_BIN_DIR}:/usr/local/bin:/usr/bin`,
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

  it('preserves existing managed values unless the current shell overrides them', () => {
    const env = snapshotServiceEnv(
      { DSH_LARK_MODEL: 'shell-model', PATH: '/usr/bin' },
      [],
      {
        DSH_LARK_PROVIDER: 'deepseek-official',
        DSH_LARK_MODEL: 'saved-model',
        UNRELATED_SECRET: 'do-not-retain',
      },
    );

    expect(env).toEqual({
      DSH_LARK_PROVIDER: 'deepseek-official',
      DSH_LARK_MODEL: 'shell-model',
      PATH: `${NODE_BIN_DIR}:/usr/bin`,
    });
  });

  it('does not persist bridge callback secrets or update-worker internals', () => {
    const env = snapshotServiceEnv({
      DSH_LARK_ADAPTER: 'sdk',
      DSH_LARK_NOTIFY_URL: 'http://127.0.0.1:1234/notify',
      DSH_LARK_ASK_URL: 'http://127.0.0.1:1234/ask',
      DSH_LARK_NOTIFY_TOKEN: 'ephemeral-secret',
      DSH_LARK_UPDATE_WORKER: '1',
    });
    expect(env).toEqual({ DSH_LARK_ADAPTER: 'sdk' });
  });

  it('keeps the stable inherited PATH when restarted by an update worker', () => {
    const env = snapshotServiceEnv(
      { DSH_LARK_UPDATE_WORKER: '1', PATH: '/tmp/update-worker/node_modules/.bin:/usr/bin' },
      [],
      { PATH: '/home/user/.local/bin:/usr/bin', DSH_LARK_MODEL: 'saved-model' },
    );
    expect(env).toEqual({
      PATH: `${NODE_BIN_DIR}:/home/user/.local/bin:/usr/bin`,
      DSH_LARK_MODEL: 'saved-model',
    });
  });

  it('strips npx / node_modules/.bin from the snapshotted PATH (issue #111)', () => {
    const env = snapshotServiceEnv({
      PATH: [
        '/home/user/.npm/_npx/abc123/node_modules/.bin',
        '/home/user/proj/node_modules/.bin',
        '/home/user/.local/bin',
        '/usr/bin',
      ].join(':'),
    });
    expect(env.PATH).toBe(`${NODE_BIN_DIR}:/home/user/.local/bin:/usr/bin`);
    expect(env.PATH).not.toContain('_npx');
    expect(env.PATH).not.toContain('node_modules/.bin');
  });

  it('de-duplicates repeated PATH entries', () => {
    const env = snapshotServiceEnv({
      PATH: '/usr/bin:/home/user/.local/bin:/usr/bin:/usr/local/bin',
    });
    const entries = env.PATH!.split(':');
    expect(new Set(entries).size).toBe(entries.length);
    expect(entries.filter((entry) => entry === '/usr/bin')).toHaveLength(1);
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
