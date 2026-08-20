import { describe, expect, it, vi } from 'vitest';
import type { SessionArchive } from '../../src/session/archive.js';
import { tryHandleCommand, type CommandContext } from '../../src/commands/index.js';
import { ActiveRuns } from '../../src/bot/active-runs.js';
import { ConcurrencyStore } from '../../src/bot/concurrency-store.js';
import { ModelStore } from '../../src/bot/model-store.js';
import { WizardStore } from '../../src/bot/wizard-store.js';
import { RetentionStore } from '../../src/bot/retention-store.js';
import { RoleStore } from '../../src/bot/role-store.js';
import { ScopeDirectory } from '../../src/bridge/scope-directory.js';
import { RunPolicyStore } from '../../src/bot/run-policy.js';
import { AccessManager } from '../../src/config/access-manager.js';
import { DshProviderManager } from '../../src/config/dsh-config.js';
import { ConfigStore } from '../../src/config/profile-store.js';
import { SessionStore } from '../../src/session/store.js';
import { WorkspaceStore } from '../../src/workspace/store.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { afterEach } from 'vitest';

const archiveRoots: string[] = [];
afterEach(async () => Promise.all(archiveRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  const archiver = {
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
    archiver,
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
    senderId: undefined,
    accessManager: new AccessManager(new ConfigStore(':memory:'), 'default'),
    channel: {
      sendMarkdown: vi.fn().mockResolvedValue(undefined),
    } as unknown as CommandContext['channel'],
    defaultWorkspace: '/tmp/default',
    ...overrides,
  };
}

describe('archive slash commands', () => {
  it('uploads both newly-created archive files to the current thread', async () => {
    const root = await mkdtemp(join(tmpdir(), 'archive-command-'));
    archiveRoots.push(root);
    const markdownPath = join(root, 'archive-1.md');
    const jsonlPath = join(root, 'archive-1.jsonl');
    await writeFile(markdownPath, '# archive');
    await writeFile(jsonlPath, '{}\n');
    const sendFile = vi.fn().mockResolvedValue(undefined);
    const ctx = makeContext({
      threadId: 'thread-a',
      channel: { sendMarkdown: vi.fn().mockResolvedValue(undefined), sendFile },
      archiver: {
        archive: vi.fn().mockResolvedValue({
          archiveId: 'archive-1', scope: 'chat-a', cwd: '/tmp/default', source: 'manual',
          note: undefined, messageCount: 0, archivedAt: new Date().toISOString(),
          markdownPath, jsonlPath, gitCommit: undefined,
        }),
        prune: vi.fn().mockResolvedValue(0),
      } as unknown as SessionArchive,
    });
    await tryHandleCommand('/archive', ctx);
    expect(sendFile).toHaveBeenCalledTimes(2);
    expect(sendFile).toHaveBeenCalledWith('chat-a', 'archive-1.md', Buffer.from('# archive'), { replyTo: 'msg-1', threadId: 'thread-a' });
    expect(ctx.channel.sendMarkdown).toHaveBeenCalledWith('chat-a', expect.stringContaining('已将 2 个归档文件发送'), { replyTo: 'msg-1' });
  });

  it('resends an existing archive by id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'archive-command-'));
    archiveRoots.push(root);
    const markdownPath = join(root, 'archive-1.md');
    const jsonlPath = join(root, 'archive-1.jsonl');
    await writeFile(markdownPath, '# archive');
    await writeFile(jsonlPath, '{}\n');
    const sendFile = vi.fn().mockResolvedValue(undefined);
    const ctx = makeContext({ channel: { sendMarkdown: vi.fn().mockResolvedValue(undefined), sendFile } });
    vi.mocked(ctx.archiver.list).mockResolvedValue([{ archiveId: 'archive-1', scope: 'chat-a', cwd: '/tmp/default', source: 'manual', note: undefined, messageCount: 0, archivedAt: '', markdownPath, jsonlPath, gitCommit: undefined }]);
    await tryHandleCommand('/archive send archive-1', ctx);
    expect(sendFile).toHaveBeenCalledTimes(2);
  });

  it('lets an admin send a current-workspace archive to a registered session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'archive-command-'));
    archiveRoots.push(root);
    const markdownPath = join(root, 'archive-1.md');
    const jsonlPath = join(root, 'archive-1.jsonl');
    await writeFile(markdownPath, '# archive');
    await writeFile(jsonlPath, '{}\n');
    const sendFile = vi.fn().mockResolvedValue(undefined);
    const scopeDirectory = new ScopeDirectory(':memory:');
    scopeDirectory.register('chat-b:thread-b', 'chat-b', 'thread-b', 'topic', 'message-b');
    const ctx = makeContext({
      senderId: 'admin',
      accessManager: { isAdmin: () => true } as unknown as AccessManager,
      scopeDirectory,
      channel: { sendMarkdown: vi.fn().mockResolvedValue(undefined), sendFile },
    });
    vi.mocked(ctx.archiver.list).mockResolvedValue([{ archiveId: 'archive-1', scope: 'chat-a', cwd: '/tmp/default', source: 'manual', note: undefined, messageCount: 0, archivedAt: '', markdownPath, jsonlPath, gitCommit: undefined }]);

    await tryHandleCommand('/archive send archive-1 chat-b:thread-b', ctx);

    expect(sendFile).toHaveBeenCalledWith('chat-b', 'archive-1.md', Buffer.from('# archive'), { replyTo: 'message-b', threadId: 'thread-b' });
    expect(ctx.channel.sendMarkdown).toHaveBeenCalledWith('chat-a', expect.stringContaining('chat-b:thread-b'), { replyTo: 'msg-1' });
  });

  it('rejects cross-session archive delivery from a non-admin', async () => {
    const ctx = makeContext();
    await tryHandleCommand('/archive send archive-1 chat-b', ctx);
    expect(ctx.archiver.list).not.toHaveBeenCalled();
    expect(ctx.channel.sendMarkdown).toHaveBeenCalledWith('chat-a', expect.stringContaining('仅管理员'), { replyTo: 'msg-1' });
  });

  it('archives the full live session on /archive', async () => {
    const ctx = makeContext();
    ctx.sessions.recordExchange('chat-a', '/tmp/default', ['hello'], 'hi');
    await tryHandleCommand('/archive kickoff', ctx);

    expect(ctx.archiver.archive).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'chat-a',
        cwd: '/tmp/default',
        source: 'manual',
        note: 'kickoff',
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
        ],
      }),
    );
    expect(ctx.archiver.prune).toHaveBeenCalled();
  });

  it('sets and clears the per-scope retention window', async () => {
    const ctx = makeContext();
    await tryHandleCommand('/retention 8', ctx);
    expect(ctx.retentionStore.get('chat-a')).toBe(8);

    await tryHandleCommand('/retention default', ctx);
    expect(ctx.retentionStore.get('chat-a')).toBeUndefined();

    await tryHandleCommand('/retention', ctx);
    expect(ctx.channel.sendMarkdown).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('40'),
      { replyTo: 'msg-1' },
    );
  });

  it('lists and cleans archives only for the current workspace', async () => {
    const ctx = makeContext();
    await tryHandleCommand('/archive list', ctx);
    expect(ctx.archiver.list).toHaveBeenCalledWith('chat-a', '/tmp/default');

    await tryHandleCommand('/archive clean', ctx);
    expect(ctx.archiver.prune).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'chat-a', cwd: '/tmp/default',
    }));
  });
});
