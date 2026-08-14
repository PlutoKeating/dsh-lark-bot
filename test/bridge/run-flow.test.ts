import { describe, expect, it, vi } from 'vitest';
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
