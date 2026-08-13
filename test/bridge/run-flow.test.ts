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
});
