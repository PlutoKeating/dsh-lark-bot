import { describe, expect, it } from 'vitest';
import { loadRuntimeEnv } from '../../src/config/env.js';

describe('loadRuntimeEnv', () => {
  it('uses safe defaults', () => {
    const env = loadRuntimeEnv({
      DSH_LARK_DSH_COMMAND: 'node',
      DSH_LARK_DSH_ARGS: 'lib/bin.js,cordis.yml',
    });

    expect(env.home.endsWith('.dsh-lark')).toBe(true);
    expect(env.tenant).toBe('feishu');
    expect(env.dshCommand).toBe('node');
    expect(env.dshArgs).toEqual(['lib/bin.js', 'cordis.yml']);
    expect(env.provider).toBe('deepseek-official');
    expect(env.model).toBe('deepseek-v4-flash');
    expect(env.runTimeoutMs).toBe(300_000);
    expect(env.stopGraceMs).toBe(5_000);
    expect(env.groupNoAt).toBe(false);
    expect(env.groupPollMs).toBe(3_000);
    expect(env.botHandoffMax).toBe(6);
    expect(env.notificationDefault).toBe('off');
    expect(env.sessionProjectionEnabled).toBe(true);
    expect(env.sessionBackfillMessages).toBe(20);
    expect(env.sessionBackfillBytes).toBe(64 * 1024);
    expect(env.sessionStreamUpdateMs).toBe(800);
    expect(env.heartbeatMs).toBe(5_000);
    expect(env.guardianDisabled).toBe(false);
    expect(env.guardianProfile).toBe('dsh-lark');
    expect(env.guardianBridgeProfile).toBe('default');
    expect(env.guardianPollMs).toBe(2_000);
    expect(env.guardianStaleMs).toBe(15_000);
    expect(env.guardianEngineDeadMs).toBe(120_000);
  });

  it('parses Web settings defaults for concurrency and notifications', () => {
    const env = loadRuntimeEnv({
      DSH_LARK_SCOPE_CONCURRENCY: '4',
      DSH_LARK_NOTIFICATION_DEFAULT: 'completed',
    });
    expect(env.scopeConcurrency).toBe(4);
    expect(env.notificationDefault).toBe('completed');
    expect(() => loadRuntimeEnv({ DSH_LARK_NOTIFICATION_DEFAULT: 'sometimes' })).toThrow(
      /DSH_LARK_NOTIFICATION_DEFAULT/,
    );
  });

  it('parses explicit command args and tenant', () => {
    const env = loadRuntimeEnv({
      DSH_LARK_TENANT: 'lark',
      DSH_LARK_DSH_ARGS: 'dist/bin.js, agent.cordis.yml',
      DSH_LARK_RUN_TIMEOUT_MS: '120000',
      DSH_LARK_STOP_GRACE_MS: '2000',
    });

    expect(env.tenant).toBe('lark');
    expect(env.dshArgs).toEqual(['dist/bin.js', 'agent.cordis.yml']);
    expect(env.runTimeoutMs).toBe(120_000);
    expect(env.stopGraceMs).toBe(2_000);
  });

  it('rejects invalid tenant and timeout values', () => {
    expect(() => loadRuntimeEnv({ DSH_LARK_TENANT: 'invalid' })).toThrow(
      /DSH_LARK_TENANT/,
    );
    expect(() => loadRuntimeEnv({ DSH_LARK_RUN_TIMEOUT_MS: '-1' })).toThrow(
      /DSH_LARK_RUN_TIMEOUT_MS/,
    );
    expect(() => loadRuntimeEnv({ DSH_LARK_STOP_GRACE_MS: 'invalid' })).toThrow(
      /DSH_LARK_STOP_GRACE_MS/,
    );
    expect(() => loadRuntimeEnv({ DSH_LARK_GUARDIAN_POLL_MS: '0' })).toThrow(
      /DSH_LARK_GUARDIAN_POLL_MS/,
    );
  });

  it('parses guardian tuning variables', () => {
    const env = loadRuntimeEnv({
      DSH_LARK_GUARDIAN_DISABLED: '1',
      DSH_LARK_GUARDIAN_PROFILE: 'demo',
      DSH_LARK_GUARDIAN_BRIDGE_PROFILE: 'bridge-a',
      DSH_LARK_GUARDIAN_POLL_MS: '3000',
      DSH_LARK_GUARDIAN_STALE_MS: '20000',
      DSH_LARK_GUARDIAN_ENGINE_DEAD_MS: '180000',
      DSH_LARK_HEARTBEAT_MS: '10000',
    });
    expect(env.guardianDisabled).toBe(true);
    expect(env.guardianProfile).toBe('demo');
    expect(env.guardianBridgeProfile).toBe('bridge-a');
    expect(env.guardianPollMs).toBe(3_000);
    expect(env.guardianStaleMs).toBe(20_000);
    expect(env.guardianEngineDeadMs).toBe(180_000);
    expect(env.heartbeatMs).toBe(10_000);
  });

  it('parses group no-at polling settings and rejects unsafe intervals', () => {
    const env = loadRuntimeEnv({
      DSH_LARK_GROUP_NO_AT: 'true',
      DSH_LARK_GROUP_POLL_MS: '5000',
    });
    expect(env.groupNoAt).toBe(true);
    expect(env.groupPollMs).toBe(5_000);
    expect(() => loadRuntimeEnv({ DSH_LARK_GROUP_POLL_MS: '999' })).toThrow(
      /DSH_LARK_GROUP_POLL_MS/,
    );
  });

  it('parses the trusted bot handoff limit and rejects an unsafe value', () => {
    expect(loadRuntimeEnv({ DSH_LARK_BOT_HANDOFF_MAX: '8' }).botHandoffMax).toBe(8);
    expect(() => loadRuntimeEnv({ DSH_LARK_BOT_HANDOFF_MAX: '1' })).toThrow(
      /DSH_LARK_BOT_HANDOFF_MAX/,
    );
  });

  it('parses session projection limits and honors the deprecated web-push disable alias', () => {
    const env = loadRuntimeEnv({
      DSH_LARK_SESSION_PROJECTION: '1',
      DSH_LARK_SESSION_BACKFILL_MESSAGES: '12',
      DSH_LARK_SESSION_BACKFILL_BYTES: '8192',
      DSH_LARK_SESSION_STREAM_UPDATE_MS: '1200',
    });
    expect(env.sessionProjectionEnabled).toBe(true);
    expect(env.sessionBackfillMessages).toBe(12);
    expect(env.sessionBackfillBytes).toBe(8192);
    expect(env.sessionStreamUpdateMs).toBe(1200);
    expect(loadRuntimeEnv({ DSH_LARK_WEB_PUSH: '0' }).sessionProjectionEnabled).toBe(false);
    expect(() => loadRuntimeEnv({ DSH_LARK_SESSION_STREAM_UPDATE_MS: '399' })).toThrow(
      /DSH_LARK_SESSION_STREAM_UPDATE_MS/,
    );
  });
});
