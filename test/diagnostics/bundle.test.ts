import { describe, expect, it } from 'vitest';
import { createDiagnosticBundle } from '../../src/diagnostics/bundle.js';

describe('createDiagnosticBundle', () => {
  it('redacts common and runtime-known secrets while preserving useful state', () => {
    const bundle = createDiagnosticBundle({
      generatedAt: new Date('2026-08-20T01:02:03.000Z'),
      version: '0.15.9',
      node: 'v22.19.0',
      platform: 'linux/x64',
      profile: 'default',
      dshProfile: 'dsh-lark',
      tenant: 'feishu',
      adapter: 'dsh-sdk',
      config: {
        credentialsConfigured: true,
        allowedUsers: 1,
        allowedChats: 2,
        admins: 1,
        groupNoAt: false,
      },
      request: {
        scope: 'chat-a',
        chatMode: 'p2p',
        workspace: '/home/alice/project',
        model: 'gateway/model-a',
        sessionId: 'session-a',
        activeRunIds: ['run-a'],
        pending: { approvals: 1, questions: 0, plans: 0 },
        jobs: { queued: 1, running: 0, completed: 2, failed: 0, interrupted: 0 },
      },
      service: { installed: true, state: 'running', platform: 'linux-systemd' },
      runtimeLogs: [JSON.stringify({
        time: '2026-08-20T00:59:00.000Z',
        level: 'warn',
        category: 'run-flow',
        event: 'checkpoint-failed',
        fields: {
          message: 'Bearer secret-token-value',
          custom: 'api_key=my-secret-value',
          durationMs: 42,
        },
      })],
      knownSecrets: ['super-secret-value'],
      homeDir: '/home/alice',
    });
    const text = bundle.content.toString('utf8');

    expect(bundle.fileName).toBe('dsh-lark-diagnostic-20260820T010203Z.md');
    expect(text).toContain('version: `0.15.9`');
    expect(text).toContain('workspace: `~/project`');
    expect(text).toContain('active runs: `run-a`');
    expect(text).not.toContain('secret-token-value');
    expect(text).not.toContain('my-secret-value');
    expect(text).not.toContain('super-secret-value');
    expect(text).toContain('"durationMs":42');
  });

  it('caps log payloads by UTF-8 bytes and keeps the newest entries', () => {
    const bundle = createDiagnosticBundle({
      generatedAt: new Date('2026-08-20T01:02:03.000Z'),
      version: '1.0.0',
      node: 'v22',
      platform: 'linux/x64',
      profile: 'default',
      dshProfile: 'dsh-lark',
      tenant: 'feishu',
      adapter: 'dsh-sdk',
      config: { credentialsConfigured: true, allowedUsers: 0, allowedChats: 0, admins: 1, groupNoAt: false },
      request: {
        scope: 'chat-a', chatMode: 'p2p', workspace: '/tmp', model: 'm',
        activeRunIds: [], pending: { approvals: 0, questions: 0, plans: 0 },
      },
      runtimeLogs: Array.from({ length: 3_000 }, (_, seq) => JSON.stringify({
        time: '2026-08-20T00:59:00.000Z',
        level: 'info',
        category: 'diagnostic-test',
        event: 'tick',
        fields: { count: seq },
      })),
    });
    const text = bundle.content.toString('utf8');

    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(80 * 1024);
    expect(text).toContain('[older log lines omitted]');
    expect(text).toContain('"count":2999');
  });

});
