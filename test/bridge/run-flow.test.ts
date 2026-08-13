import { describe, expect, it, vi } from 'vitest';
import type {
  AgentAdapter,
  AgentAvailability,
  AgentEvent,
  AgentRun,
} from '../../src/adapters/types.js';
import { ActiveRuns } from '../../src/bot/active-runs.js';
import { runAgentBatch } from '../../src/bridge/run-flow.js';
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
});
