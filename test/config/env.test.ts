import { describe, expect, it } from 'vitest';
import { loadRuntimeEnv } from '../../src/config/env.js';

describe('loadRuntimeEnv', () => {
  it('uses safe defaults', () => {
    const env = loadRuntimeEnv({});

    expect(env.home.endsWith('.dsh-lark')).toBe(true);
    expect(env.tenant).toBe('feishu');
    expect(env.dshCommand).toBe('node');
    expect(env.dshArgs).toEqual(['lib/bin.js', 'cordis.yml']);
    expect(env.provider).toBe('deepseek-official');
    expect(env.model).toBe('deepseek-v4-flash');
    expect(env.runTimeoutMs).toBe(300_000);
  });

  it('parses explicit command args and tenant', () => {
    const env = loadRuntimeEnv({
      DSH_LARK_TENANT: 'lark',
      DSH_LARK_DSH_ARGS: 'dist/bin.js, agent.cordis.yml',
      DSH_LARK_RUN_TIMEOUT_MS: '120000',
    });

    expect(env.tenant).toBe('lark');
    expect(env.dshArgs).toEqual(['dist/bin.js', 'agent.cordis.yml']);
    expect(env.runTimeoutMs).toBe(120_000);
  });

  it('rejects invalid tenant and timeout values', () => {
    expect(() => loadRuntimeEnv({ DSH_LARK_TENANT: 'invalid' })).toThrow(
      /DSH_LARK_TENANT/,
    );
    expect(() => loadRuntimeEnv({ DSH_LARK_RUN_TIMEOUT_MS: '-1' })).toThrow(
      /DSH_LARK_RUN_TIMEOUT_MS/,
    );
  });
});
