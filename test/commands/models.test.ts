import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ModelStore } from '../../src/bot/model-store.js';
import { ConcurrencyStore } from '../../src/bot/concurrency-store.js';
import { RetentionStore } from '../../src/bot/retention-store.js';
import { RoleStore } from '../../src/bot/role-store.js';
import type { AccessManager } from '../../src/config/access-manager.js';
import { DshProviderManager } from '../../src/config/dsh-config.js';
import type { CommandChannel, CommandContext } from '../../src/commands/index.js';
import { handleKey, handleModel, handleProvider, handleProviders } from '../../src/commands/models.js';

function adminAccess(): AccessManager {
  return {
    snapshot: () => ({ admins: ['ou_admin'] }),
    isAdmin: (id: string | undefined) => id === 'ou_admin',
  } as unknown as AccessManager;
}

async function withContext(
  run: (ctx: CommandContext, root: string) => Promise<void>,
  overrides: { senderId?: string } = {},
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lark-models-'));
  const ctx: CommandContext = {
    scope: 'chat-a',
    chatId: 'chat-a',
    messageId: 'msg-1',
    threadId: undefined,
    chatMode: 'p2p',
    sessions: {} as CommandContext['sessions'],
    workspaces: {} as CommandContext['workspaces'],
    activeRuns: {} as CommandContext['activeRuns'],
    runPolicies: {} as CommandContext['runPolicies'],
    concurrencyStore: new ConcurrencyStore(),
    defaultScopeConcurrency: 2,
    retentionStore: new RetentionStore(),
    roleStore: new RoleStore(':memory:'),
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
    dshConfig: new DshProviderManager({ home: root, env: {} }),
    defaultRunTimeoutMs: 300_000,
    defaultModel: 'deepseek-v4-flash',
    senderId: overrides.senderId,
    accessManager: adminAccess(),
    channel: {
      sendMarkdown: vi.fn().mockResolvedValue(undefined),
    } as unknown as CommandChannel,
    defaultWorkspace: '/tmp/default',
  };
  try {
    await run(ctx, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function lastReply(ctx: CommandContext): string {
  const calls = (ctx.channel.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls;
  const last = calls[calls.length - 1]?.[1] as string;
  return last ?? '';
}

describe('model slash commands', () => {
  it('/model use hot-switches the scope override and /model reset clears it', async () => {
    await withContext(async (ctx) => {
      await handleModel('use deepseek-v4-pro', ctx);
      expect(ctx.models.get('chat-a')).toBe('deepseek-v4-pro');
      expect(lastReply(ctx)).toContain('已热切换');

      await handleModel('reset', ctx);
      expect(ctx.models.get('chat-a')).toBeUndefined();
      expect(lastReply(ctx)).toContain('已清除');
    });
  });

  it('/model default requires admin and writes agent-default-model', async () => {
    await withContext(async (ctx, root) => {
      await handleModel('default deepseek-v4-pro', ctx);
      expect(lastReply(ctx)).toContain('仅管理员');

      ctx.senderId = 'ou_admin';
      await handleModel('default deepseek-v4-pro', ctx);
      expect(lastReply(ctx)).toContain('agent-default-model');

      const settings = await readFile(join(root, '.dsh', 'settings.yaml'), 'utf8');
      expect(settings).toContain('agent-default-model');
      expect(settings).toContain('deepseek-v4-pro');
    });
  });

  it('/providers lists the deepseek provider and default model', async () => {
    await withContext(async (ctx) => {
      await handleProviders('', ctx);
      const text = lastReply(ctx);
      expect(text).toContain('deepseek-official');
      expect(text).toContain('deepseek-v4-flash');
    });
  });

  it('/key set requires admin and writes the credential file; /key list hides values', async () => {
    await withContext(async (ctx, root) => {
      await handleKey('set MY_KEY secret', ctx);
      expect(lastReply(ctx)).toContain('仅管理员');

      ctx.senderId = 'ou_admin';
      await handleKey('set MY_KEY sk-123', ctx);
      expect(lastReply(ctx)).toContain('已写入凭据');

      await handleKey('list', ctx);
      expect(lastReply(ctx)).toContain('MY_KEY');
      expect(lastReply(ctx)).not.toContain('sk-123');

      const file = await readFile(join(root, '.dsh', '.credentials.yaml'), 'utf8');
      expect(file).toContain('MY_KEY: sk-123');
    });
  });

  it('/provider add validates input and /model add routes to deepseek', async () => {
    await withContext(async (ctx, root) => {
      ctx.senderId = 'ou_admin';
      await handleProvider('add bad-gateway --api openai-completions --base-url https://g.example/v1', ctx);
      expect(lastReply(ctx)).toContain('--model');

      await handleModel('add deepseek-official deepseek-r1 --name DeepSeek-R1', ctx);
      const settings = await readFile(join(root, '.dsh', 'settings.yaml'), 'utf8');
      expect(settings).toContain('deepseek-r1');
      expect(lastReply(ctx)).toContain('已添加模型');
    });
  });
});
