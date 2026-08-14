import { describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActiveRuns } from '../../src/bot/active-runs.js';
import { ConcurrencyStore } from '../../src/bot/concurrency-store.js';
import { ModelStore } from '../../src/bot/model-store.js';
import { RetentionStore } from '../../src/bot/retention-store.js';
import { RunPolicyStore } from '../../src/bot/run-policy.js';
import { AccessManager } from '../../src/config/access-manager.js';
import { DshProviderManager } from '../../src/config/dsh-config.js';
import { ConfigStore } from '../../src/config/profile-store.js';
import {
  tryHandleCommand,
  type CommandChannel,
  type CommandContext,
} from '../../src/commands/index.js';
import { SessionStore } from '../../src/session/store.js';
import type { SessionArchive } from '../../src/session/archive.js';
import { WorkspaceStore } from '../../src/workspace/store.js';

function makeArchiver(): SessionArchive {
  return {
    archive: vi.fn().mockResolvedValue({
      archiveId: 'archive-1',
      scope: 'chat-a',
      cwd: '/tmp/default',
      source: 'manual',
      note: undefined,
      messageCount: 0,
      archivedAt: new Date().toISOString(),
      jsonlPath: '/tmp/a.jsonl',
      markdownPath: '/tmp/a.md',
      gitCommit: undefined,
    }),
    list: vi.fn().mockResolvedValue([]),
    prune: vi.fn().mockResolvedValue(0),
  } as unknown as SessionArchive;
}

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    scope: 'chat-a',
    chatId: 'chat-a',
    messageId: 'msg-1',
    threadId: undefined,
    chatMode: 'p2p',
    sessions: new SessionStore(':memory:'),
    workspaces: new WorkspaceStore(':memory:'),
    activeRuns: new ActiveRuns(),
    runPolicies: new RunPolicyStore(),
    concurrencyStore: new ConcurrencyStore(),
    defaultScopeConcurrency: 2,
    retentionStore: new RetentionStore(),
    archiver: makeArchiver(),
    defaultRetention: 40,
    archiveMax: 50,
    archiveMaxAgeDays: 90,
    approvals: undefined,
    questions: undefined,
    densityStore: undefined,
    models: new ModelStore(),
    dshConfig: new DshProviderManager({
      home: join(tmpdir(), 'dsh-lark-bot-test-home'),
    }),
    defaultRunTimeoutMs: 300_000,
    defaultModel: 'deepseek-v4-flash',
    senderId: undefined,
    accessManager: new AccessManager(
      new ConfigStore(':memory:'),
      'default',
    ),
    channel: {
      sendMarkdown: vi.fn().mockResolvedValue(undefined),
    } as unknown as CommandChannel,
    defaultWorkspace: '/tmp/default',
    ...overrides,
  };
}

describe('command router', () => {
  it('routes /cd and updates the workspace', async () => {
    const ctx = makeContext();
    const handled = await tryHandleCommand('/cd /tmp/project', ctx);

    expect(handled).toBe(true);
    expect(ctx.workspaces.cwdFor('chat-a')).toBe('/tmp/project');
    expect(ctx.channel.sendMarkdown).toHaveBeenCalled();
  });

  it('leaves non-command text untouched', async () => {
    const ctx = makeContext();
    await expect(tryHandleCommand('fix the bug', ctx)).resolves.toBe(false);
    expect(ctx.channel.sendMarkdown).not.toHaveBeenCalled();
  });

  it('reads and updates the per-scope run timeout policy', async () => {
    const ctx = makeContext();

    await tryHandleCommand('/timeout 12', ctx);
    expect(ctx.runPolicies.get('chat-a')).toBe(12 * 60_000);

    await tryHandleCommand('/timeout off', ctx);
    expect(ctx.runPolicies.get('chat-a')).toBe(0);

    await tryHandleCommand('/timeout default', ctx);
    expect(ctx.runPolicies.get('chat-a')).toBeUndefined();
  });

  it('shows recent conversation context for /resume', async () => {
    const ctx = makeContext();
    ctx.sessions.recordExchange('chat-a', '/tmp/default', ['hello'], 'hi!');

    await tryHandleCommand('/resume', ctx);

    expect(ctx.channel.sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('👤 hello'),
      { replyTo: 'msg-1' },
    );
  });

  it('lists the current access allowlist', async () => {
    const ctx = makeContext({
      accessManager: {
        snapshot: () => ({
          allowedUsers: ['ou_owner'],
          allowedChats: ['oc_room'],
          admins: ['ou_owner'],
        }),
      } as unknown as AccessManager,
    });

    await tryHandleCommand('/invite list', ctx);

    expect(ctx.channel.sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('ou_owner'),
      { replyTo: 'msg-1' },
    );
  });

  it('answers /help with the command index including the model/provider commands', async () => {
    const ctx = makeContext();

    const handled = await tryHandleCommand('/help', ctx);

    expect(handled).toBe(true);
    const call = (ctx.channel.sendMarkdown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(call?.[0]).toBe('chat-a');
    const body = call?.[1] as string;
    expect(body).toContain('/model');
    expect(body).toContain('/providers');
    expect(body).toContain('/provider');
    expect(body).toContain('/key');
    expect(body).toContain('/help');
  });
});
