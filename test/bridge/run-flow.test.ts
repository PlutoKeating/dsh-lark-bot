import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentAdapter,
  AgentAvailability,
  AgentEvent,
  AgentRun,
} from '../../src/adapters/types.js';
import { ActiveRuns } from '../../src/bot/active-runs.js';
import { ApprovalRegistry } from '../../src/bot/approvals.js';
import {
  approvalHandlerFor,
  runAgentBatch,
} from '../../src/bridge/run-flow.js';
import type { StreamingChannel } from '../../src/bridge/types.js';
import { SessionStore } from '../../src/session/store.js';
import { WorkspaceStore } from '../../src/workspace/store.js';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function fakeAdapter(events: AgentEvent[]): AgentAdapter {
  return {
    id: 'dsh',
    displayName: 'DeepSeek Harness',
    async isAvailable() {
      return true;
    },
    async checkAvailability(): Promise<AgentAvailability> {
      return { ok: true, error: undefined, version: 'test' };
    },
    run(): AgentRun {
      return {
        runId: 'run-1',
        events: (async function* () {
          yield* events;
        })(),
        stop: vi.fn().mockResolvedValue(undefined),
        waitForExit: async () => true,
      };
    },
  };
}

function makeChannel(): {
  channel: StreamingChannel;
  updates: object[];
  messages: string[];
} {
  const updates: object[] = [];
  const messages: string[] = [];
  const channel: StreamingChannel = {
    async sendMarkdown(_chatId, markdown) {
      messages.push(markdown);
    },
    async streamCard(_chatId, initial, producer) {
      updates.push(initial);
      await producer({
        update: async (card) => {
          updates.push(card);
        },
      });
    },
  };
  return { channel, updates, messages };
}

