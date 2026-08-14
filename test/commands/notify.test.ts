import { describe, expect, it, vi } from 'vitest';
import type { AccessManager } from '../../src/config/access-manager.js';
import { ScopeDirectory } from '../../src/bridge/scope-directory.js';
import { tryHandleCommand, type CommandContext } from '../../src/commands/index.js';
import { ActiveRuns } from '../../src/bot/active-runs.js';
import { ConcurrencyStore } from '../../src/bot/concurrency-store.js';
import { ModelStore } from '../../src/bot/model-store.js';
import { RetentionStore } from '../../src/bot/retention-store.js';
import { RoleStore } from '../../src/bot/role-store.js';
import { RunPolicyStore } from '../../src/bot/run-policy.js';
import { AccessManager as RealAccessManager } from '../../src/config/access-manager.js';
import { DshProviderManager } from '../../src/config/dsh-config.js';
import { ConfigStore } from '../../src/config/profile-store.js';
import { SessionStore } from '../../src/session/store.js';
import { WorkspaceStore } from '../../src/workspace/store.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function makeContext(overrides: Partial<CommandContext> = {}): Promise<CommandContext> {
  const configStore = new ConfigStore(':memory:');
  await configStore.load();
  await configStore.saveProfile('default', {
    tenant: 'feishu',
    appId: 'cli_test',
    appSecret: 'secret',
    access: { admins: ['ou_admin'], allowedUsers: ['ou_admin'], allowedChats: [] },
  });
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
    roleStore: new RoleStore(':memory:'),
    scopeDirectory: new ScopeDirectory(':memory:'),
    archiver: {
      archive: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      prune: vi.fn().mockResolvedValue(0),
    } as unknown as CommandContext['archiver'],
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
    senderId: 'ou_admin',
    accessManager: new RealAccessManager(configStore, 'default'),
    channel: {
      sendMarkdown: vi.fn().mockResolvedValue(undefined),
    } as unknown as CommandContext['channel'],
    defaultWorkspace: '/tmp/default',
    ...overrides,
  };
}

describe('notify slash commands', () => {
  it('sends a cross-scope notification to a known scope', async () => {
    const ctx = await makeContext();
    ctx.scopeDirectory.register('chat-b', 'oc_group_b', undefined);
    await tryHandleCommand('/notify chat-b 任务完成，请 review', ctx);

    expect(ctx.channel.sendMarkdown).toHaveBeenCalledWith('oc_group_b', '任务完成，请 review', {});
    expect(ctx.channel.sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('已发送通知'),
      { replyTo: 'msg-1' },
    );
  });

  it('lists registered scopes and gates sends to admins', async () => {
    const accessManager = {
      isAdmin: (id: string | undefined) => id === 'ou_real_admin',
      snapshot: () => ({ admins: ['ou_real_admin'], allowedUsers: [], allowedChats: [] }),
    } as unknown as AccessManager;
    const ctx = await makeContext({ senderId: 'ou_guest', accessManager });
    await tryHandleCommand('/notify chat-b hi', ctx);
    expect(ctx.channel.sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('仅管理员'),
      { replyTo: 'msg-1' },
    );

    const adminCtx = await makeContext();
    adminCtx.scopeDirectory.register('chat-b', 'oc_group_b', undefined);
    await tryHandleCommand('/notify list', adminCtx);
    const calls = (adminCtx.channel.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((call) => (call[1] as string).includes('chat-b'))).toBe(true);
  });
});
