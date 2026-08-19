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
import type { PermissionPolicyStore } from '../../src/bot/permission-policy-store.js';
import { PlanApprovalRegistry } from '../../src/bot/plan-approvals.js';
import { QuestionRegistry } from '../../src/bot/questions.js';
import {
  approvalHandlerFor,
  questionHandlerFor,
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
  it('reports durable stage checkpoints and a terminal outcome without storing hidden content', async () => {
    const checkpoints: Array<Record<string, unknown>> = [];
    const outcome = await runAgentBatch({
      scope: 'chat-ledger', chatId: 'chat-ledger', messages: ['do work'],
      adapter: fakeAdapter([
        { type: 'system', sessionId: 'session-ledger', cwd: '/tmp/project', model: 'm' },
        { type: 'thinking', delta: 'private chain content' },
        { type: 'tool_use', id: 'tool-1', name: 'bash', input: { command: 'secret' } },
        { type: 'tool_result', id: 'tool-1', output: 'done', isError: false },
        { type: 'final_text', content: 'complete' },
        { type: 'done', sessionId: 'session-ledger', terminationReason: 'normal' },
      ]),
      sessions: new SessionStore(':memory:'), workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(), channel: makeChannel().channel, defaultWorkspace: '/tmp/project',
      onCheckpoint: async (checkpoint) => { checkpoints.push(checkpoint); },
    });

    expect(outcome).toBe('completed');
    expect(checkpoints.map((entry) => [entry.stage, entry.detail])).toEqual([
      ['starting', undefined], ['thinking', undefined], ['tool', 'bash'],
      ['responding', undefined], ['finalizing', undefined],
    ]);
    expect(JSON.stringify(checkpoints)).not.toContain('private chain content');
    expect(JSON.stringify(checkpoints)).not.toContain('secret');
  });

  it('does not abandon a live run when checkpoint persistence is temporarily unavailable', async () => {
    const activeRuns = new ActiveRuns();
    const outcome = await runAgentBatch({
      scope: 'chat-ledger-failure', chatId: 'chat-ledger-failure', messages: ['continue'],
      adapter: fakeAdapter([
        { type: 'system', sessionId: 'session-ledger', cwd: '/tmp/project', model: 'm' },
        { type: 'final_text', content: 'complete' },
        { type: 'done', sessionId: 'session-ledger', terminationReason: 'normal' },
      ]),
      sessions: new SessionStore(':memory:'), workspaces: new WorkspaceStore(':memory:'),
      activeRuns, channel: makeChannel().channel, defaultWorkspace: '/tmp/project',
      onCheckpoint: vi.fn().mockRejectedValue(new Error('disk unavailable')),
    });

    expect(outcome).toBe('completed');
    expect(activeRuns.count('chat-ledger-failure')).toBe(0);
  });

  it('resumes each workspace independently across A to B to A switches', async () => {
    const sessions = new SessionStore(':memory:');
    const workspaces = new WorkspaceStore(':memory:');
    const observed: Array<{ cwd: string; sessionId: string | undefined }> = [];
    const adapter: AgentAdapter = {
      id: 'workspace-test',
      displayName: 'workspace test',
      resumeCapable: true,
      async isAvailable() { return true; },
      async checkAvailability() { return { ok: true, error: undefined, version: 'test' }; },
      run(options): AgentRun {
        const cwd = options.cwd ?? '';
        observed.push({ cwd, sessionId: options.sessionId });
        const id = options.sessionId ?? (cwd.endsWith('a') ? 'session-a' : 'session-b');
        return {
          runId: options.runId,
          events: (async function* () {
            yield { type: 'system' as const, sessionId: id, cwd, model: undefined };
            yield { type: 'final_text' as const, content: `done ${cwd}` };
            yield { type: 'done' as const, sessionId: id, terminationReason: 'normal' as const };
          })(),
          stop: vi.fn().mockResolvedValue(undefined),
          waitForExit: async () => true,
        };
      },
    };
    const shared = {
      scope: 'chat-workspaces', chatId: 'chat-workspaces', adapter, sessions, workspaces,
      activeRuns: new ActiveRuns(), channel: makeChannel().channel, defaultWorkspace: '/tmp/a',
    };

    await runAgentBatch({ ...shared, messages: ['a1'], workspaceCwd: '/tmp/a' });
    await runAgentBatch({ ...shared, messages: ['b1'], workspaceCwd: '/tmp/b' });
    await runAgentBatch({ ...shared, messages: ['a2'], workspaceCwd: '/tmp/a' });

    expect(observed).toEqual([
      { cwd: '/tmp/a', sessionId: undefined },
      { cwd: '/tmp/b', sessionId: undefined },
      { cwd: '/tmp/a', sessionId: 'session-a' },
    ]);
    expect(sessions.resumeFor('chat-workspaces', '/tmp/b')).toBe('session-b');
    expect(sessions.historyFor('chat-workspaces', '/tmp/a')).toHaveLength(4);
    expect(sessions.historyFor('chat-workspaces', '/tmp/b')).toHaveLength(2);
  });

  it('includes exact trusted peer identities and handoff instructions in the agent prompt', async () => {
    let prompt = '';
    const adapter = fakeAdapter([
      { type: 'done', sessionId: 'session-peer', terminationReason: 'normal' },
    ]);
    const originalRun = adapter.run.bind(adapter);
    adapter.run = (options) => {
      prompt = options.prompt;
      return originalRun(options);
    };
    const fake = makeChannel();
    await runAgentBatch({
      scope: 'chat-peers', chatId: 'chat-peers', messages: ['handoff after completion'],
      adapter, sessions: new SessionStore(':memory:'), workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(), channel: fake.channel, defaultWorkspace: '/tmp/project',
      collaborationPeers: [
        { name: 'reviewer', openId: 'ou_reviewer_bot', displayName: 'Reviewer Bot' },
      ],
    });
    expect(prompt).toContain('reviewer (Reviewer Bot): open_id=ou_reviewer_bot');
    expect(prompt).toContain('mention_user_ids');
    expect(prompt).toContain('Never guess an identity');
  });

  it('pauses the idle watchdog for a native-session callback approval', async () => {
    const approvals = new ApprovalRegistry();
    const stop = vi.fn().mockResolvedValue(undefined);
    const adapter: AgentAdapter = {
      id: 'dsh', displayName: 'dsh',
      async isAvailable() { return true; },
      async checkAvailability() { return { ok: true, error: undefined, version: 'test' }; },
      run(): AgentRun {
        return {
          runId: 'run-callback', stop, waitForExit: async () => true,
          events: (async function* () {
            yield { type: 'system', sessionId: 'native-session', cwd: '/tmp/project', model: 'm' } as AgentEvent;
            const pending = approvals.register('chat-callback-timeout', {
              id: 'approval-callback', sessionId: 'native-session', toolName: 'bash',
              reason: 'test', options: [],
            }, 'native-session');
            setTimeout(() => approvals.resolve(
              'chat-callback-timeout', 'approval-callback', 'allowed-once',
            ), 60);
            await pending;
            yield { type: 'done', sessionId: 'native-session', terminationReason: 'normal' } as AgentEvent;
          })(),
        };
      },
    };
    const fake = makeChannel();
    await runAgentBatch({
      scope: 'chat-callback-timeout', chatId: 'chat-callback-timeout', messages: ['run'],
      adapter, sessions: new SessionStore(':memory:'), workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(), approvals, channel: fake.channel,
      defaultWorkspace: '/tmp/project', runTimeoutMs: 20,
    });
    expect(stop).not.toHaveBeenCalled();
    expect(approvals.pendingCount('chat-callback-timeout')).toBe(0);
  });

  it('does not cancel another concurrent run approval when this run completes', async () => {
    const approvals = new ApprovalRegistry();
    const approvalA = approvals.register('chat-concurrent-approval', {
      id: 'approval-a', sessionId: 'session-a', toolName: 'bash', reason: 'A', options: [],
    }, 'run-a');
    const fake = makeChannel();

    await runAgentBatch({
      scope: 'chat-concurrent-approval',
      chatId: 'chat-concurrent-approval',
      messages: ['run B'],
      adapter: fakeAdapter([
        { type: 'system', sessionId: 'session-b', cwd: '/tmp/project', model: 'm' },
        { type: 'done', sessionId: 'session-b', terminationReason: 'normal' },
      ]),
      sessions: new SessionStore(':memory:'),
      workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(),
      approvals,
      channel: fake.channel,
      defaultWorkspace: '/tmp/project',
    });

    expect(approvals.pendingCount('chat-concurrent-approval', 'run-a')).toBe(1);
    approvals.resolve('chat-concurrent-approval', 'approval-a', 'allowed-once');
    await expect(approvalA).resolves.toBe('allowed-once');
  });

  it('does not cancel another concurrent session question when this run completes', async () => {
    const questions = new QuestionRegistry();
    const questionA = questions.register(
      'chat-concurrent-question',
      { kind: 'text', question: 'A?' },
      'session-a',
    );
    questions.bindMessage('chat-concurrent-question', questionA.id, 'card-a');
    const fake = makeChannel();

    await runAgentBatch({
      scope: 'chat-concurrent-question',
      chatId: 'chat-concurrent-question',
      messages: ['run B'],
      adapter: fakeAdapter([
        { type: 'system', sessionId: 'session-b', cwd: '/tmp/project', model: 'm' },
        { type: 'done', sessionId: 'session-b', terminationReason: 'normal' },
      ]),
      sessions: new SessionStore(':memory:'),
      workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(),
      questions,
      channel: fake.channel,
      defaultWorkspace: '/tmp/project',
    });

    expect(questions.pendingForMessage('card-a')?.id).toBe(questionA.id);
    questions.resolve('chat-concurrent-question', questionA.id, 'A answer');
    await expect(questionA.promise).resolves.toBe('A answer');
  });

  it('sends the final answer as a separate markdown message with reply routing', async () => {
    const sent: Array<{ markdown: string; options: unknown }> = [];
    const fake = makeChannel();
    fake.channel.sendMarkdown = async (_chatId, markdown, options) => {
      sent.push({ markdown, options });
    };
    await runAgentBatch({
      scope: 'chat-final',
      chatId: 'chat-final',
      messages: ['answer me'],
      adapter: fakeAdapter([
        { type: 'thinking', delta: 'reasoning detail' },
        { type: 'final_text', content: '**Final answer**' },
        { type: 'done', sessionId: 's-final', terminationReason: 'normal' },
      ]),
      sessions: new SessionStore(':memory:'),
      workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(),
      channel: fake.channel,
      defaultWorkspace: '/tmp/project',
      replyTo: 'om_source',
    });
    expect(sent).toEqual([{ markdown: '**Final answer**', options: { replyTo: 'om_source' } }]);
    expect(JSON.stringify(fake.updates.at(-1))).not.toContain('**Final answer**');
  });

  it('marks final delivery failure on the process card while preserving the exchange', async () => {
    const sessions = new SessionStore(':memory:');
    const fake = makeChannel();
    fake.channel.sendMarkdown = async () => {
      throw new Error('message rejected');
    };
    await runAgentBatch({
      scope: 'chat-final-fail',
      chatId: 'chat-final-fail',
      messages: ['answer me'],
      adapter: fakeAdapter([
        { type: 'final_text', content: 'durable answer' },
        { type: 'done', sessionId: 's-final', terminationReason: 'normal' },
      ]),
      sessions,
      workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(),
      channel: fake.channel,
      defaultWorkspace: '/tmp/project',
    });
    expect(JSON.stringify(fake.updates.at(-1))).toContain('最终回答发送失败');
    expect(JSON.stringify(fake.updates.at(-1))).toContain('durable answer');
    expect(sessions.historyFor('chat-final-fail', '/tmp/project')).toContainEqual({
      role: 'assistant',
      content: 'durable answer',
    });
  });

  it('delivers the final answer even when process-card updates fail', async () => {
    const messages: string[] = [];
    const channel: StreamingChannel = {
      sendMarkdown: async (_chatId, markdown) => { messages.push(markdown); },
      streamCard: async (_chatId, _initial, producer) => {
        await producer({ update: async () => { throw new Error('card update rejected'); } });
      },
    };
    await runAgentBatch({
      scope: 'chat-card-update-fail',
      chatId: 'chat-card-update-fail',
      messages: ['answer me'],
      adapter: fakeAdapter([
        { type: 'final_text', content: 'answer survives' },
        { type: 'done', sessionId: 's1', terminationReason: 'normal' },
      ]),
      sessions: new SessionStore(':memory:'),
      workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(),
      channel,
      defaultWorkspace: '/tmp/project',
    });
    expect(messages).toEqual(['answer survives']);
  });

  it('retries with the legacy process card when collapsible delivery is rejected', async () => {
    const messages: string[] = [];
    const initialCards: object[] = [];
    let attempts = 0;
    const channel: StreamingChannel = {
      sendMarkdown: async (_chatId, markdown) => { messages.push(markdown); },
      streamCard: async (_chatId, initial, producer) => {
        attempts += 1;
        initialCards.push(initial);
        if (attempts === 1) throw new Error('collapsible_panel unsupported');
        await producer({ update: async () => {} });
      },
    };
    await runAgentBatch({
      scope: 'chat-legacy-card',
      chatId: 'chat-legacy-card',
      messages: ['answer me'],
      adapter: fakeAdapter([
        { type: 'thinking', delta: 'latest thought' },
        { type: 'final_text', content: 'legacy answer' },
        { type: 'done', sessionId: 's1', terminationReason: 'normal' },
      ]),
      sessions: new SessionStore(':memory:'),
      workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(),
      channel,
      defaultWorkspace: '/tmp/project',
    });
    expect(attempts).toBe(2);
    expect(JSON.stringify(initialCards[0])).toContain('collapsible_panel');
    expect(JSON.stringify(initialCards[1])).not.toContain('collapsible_panel');
    expect(messages).toEqual(['legacy answer']);
  });

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

  it('records real usage and context events for the current scope session', async () => {
    const sessions = new SessionStore(':memory:');
    await runAgentBatch({
      scope: 'chat-metrics',
      chatId: 'chat-metrics',
      messages: ['measure this'],
      adapter: fakeAdapter([
        { type: 'system', sessionId: 'session-metrics', cwd: '/tmp/project', model: 'm' },
        {
          type: 'usage',
          inputTokens: 10,
          outputTokens: 4,
          cacheReadTokens: 20,
          cacheWriteTokens: 2,
        },
        { type: 'context_usage', usedTokens: 36, contextWindow: 128 },
        { type: 'done', sessionId: 'session-metrics', terminationReason: 'normal' },
      ]),
      sessions,
      workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(),
      channel: makeChannel().channel,
      defaultWorkspace: '/tmp/project',
    });

    expect(sessions.metricsFor('chat-metrics', '/tmp/project', {
      sessionId: 'session-metrics',
      model: 'm',
    })).toEqual({
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 20,
      cacheWriteTokens: 2,
      contextUsedTokens: 36,
      contextWindow: 128,
    });
  });

  it('does not attribute an interleaved run context snapshot to the current session', async () => {
    let releaseAContext!: () => void;
    let releaseAFinish!: () => void;
    let releaseBFinish!: () => void;
    let markASystemReady!: () => void;
    let markAContextReady!: () => void;
    let markBContextReady!: () => void;
    const aContextGate = new Promise<void>((resolve) => { releaseAContext = resolve; });
    const aFinishGate = new Promise<void>((resolve) => { releaseAFinish = resolve; });
    const bFinishGate = new Promise<void>((resolve) => { releaseBFinish = resolve; });
    const aSystemReady = new Promise<void>((resolve) => { markASystemReady = resolve; });
    const aContextReady = new Promise<void>((resolve) => { markAContextReady = resolve; });
    const bContextReady = new Promise<void>((resolve) => { markBContextReady = resolve; });
    let runNumber = 0;
    const adapter: AgentAdapter = {
      id: 'dsh',
      displayName: 'DeepSeek Harness',
      async isAvailable() { return true; },
      async checkAvailability() { return { ok: true, error: undefined, version: 'test' }; },
      run(options): AgentRun {
        runNumber += 1;
        const current = runNumber;
        return {
          runId: options.runId,
          events: (async function* () {
            if (current === 1) {
              yield { type: 'system', sessionId: 'session-a', cwd: '/tmp/project', model: 'm' };
              markASystemReady();
              await aContextGate;
              yield { type: 'context_usage', usedTokens: 80, contextWindow: 100 };
              markAContextReady();
              await aFinishGate;
              yield { type: 'done', sessionId: 'session-a', terminationReason: 'normal' };
              return;
            }
            yield { type: 'system', sessionId: 'session-b', cwd: '/tmp/project', model: 'm' };
            yield { type: 'context_usage', usedTokens: 20, contextWindow: 100 };
            markBContextReady();
            await bFinishGate;
            yield { type: 'done', sessionId: 'session-b', terminationReason: 'normal' };
          })(),
          stop: vi.fn().mockResolvedValue(undefined),
          waitForExit: async () => true,
        };
      },
    };
    const sessions = new SessionStore(':memory:');
    const activeRuns = new ActiveRuns();
    const shared = {
      scope: 'chat-concurrent',
      chatId: 'chat-concurrent',
      adapter,
      sessions,
      workspaces: new WorkspaceStore(':memory:'),
      activeRuns,
      channel: makeChannel().channel,
      defaultWorkspace: '/tmp/project',
      provider: 'gateway',
      model: 'm',
    };

    const runA = runAgentBatch({ ...shared, messages: ['run a'] });
    await aSystemReady;
    const runB = runAgentBatch({ ...shared, messages: ['run b'] });
    await bContextReady;
    releaseAContext();
    await aContextReady;

    expect(sessions.resumeFor('chat-concurrent', '/tmp/project')).toBe('session-b');
    expect(sessions.metricsFor('chat-concurrent', '/tmp/project', {
      sessionId: 'session-b',
      model: 'gateway/m',
    })).toEqual({ contextUsedTokens: 20, contextWindow: 100 });
    expect(sessions.metricsFor('chat-concurrent', '/tmp/project', {
      sessionId: 'session-a',
      model: 'gateway/m',
    })).toEqual({ contextUsedTokens: 80, contextWindow: 100 });

    releaseAFinish();
    releaseBFinish();
    await Promise.all([runA, runB]);
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

  it('pauses the idle watchdog while a plan decision is pending', async () => {
    let release: (() => void) | undefined;
    const stopped = new Promise<void>((resolve) => { release = resolve; });
    const stop = vi.fn(async () => { release?.(); });
    const plans = new PlanApprovalRegistry();
    const gate = plans.register('chat-plan', 'session-plan');
    const adapter: AgentAdapter = {
      id: 'dsh',
      displayName: 'DeepSeek Harness',
      isAvailable: async () => true,
      checkAvailability: async () => ({ ok: true, error: undefined, version: 'test' }),
      run: () => ({
        runId: 'run-plan',
        events: (async function* () {
          yield {
            type: 'system',
            sessionId: 'session-plan',
            cwd: '/tmp/project',
            model: undefined,
          };
          yield { type: 'text', delta: 'planning' };
          await stopped;
        })(),
        stop,
        waitForExit: async () => true,
      }),
    };
    setTimeout(() => {
      plans.resolve('chat-plan', gate.id, { decision: 'approved' });
    }, 35);
    const started = Date.now();
    const fake = makeChannel();
    await runAgentBatch({
      scope: 'chat-plan',
      chatId: 'chat-plan',
      messages: ['large task'],
      adapter,
      sessions: new SessionStore(':memory:'),
      workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(),
      plans,
      channel: fake.channel,
      defaultWorkspace: '/tmp/project',
      runTimeoutMs: 10,
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('does not cancel or inherit another concurrent session plan gate', async () => {
    const plans = new PlanApprovalRegistry();
    const otherGate = plans.register('chat-plan', 'session-a');
    const stop = vi.fn(async () => undefined);
    const adapter: AgentAdapter = {
      id: 'dsh',
      displayName: 'DeepSeek Harness',
      isAvailable: async () => true,
      checkAvailability: async () => ({ ok: true, error: undefined, version: 'test' }),
      run: () => ({
        runId: 'run-b',
        events: (async function* () {
          yield {
            type: 'system',
            sessionId: 'session-b',
            cwd: '/tmp/project',
            model: undefined,
          };
          await new Promise((resolve) => setTimeout(resolve, 25));
        })(),
        stop,
        waitForExit: async () => true,
      }),
    };

    await runAgentBatch({
      scope: 'chat-plan',
      chatId: 'chat-plan',
      messages: ['second task'],
      adapter,
      sessions: new SessionStore(':memory:'),
      workspaces: new WorkspaceStore(':memory:'),
      activeRuns: new ActiveRuns(),
      plans,
      channel: makeChannel().channel,
      defaultWorkspace: '/tmp/project',
      runTimeoutMs: 10,
    });

    expect(stop).toHaveBeenCalledOnce();
    expect(plans.pendingCount('chat-plan', 'session-a')).toBe(1);
    plans.resolve('chat-plan', otherGate.id, { decision: 'approved' });
    await expect(otherGate.promise).resolves.toEqual({ decision: 'approved' });
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
    // Only the recovered final answer is sent; no failure message is surfaced.
    expect(fake.messages).toEqual(['recovered']);
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
    // Only the recovered final answer is sent; no hard failure is surfaced.
    expect(fake.messages).toEqual(['recovered via error event']);
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
    sessions.recordUsage('chat-a', '/tmp/project', { inputTokens: 12, outputTokens: 4 });
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
    expect(sessions.historyFor('chat-a', '/tmp/project')).toEqual([
      { role: 'user', content: 'my name is Bob' },
      { role: 'assistant', content: 'Nice to meet you.' },
      { role: 'user', content: 'new message' },
      { role: 'assistant', content: 'working…' },
    ]);
    expect(sessions.metricsFor('chat-a', '/tmp/project')).toEqual({ inputTokens: 12, outputTokens: 4 });
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
  it('auto-allows or rejects without a card according to the persisted scope policy', async () => {
    const sendCard = vi.fn();
    const sendMarkdown = vi.fn().mockResolvedValue(undefined);
    const request = {
      id: 'call-1', sessionId: 's1', toolName: 'bash', reason: 'test', options: [],
    };
    const allow = approvalHandlerFor({
      approvals: new ApprovalRegistry(), channel: { sendCard, sendMarkdown }, chatId: 'chat-a', scope: 'chat-a',
      permissionPolicies: { get: () => 'allow' } as unknown as PermissionPolicyStore,
    });
    await expect(allow(request)).resolves.toBe('allowed-once');
    const deny = approvalHandlerFor({
      approvals: new ApprovalRegistry(), channel: { sendCard, sendMarkdown }, chatId: 'chat-a', scope: 'chat-a',
      permissionPolicies: { get: () => 'deny' } as unknown as PermissionPolicyStore,
    });
    await expect(deny(request)).resolves.toBe('rejected');
    expect(sendCard).not.toHaveBeenCalled();
    expect(sendMarkdown).toHaveBeenCalledWith('chat-a', expect.stringContaining('deny'), undefined);
  });

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
    expect(sendCard).toHaveBeenCalledWith(
      'chat-a', expect.objectContaining({ schema: '2.0' }), undefined,
    );
    const id = /"cmd":"approve","id":"([^"]+)"/u.exec(
      JSON.stringify(sendCard.mock.calls[0]?.[1]),
    )?.[1];
    expect(id).toBeTruthy();
    expect(approvals.resolve('chat-a', id!, 'allowed-once')).toBe(true);
    await expect(outcome).resolves.toBe('allowed-once');
  });

  it('keeps identical upstream call ids distinct across concurrent sessions', async () => {
    const approvals = new ApprovalRegistry();
    const cards: object[] = [];
    const sendCard = vi.fn(async (_chatId: string, card: object) => {
      cards.push(card);
      return undefined;
    });
    const first = approvalHandlerFor({
      approvals, channel: { sendCard }, chatId: 'chat-a', scope: 'chat-a', ownerSessionId: 'run-a',
    })({
      id: 'same-call', sessionId: 's-a', toolName: 'bash', reason: 'A',
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    });
    const second = approvalHandlerFor({
      approvals, channel: { sendCard }, chatId: 'chat-a', scope: 'chat-a', ownerSessionId: 'run-b',
    })({
      id: 'same-call', sessionId: 's-b', toolName: 'bash', reason: 'B',
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    });
    const ids = cards.map((card) => /"cmd":"approve","id":"([^"]+)"/u.exec(JSON.stringify(card))?.[1]);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
    approvals.resolve('chat-a', ids[0]!, 'allowed-once');
    approvals.resolve('chat-a', ids[1]!, 'rejected');
    await expect(first).resolves.toBe('allowed-once');
    await expect(second).resolves.toBe('rejected');
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

describe('questionHandlerFor', () => {
  it('binds the sent card message id so a text reply can resolve the exact question', async () => {
    const questions = new QuestionRegistry();
    const sendCard = vi.fn().mockResolvedValue('question-card-message');
    const handler = questionHandlerFor({
      questions,
      channel: { sendCard },
      chatId: 'chat-a',
      scope: 'chat-a',
      sendOptions: { replyTo: 'om-source', threadId: 'thread-a' },
    });

    const answer = handler({ id: '', kind: 'text', question: 'Why?' });
    await vi.waitFor(() => {
      expect(questions.pendingForMessage('question-card-message')).toBeDefined();
    });
    const pending = questions.pendingForMessage('question-card-message');
    expect(pending?.input.question).toBe('Why?');
    expect(sendCard).toHaveBeenCalledWith(
      'chat-a',
      expect.any(Object),
      { replyTo: 'om-source', threadId: 'thread-a' },
    );
    expect(questions.resolve('chat-a', pending!.id, 'Because')).toBe(true);
    await expect(answer).resolves.toBe('Because');
  });

  it('cancels only its own question when sending its card fails', async () => {
    const questions = new QuestionRegistry();
    const other = questions.register('chat-a', { kind: 'text', question: 'Other?' });
    questions.bindMessage('chat-a', other.id, 'other-card');
    const handler = questionHandlerFor({
      questions,
      channel: { sendCard: vi.fn().mockRejectedValue(new Error('send failed')) },
      chatId: 'chat-a',
      scope: 'chat-a',
    });

    await expect(handler({ id: '', kind: 'text', question: 'Why?' })).resolves.toBeUndefined();
    expect(questions.pendingForMessage('other-card')?.id).toBe(other.id);
    questions.resolve('chat-a', other.id, 'answer');
    await expect(other.promise).resolves.toBe('answer');
  });
});
