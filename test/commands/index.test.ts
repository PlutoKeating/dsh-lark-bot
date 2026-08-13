import { describe, expect, it, vi } from 'vitest';
import { ActiveRuns } from '../../src/bot/active-runs.js';
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
});
