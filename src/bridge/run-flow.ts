import { randomUUID } from 'node:crypto';
import type { AgentAdapter, AgentEvent } from '../adapters/types.js';
import type { ActiveRuns } from '../bot/active-runs.js';
import type { RunPolicyStore } from '../bot/run-policy.js';
import {
  finalizeIfRunning,
  initialState,
  markIdleTimeout,
  markInterrupted,
  reduce,
  type RunState,
} from '../card/run-state.js';
import { renderCard } from '../card/run-renderer.js';
import { log } from '../core/logger.js';
import type { SessionStore } from '../session/store.js';
import type { WorkspaceStore } from '../workspace/store.js';
import type { GitWorktreeManager } from '../workspace/git-worktree.js';
import type { StreamingChannel } from './types.js';

export interface RunFlowInput {
  scope: string;
  chatId: string;
  messages: string[];
  adapter: AgentAdapter;
  sessions: SessionStore;
  workspaces: WorkspaceStore;
  workspaceManager?: GitWorktreeManager;
  activeRuns: ActiveRuns;
  runPolicies?: RunPolicyStore;
  channel: StreamingChannel;
  defaultWorkspace: string;
  model?: string;
  stopGraceMs?: number;
  runTimeoutMs?: number;
  replyTo?: string;
}

export async function runAgentBatch(input: RunFlowInput): Promise<void> {
  const replyOptions = input.replyTo ? { replyTo: input.replyTo } : {};

  if (input.activeRuns.get(input.scope)) {
    await input.channel.sendMarkdown(input.chatId, '当前会话已有任务正在运行，请先 `/stop` 或等待完成。', {
      ...replyOptions,
    });
    return;
  }

  const requestedCwd = input.workspaces.cwdFor(input.scope) ?? input.defaultWorkspace;
  const workspace = input.workspaceManager
    ? await input.workspaceManager.ensure(input.scope, requestedCwd)
    : { cwd: requestedCwd };
  const cwd = workspace.cwd;
  const sessionId = input.sessions.resumeFor(input.scope, cwd);
  const history = input.sessions.historyFor(input.scope, cwd);
  const prompt = buildPrompt(history, input.messages);
  const runId = randomUUID();

  const run = input.adapter.run({
    runId,
      prompt,
      cwd,
      sessionId,
      model: input.model,
      images: undefined,
      stopGraceMs: input.stopGraceMs,
  });
  input.activeRuns.set(input.scope, { runId, stop: run.stop });

  let state: RunState = initialState;
  const stopRequested = { value: false };
  const timeoutMs = input.runPolicies?.get(input.scope) ?? input.runTimeoutMs ?? 0;
  let timedOut = false;
  let assistantOutput = '';

  try {
    await input.channel.streamCard(
      input.chatId,
      renderCard(state),
      async (controller) => {
        const consume = async (): Promise<void> => {
          for await (const event of run.events) {
            if (timedOut) return;
            state = applyEvent(state, event, stopRequested);
            if (event.type === 'final_text') {
              assistantOutput = event.content;
            } else if (event.type === 'text') {
              assistantOutput += event.delta;
            }
            if (event.type === 'system' && event.sessionId) {
              input.sessions.set(input.scope, event.sessionId, event.cwd ?? cwd);
            }
            await controller.update(renderCard(state));
          }
        };

        let timeoutTimer: NodeJS.Timeout | undefined;
        const timeoutPromise =
          timeoutMs > 0
            ? new Promise<void>((resolve) => {
                timeoutTimer = setTimeout(() => {
                  timedOut = true;
                  void run.stop();
                  resolve();
                }, timeoutMs);
              })
            : undefined;

        try {
          if (timeoutPromise) {
            await Promise.race([consume(), timeoutPromise]);
          } else {
            await consume();
          }

          state = timedOut
            ? markIdleTimeout(state, timeoutMs / 60_000)
            : finalizeIfRunning(state);
          await controller.update(renderCard(state));
        } finally {
          if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
        }
      },
      replyOptions,
    );
    input.sessions.recordExchange(input.scope, cwd, input.messages, assistantOutput);
  } catch (error) {
    log.fail('run-flow', error, { scope: input.scope, runId });
    state = markInterrupted(state);
    try {
      await input.channel.sendMarkdown(input.chatId, `⚠️ agent 运行失败：${errorMessage(error)}`, {
        ...replyOptions,
      });
    } catch {
      // best effort; the card may already have failed
    }
  } finally {
    input.activeRuns.delete(input.scope);
  }
}

function buildPrompt(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  messages: string[],
): string {
  if (history.length === 0) return messages.join('\n\n');

  const transcript = history
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n\n');

  return [
    'Continue the conversation using the history below.',
    '',
    transcript,
    '',
    `Current user message:\n${messages.join('\n\n')}`,
  ].join('\n');
}

function applyEvent(
  state: RunState,
  event: AgentEvent,
  stopRequested: { value: boolean },
): RunState {
  if (event.type === 'done' && event.terminationReason === 'interrupted') {
    stopRequested.value = true;
    return markInterrupted(state);
  }
  if (event.type === 'error' && event.terminationReason === 'timeout') {
    return markIdleTimeout(state, 0);
  }
  return reduce(state, event);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
