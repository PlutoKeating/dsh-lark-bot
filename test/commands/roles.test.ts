import { describe, expect, it, vi } from 'vitest';
import type { AccessManager } from '../../src/config/access-manager.js';
import { RoleStore } from '../../src/bot/role-store.js';
import { ScopeDirectory } from '../../src/bridge/scope-directory.js';
import { tryHandleCommand, type CommandContext } from '../../src/commands/index.js';
import { ActiveRuns } from '../../src/bot/active-runs.js';
import { ConcurrencyStore } from '../../src/bot/concurrency-store.js';
import { ModelStore } from '../../src/bot/model-store.js';
import { WizardStore } from '../../src/bot/wizard-store.js';
import { RetentionStore } from '../../src/bot/retention-store.js';
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
    wizardStore: new WizardStore(),
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

describe('role slash commands', () => {
  it('creates, binds, shows and lists roles', async () => {
    const ctx = await makeContext();
    await tryHandleCommand(
      '/role save pm PM --persona You are the product manager. --model deepseek-v4-pro --tools fs,search --rules 1. Protect scope.',
      ctx,
    );
    expect(ctx.roleStore.get('pm')?.name).toBe('PM');
    expect(ctx.roleStore.get('pm')?.persona).toBe('You are the product manager.');
    expect(ctx.roleStore.get('pm')?.model).toBe('deepseek-v4-pro');
    expect(ctx.roleStore.get('pm')?.tools).toBe('fs,search');
    expect(ctx.roleStore.get('pm')?.agentsMd).toBe('1. Protect scope.');

    await tryHandleCommand('/role set pm', ctx);
    expect(ctx.roleStore.roleForScope('chat-a')?.id).toBe('pm');

    await tryHandleCommand('/role show pm', ctx);
    await tryHandleCommand('/role list', ctx);
    const calls = (ctx.channel.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((call) => (call[1] as string).includes('Product Manager'))).toBe(false);
    expect(calls.some((call) => (call[1] as string).includes('You are the product manager.'))).toBe(true);
    expect(calls.some((call) => (call[1] as string).includes('← 当前 scope'))).toBe(true);
  });

  it('gates role mutation commands to admins', async () => {
    const accessManager = {
      isAdmin: (id: string | undefined) => id === 'ou_real_admin',
      snapshot: () => ({ admins: ['ou_real_admin'], allowedUsers: [], allowedChats: [] }),
    } as unknown as AccessManager;
    const ctx = await makeContext({ senderId: 'ou_guest', accessManager });
    await tryHandleCommand('/role save evil Hacker --persona pwn', ctx);
    expect(ctx.roleStore.get('evil')).toBeUndefined();
    const calls = (ctx.channel.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls;
    expect((calls[0]?.[1] as string) ?? '').toContain('仅管理员');
  });

  it('clears and removes roles', async () => {
    const ctx = await makeContext();
    await tryHandleCommand('/role save dev Dev --persona Write code.', ctx);
    await tryHandleCommand('/role set dev', ctx);
    await tryHandleCommand('/role clear', ctx);
    expect(ctx.roleStore.roleForScope('chat-a')).toBeUndefined();
    await tryHandleCommand('/role remove dev', ctx);
    expect(ctx.roleStore.get('dev')).toBeUndefined();
  });
});