describe('runAgentBatch', () => {
  it('streams agent events into a card and clears the active run', async () => {
    const events: AgentEvent[] = [
      { type: 'system', sessionId: 'session-1', cwd: '/tmp/project', model: undefined },
      { type: 'text', delta: 'hello' },
      { type: 'done', sessionId: 'session-1', terminationReason: 'normal' },
    ];
    const sessions = new SessionStore(':memory:');
    const workspaces = new WorkspaceStore(':memory:');
    const activeRuns = new ActiveRuns();
    const fake = makeChannel();

    await runAgentBatch({
      scope: 'chat-a',
      chatId: 'chat-a',
      messages: ['fix it'],
      adapter: fakeAdapter(events),
      sessions,
      workspaces,
      activeRuns,
      channel: fake.channel,
      defaultWorkspace: '/tmp/project',
    });

    expect(sessions.resumeFor('chat-a', '/tmp/project')).toBe('session-1');
    expect(activeRuns.get('chat-a')).toBeUndefined();
    expect(fake.updates.length).toBeGreaterThan(2);
  });

  it('marks the card idle-timeout and stops the run after the wall-clock deadline', async () => {
    let release: (() => void) | undefined;
    const stopped = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stop = vi.fn(async () => {
      release?.();
    });

    const adapter: AgentAdapter = {
      id: 'dsh',
      displayName: 'DeepSeek Harness',
      async isAvailable() {
        return true;
      },
      async checkAvailability() {
        return { ok: true, error: undefined, version: 'test' };
      },
      run(): AgentRun {
        return {
          runId: 'run-timeout',
          events: (async function* () {
            yield { type: 'text', delta: 'still going' };
            await stopped;
          })(),
          stop,
          waitForExit: async () => true,
        };
      },
    };

    const sessions = new SessionStore(':memory:');
    const workspaces = new WorkspaceStore(':memory:');
    const activeRuns = new ActiveRuns();
    const fake = makeChannel();

    await runAgentBatch({
      scope: 'chat-timeout',
      chatId: 'chat-timeout',
      messages: ['long task'],
      adapter,
      sessions,
      workspaces,
      activeRuns,
      channel: fake.channel,
      defaultWorkspace: '/tmp/project',
      runTimeoutMs: 10,
    });

    expect(stop).toHaveBeenCalledTimes(1);
    const lastCard = fake.updates[fake.updates.length - 1] as {
      body?: { elements?: Array<{ content?: string }> };
    };
    const lastText = lastCard?.body?.elements?.map((el) => el.content ?? '').join('\n') ?? '';
    expect(lastText).toContain('无响应');
    expect(activeRuns.get('chat-timeout')).toBeUndefined();
  });

  it('keeps a run alive while events keep arriving and only stops after idle', async () => {
    const stop = vi.fn(async () => {});
    const adapter: AgentAdapter = {
      id: 'dsh',
      displayName: 'DeepSeek Harness',
      async isAvailable() {
        return true;
      },
      async checkAvailability() {
        return { ok: true, error: undefined, version: 'test' };
      },
      run(): AgentRun {
        return {
          runId: 'run-busy',
          events: (async function* () {
            // Stream activity for several timeout windows: the watchdog must
            // keep re-arming instead of killing an active run.
            const untilMs = Date.now() + 90;
            while (Date.now() < untilMs) {
              yield { type: 'text', delta: 'working…' };
              await new Promise((resolve) => setTimeout(resolve, 5));
            }
            // Then go quiet: the idle watchdog should fire shortly after.
            await new Promise(() => {});
          })(),
          stop,
          waitForExit: async () => true,
        };
      },
    };

    const sessions = new SessionStore(':memory:');
    const workspaces = new WorkspaceStore(':memory:');
    const activeRuns = new ActiveRuns();
    const fake = makeChannel();

    const started = Date.now();
    await runAgentBatch({
      scope: 'chat-busy',
      chatId: 'chat-busy',
      messages: ['long task'],
      adapter,
      sessions,
      workspaces,
      activeRuns,
      channel: fake.channel,
      defaultWorkspace: '/tmp/project',
      runTimeoutMs: 15,
    });
    const durationMs = Date.now() - started;

    expect(stop).toHaveBeenCalledTimes(1);
    // Survived multiple 15 ms timeout windows thanks to activity resets.
    expect(durationMs).toBeGreaterThanOrEqual(60);
    const lastCard = fake.updates[fake.updates.length - 1] as {
      body?: { elements?: Array<{ content?: string }> };
    };
    const lastText = lastCard?.body?.elements?.map((el) => el.content ?? '').join('\n') ?? '';
    expect(lastText).toContain('无响应');
    expect(activeRuns.get('chat-busy')).toBeUndefined();
  });

  it('does not replay history when resuming a native session', async () => {
    let observedPrompt: string | undefined;
    let observedSessionId: string | undefined;
    const adapter: AgentAdapter = {
      id: 'dsh-sdk',
      displayName: 'DeepSeek Harness (SDK)',
      resumeCapable: true,
      async isAvailable() {
        return true;
      },
      async checkAvailability() {
        return { ok: true, error: undefined, version: 'test' };
      },
      run(options): AgentRun {
        observedPrompt = options.prompt;
        observedSessionId = options.sessionId;
        return {
          runId: options.runId,
          events: (async function* () {
            yield {
              type: 'system',
              sessionId: 'session-1',
              cwd: '/tmp/project',
              model: undefined,
            };
            yield { type: 'final_text', content: 'I remember.' };
            yield { type: 'done', sessionId: 'session-1', terminationReason: 'normal' };
          })(),
          stop: vi.fn().mockResolvedValue(undefined),
          waitForExit: async () => true,
        };
      },
    };
    const sessions = new SessionStore(':memory:');
    sessions.recordExchange('chat-a', '/tmp/project', ['my name is Bob'], 'Nice to meet you.');
    sessions.set('chat-a', 'session-1', '/tmp/project');

    await runAgentBatch({
      scope: 'chat-a',
      chatId: 'chat-a',
      messages: ['what did I just say?'],
      adapter,
      sessions,
      workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(),
      channel: makeChannel().channel,
      defaultWorkspace: '/tmp/project',
    });

    expect(observedSessionId).toBe('session-1');
    expect(observedPrompt).not.toContain('my name is Bob');
    expect(observedPrompt).not.toContain('Nice to meet you.');
    expect(observedPrompt).toContain('what did I just say?');
  });

  it('falls back to a fresh session when a native resume fails', async () => {
    const calls: Array<{ prompt: string; sessionId: string | undefined }> = [];
    let first = true;
    const adapter: AgentAdapter = {
      id: 'dsh-sdk',
      displayName: 'DeepSeek Harness (SDK)',
      resumeCapable: true,
      async isAvailable() {
        return true;
      },
      async checkAvailability() {
        return { ok: true, error: undefined, version: 'test' };
      },
      run(options): AgentRun {
        calls.push({ prompt: options.prompt, sessionId: options.sessionId });
        if (first) {
          first = false;
          return {
            runId: options.runId,
            events: (async function* () {
              yield {
                type: 'system',
                sessionId: 'session-1',
                cwd: '/tmp/project',
                model: undefined,
              };
              throw new Error(
                'session "session-1" already has a persisted log on disk that does not match this live session (id collision)',
              );
            })(),
            stop: vi.fn().mockResolvedValue(undefined),
            waitForExit: async () => true,
          };
        }
        return {
          runId: options.runId,
          events: (async function* () {
            yield { type: 'final_text', content: 'recovered' };
            yield { type: 'done', sessionId: undefined, terminationReason: 'normal' };
          })(),
          stop: vi.fn().mockResolvedValue(undefined),
          waitForExit: async () => true,
        };
      },
    };
    const sessions = new SessionStore(':memory:');
    sessions.recordExchange('chat-a', '/tmp/project', ['my name is Bob'], 'Nice to meet you.');
    sessions.set('chat-a', 'session-1', '/tmp/project');
    const fake = makeChannel();

    await runAgentBatch({
      scope: 'chat-a',
      chatId: 'chat-a',
      messages: ['new message'],
      adapter,
      sessions,
      workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(),
      channel: fake.channel,
      defaultWorkspace: '/tmp/project',
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.sessionId).toBe('session-1');
    expect(calls[1]?.sessionId).toBeUndefined();
    // The fresh-session attempt replays the transcript.
    expect(calls[1]?.prompt).toContain('my name is Bob');
    // No failure message was surfaced to the user.
    expect(fake.messages).toHaveLength(0);
    expect(sessions.resumeFor('chat-a', '/tmp/project')).toBeUndefined();
    expect(sessions.historyFor('chat-a', '/tmp/project')).toEqual([
      { role: 'user', content: 'my name is Bob' },
      { role: 'assistant', content: 'Nice to meet you.' },
      { role: 'user', content: 'new message' },
      { role: 'assistant', content: 'recovered' },
    ]);
  });

  it('falls back when a native resume fails via an error event', async () => {
    const calls: Array<{ sessionId: string | undefined }> = [];
    let first = true;
    const adapter: AgentAdapter = {
      id: 'dsh-sdk',
      displayName: 'DeepSeek Harness (SDK)',
      resumeCapable: true,
      async isAvailable() {
        return true;
      },
      async checkAvailability() {
        return { ok: true, error: undefined, version: 'test' };
      },
      run(options): AgentRun {
        calls.push({ sessionId: options.sessionId });
        if (first) {
          first = false;
          return {
            runId: options.runId,
            // The SDK adapter surfaces a rejected resume as an error EVENT
            // (system + error, no real activity), not a thrown error.
            events: (async function* () {
              yield {
                type: 'system',
                sessionId: 'session-1',
                cwd: '/tmp/project',
                model: undefined,
              };
              yield {
                type: 'error',
                message:
                  'session "session-1" already has a persisted log on disk that does not match this live session (id collision)',
                terminationReason: 'failed',
              };
            })(),
            stop: vi.fn().mockResolvedValue(undefined),
            waitForExit: async () => true,
          };
        }
        return {
          runId: options.runId,
          events: (async function* () {
            yield { type: 'final_text', content: 'recovered via error event' };
            yield { type: 'done', sessionId: undefined, terminationReason: 'normal' };
          })(),
          stop: vi.fn().mockResolvedValue(undefined),
          waitForExit: async () => true,
        };
      },
    };
    const sessions = new SessionStore(':memory:');
    sessions.recordExchange('chat-a', '/tmp/project', ['my name is Bob'], 'Nice to meet you.');
    sessions.set('chat-a', 'session-1', '/tmp/project');
    const fake = makeChannel();

    await runAgentBatch({
      scope: 'chat-a',
      chatId: 'chat-a',
      messages: ['new message'],
      adapter,
      sessions,
      workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(),
      channel: fake.channel,
      defaultWorkspace: '/tmp/project',
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.sessionId).toBe('session-1');
    expect(calls[1]?.sessionId).toBeUndefined();
    // No hard failure message was surfaced to the user.
    expect(fake.messages).toHaveLength(0);
    expect(sessions.resumeFor('chat-a', '/tmp/project')).toBeUndefined();
    expect(sessions.historyFor('chat-a', '/tmp/project')).toEqual([
      { role: 'user', content: 'my name is Bob' },
      { role: 'assistant', content: 'Nice to meet you.' },
      { role: 'user', content: 'new message' },
      { role: 'assistant', content: 'recovered via error event' },
    ]);
  });

  it('does not fall back when a resumed run errors after real activity', async () => {
    const calls: Array<{ sessionId: string | undefined }> = [];
    const adapter: AgentAdapter = {
      id: 'dsh-sdk',
      displayName: 'DeepSeek Harness (SDK)',
      resumeCapable: true,
      async isAvailable() {
        return true;
      },
      async checkAvailability() {
        return { ok: true, error: undefined, version: 'test' };
      },
      run(options): AgentRun {
        calls.push({ sessionId: options.sessionId });
        return {
          runId: options.runId,
          events: (async function* () {
            yield {
              type: 'system',
              sessionId: 'session-1',
              cwd: '/tmp/project',
              model: undefined,
            };
            yield { type: 'text', delta: 'working…' };
            yield {
              type: 'error',
              message: 'upstream provider failed mid-task',
              terminationReason: 'failed',
            };
          })(),
          stop: vi.fn().mockResolvedValue(undefined),
          waitForExit: async () => true,
        };
      },
    };
    const sessions = new SessionStore(':memory:');
    sessions.recordExchange('chat-a', '/tmp/project', ['my name is Bob'], 'Nice to meet you.');
    sessions.set('chat-a', 'session-1', '/tmp/project');
    const fake = makeChannel();

    await runAgentBatch({
      scope: 'chat-a',
      chatId: 'chat-a',
      messages: ['new message'],
      adapter,
      sessions,
      workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(),
      channel: fake.channel,
      defaultWorkspace: '/tmp/project',
    });

    // Only one attempt: a mid-task failure is not a session-level problem.
    expect(calls).toHaveLength(1);
    // The error is rendered on the run card, not reported as a hard failure.
    expect(fake.messages).toHaveLength(0);
    const lastCard = fake.updates[fake.updates.length - 1] as {
      body?: { elements?: Array<{ content?: string }> };
    };
    const lastText = lastCard?.body?.elements?.map((el) => el.content ?? '').join('\n') ?? '';
    expect(lastText).toContain('upstream provider failed mid-task');
    expect(sessions.resumeFor('chat-a', '/tmp/project')).toBe('session-1');
  });

  it('archives a corrupt session log and resets the scope', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dsh-heal-flow-'));
    tempDirs.push(base);
    vi.stubEnv('DSH_HOME', join(base, 'dsh'));
    vi.stubEnv('DSH_LARK_HOME', join(base, 'lark'));

    const sessionDir = join(base, 'dsh', 'sessions', 'session-1');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'log.jsonl'), '{"seq":1}\n');

    const sessions = new SessionStore(':memory:');
    sessions.recordExchange('chat-a', '/tmp/project', ['my name is Bob'], 'Nice to meet you.');
    sessions.set('chat-a', 'session-1', '/tmp/project');
    const fake = makeChannel();
    const adapter = fakeAdapter([
      { type: 'system', sessionId: 'session-1', cwd: '/tmp/project', model: undefined },
      { type: 'text', delta: 'working…' },
      {
        type: 'error',
        message: 'session "session-1" corrupt session log: seq gap',
        terminationReason: 'failed',
      },
    ]);

    await runAgentBatch({
      scope: 'chat-a',
      chatId: 'chat-a',
      messages: ['new message'],
      adapter,
      sessions,
      workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(),
      channel: fake.channel,
      defaultWorkspace: '/tmp/project',
    });

    // The corrupt log was copied to the archive and the original removed.
    expect(await readdir(join(base, 'dsh', 'sessions'))).toHaveLength(0);
    const archives = await readdir(join(base, 'lark', '_archived-sessions'));
    expect(archives.length).toBeGreaterThan(0);
    // The scope mapping was reset and the user was told where it went.
    expect(sessions.resumeFor('chat-a', '/tmp/project')).toBeUndefined();
    const text = fake.messages.join('\n');
    expect(text).toContain('已归档并重置');
    expect(text).toContain('_archived-sessions');
  });

  it('resolves the run cwd through the workspace manager when present', async () => {
    let observedCwd: string | undefined;
    const adapter: AgentAdapter = {
      id: 'dsh',
      displayName: 'DeepSeek Harness',
      async isAvailable() {
        return true;
      },
      async checkAvailability() {
        return { ok: true, error: undefined, version: 'test' };
      },
      run(options): AgentRun {
        observedCwd = options.cwd;
        return {
          runId: options.runId,
          events: (async function* () {
            yield { type: 'done', sessionId: undefined, terminationReason: 'normal' };
          })(),
          stop: vi.fn().mockResolvedValue(undefined),
          waitForExit: async () => true,
        };
      },
    };
    const manager = {
      ensure: vi.fn().mockResolvedValue({
        cwd: '/tmp/worktrees/chat-a',
        created: true,
        branch: 'dsh-lark/chat-a-1',
      }),
    };

    await runAgentBatch({
      scope: 'chat-a',
      chatId: 'chat-a',
      messages: ['work on the feature'],
      adapter,
      sessions: new SessionStore(':memory:'),
      workspaces: new WorkspaceStore(':memory:'),
      workspaceManager: manager as never,
      activeRuns: new ActiveRuns(),
      channel: makeChannel().channel,
      defaultWorkspace: '/tmp/project',
    });

    expect(manager.ensure).toHaveBeenCalledWith('chat-a', '/tmp/project');
    expect(observedCwd).toBe('/tmp/worktrees/chat-a');
  });

  it('includes persisted conversation history in the next prompt', async () => {
    let observedPrompt: string | undefined;
    const adapter: AgentAdapter = {
      id: 'dsh',
      displayName: 'DeepSeek Harness',
      async isAvailable() {
        return true;
      },
      async checkAvailability() {
        return { ok: true, error: undefined, version: 'test' };
      },
      run(options): AgentRun {
        observedPrompt = options.prompt;
        return {
          runId: options.runId,
          events: (async function* () {
            yield { type: 'final_text', content: 'I remember.' };
            yield { type: 'done', sessionId: undefined, terminationReason: 'normal' };
          })(),
          stop: vi.fn().mockResolvedValue(undefined),
          waitForExit: async () => true,
        };
      },
    };
    const sessions = new SessionStore(':memory:');
    sessions.recordExchange('chat-a', '/tmp/project', ['my name is Bob'], 'Nice to meet you.');

    await runAgentBatch({
      scope: 'chat-a',
      chatId: 'chat-a',
      messages: ['what did I just say?'],
      adapter,
      sessions,
      workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(),
      channel: makeChannel().channel,
      defaultWorkspace: '/tmp/project',
    });

    expect(observedPrompt).toContain('my name is Bob');
    expect(observedPrompt).toContain('Nice to meet you.');
    expect(observedPrompt).toContain('what did I just say?');
    expect(sessions.historyFor('chat-a', '/tmp/project')).toEqual([
      { role: 'user', content: 'my name is Bob' },
      { role: 'assistant', content: 'Nice to meet you.' },
      { role: 'user', content: 'what did I just say?' },
      { role: 'assistant', content: 'I remember.' },
    ]);
  });

  it('gives concurrent runs in one scope fresh sessions and tracks both', async () => {
    const sessions = new SessionStore(':memory:');
    const workspaces = new WorkspaceStore(':memory:');
    const activeRuns = new ActiveRuns();
    const requestedSessions: Array<string | undefined> = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const makeAdapter = (sessionId: string) => {
      const adapter: AgentAdapter = {
        id: 'dsh',
        displayName: 'DeepSeek Harness',
        async isAvailable() {
          return true;
        },
        async checkAvailability() {
          return { ok: true, error: undefined, version: 'test' };
        },
        run(options): AgentRun {
          requestedSessions.push(options.sessionId);
          return {
            runId: options.runId,
            events: (async function* () {
              yield { type: 'system', sessionId, cwd: '/tmp/project', model: undefined };
              yield { type: 'done', sessionId, terminationReason: 'normal' };
              await gate;
            })(),
            stop: vi.fn().mockResolvedValue(undefined),
            waitForExit: async () => true,
          };
        },
      };
      return adapter;
    };

    const channel = makeChannel();
    const first = runAgentBatch({
      scope: 'chat-a',
      chatId: 'chat-a',
      messages: ['task one'],
      adapter: makeAdapter('run-a'),
      sessions,
      workspaces,
      activeRuns,
      channel: channel.channel,
      defaultWorkspace: '/tmp/project',
      maxConcurrency: 2,
    });
    // Give the first run a moment to register before starting the second.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = runAgentBatch({
      scope: 'chat-a',
      chatId: 'chat-a',
      messages: ['task two'],
      adapter: makeAdapter('run-b'),
      sessions,
      workspaces,
      activeRuns,
      channel: channel.channel,
      defaultWorkspace: '/tmp/project',
      maxConcurrency: 2,
    });

    expect(activeRuns.count('chat-a')).toBe(2);
    release?.();
    await Promise.all([first, second]);

    expect(requestedSessions[0]).toBeUndefined(); // first run: no resume available
    expect(requestedSessions[1]).toBeUndefined(); // concurrent run: never shares a session
    expect(activeRuns.count('chat-a')).toBe(0);
  });

  it('rejects runs beyond the configured scope concurrency cap', async () => {
    const sessions = new SessionStore(':memory:');
    const workspaces = new WorkspaceStore(':memory:');
    const activeRuns = new ActiveRuns();
    const run = vi.fn().mockReturnValue({
      runId: 'run-1',
      events: (async function* () {
        yield { type: 'done', sessionId: undefined, terminationReason: 'normal' };
      })(),
      stop: vi.fn(),
      waitForExit: async () => true,
    });
    const adapter = {
      id: 'dsh',
      displayName: 'DeepSeek Harness',
      isAvailable: async () => true,
      checkAvailability: async () => ({ ok: true, error: undefined, version: 'test' }),
      run,
    } as unknown as AgentAdapter;
    activeRuns.set('chat-a', { runId: 'run-0', stop: vi.fn() });

    const fake = makeChannel();
    await runAgentBatch({
      scope: 'chat-a',
      chatId: 'chat-a',
      messages: ['blocked'],
      adapter,
      sessions,
      workspaces,
      activeRuns,
      channel: fake.channel,
      defaultWorkspace: '/tmp/project',
      maxConcurrency: 1,
    });

    expect(run).not.toHaveBeenCalled();
    expect(fake.messages[0]).toContain('上限');
  });

  it('injects role persona/rules into the prompt and keeps the model route', async () => {
    const sessions = new SessionStore(':memory:');
    const workspaces = new WorkspaceStore(':memory:');
    const activeRuns = new ActiveRuns();
    let prompt = '';
    const adapter: AgentAdapter = {
      id: 'dsh',
      displayName: 'DeepSeek Harness',
      async isAvailable() {
        return true;
      },
      async checkAvailability() {
        return { ok: true, error: undefined, version: 'test' };
      },
      run(options): AgentRun {
        prompt = options.prompt;
        return {
          runId: 'run-role',
          events: (async function* () {
            yield { type: 'system', sessionId: 's1', cwd: '/tmp/project', model: undefined };
            yield { type: 'done', sessionId: 's1', terminationReason: 'normal' };
          })(),
          stop: vi.fn().mockResolvedValue(undefined),
          waitForExit: async () => true,
        };
      },
    };
    const fake = makeChannel();

    await runAgentBatch({
      scope: 'chat-a',
      chatId: 'chat-a',
      messages: ['do it'],
      adapter,
      sessions,
      workspaces,
      activeRuns,
      channel: fake.channel,
      defaultWorkspace: '/tmp/project',
      role: {
        id: 'docs',
        name: 'Documentation Writer',
        persona: 'You write precise docs.',
        model: 'deepseek-v4-flash',
        tools: 'fs,search',
        agentsMd: 'Never invent APIs.',
        createdAt: '',
        updatedAt: '',
      },
    });

    expect(prompt).toContain('Role: Documentation Writer (docs)');
    expect(prompt).toContain('You write precise docs.');
    expect(prompt).toContain('Tools guidance: fs,search');
    expect(prompt).toContain('Never invent APIs.');
    expect(prompt).toContain('do it');
  });
});

describe('approvalHandlerFor', () => {
  it('renders an approval card and resolves through the registry', async () => {
    const approvals = new ApprovalRegistry();
    const sendCard = vi.fn().mockResolvedValue(undefined);
    const handler = approvalHandlerFor({
      approvals,
      channel: { sendCard },
      chatId: 'chat-a',
      scope: 'chat-a',
    });
    const outcome = handler({
      id: 'call-1',
      sessionId: 's1',
      toolName: 'bash',
      reason: 'run tests',
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    });
    expect(sendCard).toHaveBeenCalledWith('chat-a', expect.objectContaining({ schema: '2.0' }));
    expect(approvals.resolve('chat-a', 'call-1', 'allowed-once')).toBe(true);
    await expect(outcome).resolves.toBe('allowed-once');
  });

  it('fails closed when no registry or card channel exists', async () => {
    const handler = approvalHandlerFor({
      approvals: undefined,
      channel: {},
      chatId: 'chat-a',
      scope: 'chat-a',
    });
    await expect(
      handler({
        id: 'call-1',
        sessionId: undefined,
        toolName: 'bash',
        reason: undefined,
        options: [],
      }),
    ).resolves.toBe('cancelled');
  });
});
