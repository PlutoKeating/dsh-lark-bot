import { describe, expect, it, vi } from 'vitest';
import { ActiveRuns } from '../../src/bot/active-runs.js';
import { RunPolicyStore } from '../../src/bot/run-policy.js';
import { AccessManager } from '../../src/config/access-manager.js';
import { ConfigStore } from '../../src/config/profile-store.js';
import {
  tryHandleCommand,
  type CommandChannel,
  type CommandContext,
} from '../../src/commands/index.js';
import { SessionStore } from '../../src/session/store.js';
import { WorkspaceStore } from '../../src/workspace/store.js';

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
    defaultRunTimeoutMs: 300_000,
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
});
