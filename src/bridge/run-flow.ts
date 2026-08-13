import { randomUUID } from 'node:crypto';
import type { AgentAdapter, AgentEvent } from '../adapters/types.js';
import type { ActiveRuns } from '../bot/active-runs.js';
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
import type { StreamingChannel } from './types.js';

export interface RunFlowInput {
  scope: string;
  chatId: string;
  messages: string[];
  adapter: AgentAdapter;
  sessions: SessionStore;
  workspaces: WorkspaceStore;
  activeRuns: ActiveRuns;
  channel: StreamingChannel;
  defaultWorkspace: string;
  model?: string;
  stopGraceMs?: number;
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

  const cwd = input.workspaces.cwdFor(input.scope) ?? input.defaultWorkspace;
  const sessionId = input.sessions.resumeFor(input.scope, cwd);
  const prompt = input.messages.join('\n\n');
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

  try {
    await input.channel.streamCard(
      input.chatId,
      renderCard(state),
      async (controller) => {
        for await (const event of run.events) {
          state = applyEvent(state, event, stopRequested);
          if (event.type === 'system' && event.sessionId) {
            input.sessions.set(input.scope, event.sessionId, event.cwd ?? cwd);
          }
          await controller.update(renderCard(state));
        }

        state = finalizeIfRunning(state);
        await controller.update(renderCard(state));
      },
      replyOptions,
    );
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
