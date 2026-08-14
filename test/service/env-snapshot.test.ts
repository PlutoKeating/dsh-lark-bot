import { describe, expect, it } from 'vitest';
import {
  formatEnvFile,
  parseEnvFile,
  snapshotServiceEnv,
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
