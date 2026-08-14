import { randomUUID } from 'node:crypto';
import type { AgentAdapter, AgentEvent } from '../adapters/types.js';
import type { ActiveRuns } from '../bot/active-runs.js';
import { ApprovalRegistry } from '../bot/approvals.js';
import type { DensityStore } from '../bot/density-store.js';
import type { RunPolicyStore } from '../bot/run-policy.js';
import type { QuestionRegistry } from '../bot/questions.js';
import {
  finalizeIfRunning,
  initialState,
  markIdleTimeout,
  markInterrupted,
  reduce,
  type RunState,
} from '../card/run-state.js';
import { renderCard } from '../card/run-renderer.js';
import { renderApprovalCard } from '../card/approval-card.js';
import { renderQuestionCard } from '../card/question-card.js';
import { log } from '../core/logger.js';
import type { SessionStore } from '../session/store.js';
import type { SessionArchive } from '../session/archive.js';
import type { RoleDefinition } from '../bot/role-store.js';
import type { WorkspaceStore } from '../workspace/store.js';
import type { GitWorktreeManager } from '../workspace/git-worktree.js';
import type { StreamingChannel } from './types.js';
import type { ApprovalOutcome, ApprovalRequest } from '../adapters/types.js';
import type { QuestionCardInput } from '../card/question-card.js';

export interface RunFlowInput {
  scope: string;
  chatId: string;
  messages: string[];
  adapter: AgentAdapter;
  sessions: SessionStore;
  archiver?: SessionArchive;
  role?: RoleDefinition;
  /** Live messages kept before overflow is archived; defaults to 40. */
  retention?: number;
  archiveMax?: number;
  archiveMaxAgeDays?: number;
  workspaces: WorkspaceStore;
  workspaceManager?: GitWorktreeManager;
  activeRuns: ActiveRuns;
  runPolicies?: RunPolicyStore;
  /** Max concurrent runs allowed in the scope (queue enforces; guard is a fallback). */
  maxConcurrency?: number;
  approvals?: ApprovalRegistry;
  questions?: QuestionRegistry;
  densityStore?: DensityStore;
  channel: StreamingChannel;
  defaultWorkspace: string;
  model?: string;
  stopGraceMs?: number;
  runTimeoutMs?: number;
  images?: string[];
  replyTo?: string;
}

export async function runAgentBatch(input: RunFlowInput): Promise<void> {
  const replyOptions = input.replyTo ? { replyTo: input.replyTo } : {};

  const activeBefore = input.activeRuns.count(input.scope);
  if (input.maxConcurrency !== undefined && activeBefore >= input.maxConcurrency) {
    await input.channel.sendMarkdown(input.chatId, '当前会话的并行任务数已达上限，请稍后再试或 `/stop` 部分任务。', {
      ...replyOptions,
    });
    return;
  }

  const requestedCwd = input.workspaces.cwdFor(input.scope) ?? input.defaultWorkspace;
  const workspace = input.workspaceManager
    ? await input.workspaceManager.ensure(input.scope, requestedCwd)
    : { cwd: requestedCwd };
  const cwd = workspace.cwd;
  // Only the first run in a scope resumes the native dsh session: concurrent
  // runs get fresh sessions so they never share one wire session id.
  const sessionId =
    activeBefore === 0
      ? input.sessions.resumeFor(input.scope, cwd)
      : undefined;
  const history = input.sessions.historyFor(input.scope, cwd);
  const prompt = buildPrompt(history, input.messages, input.role);
  const runId = randomUUID();

  const run = input.adapter.run({
    runId,
      prompt,
      cwd,
      sessionId,
      model: input.model,
      images: input.images,
      stopGraceMs: input.stopGraceMs,
      ...(input.approvals
        ? {
            onApprovalRequest: approvalHandlerFor({
              approvals: input.approvals,
              channel: input.channel,
              chatId: input.chatId,
              scope: input.scope,
            }),
          }
        : {}),
  });
  input.activeRuns.set(input.scope, { runId, stop: run.stop });

  let state: RunState = initialState;
  const stopRequested = { value: false };
  const timeoutMs = input.runPolicies?.get(input.scope) ?? input.runTimeoutMs ?? 0;
  let timedOut = false;
  let assistantOutput = '';
  const density = input.densityStore?.get(input.scope) ?? 'standard';

  try {
    await input.channel.streamCard(
      input.chatId,
      renderCard(state, density),
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
            await controller.update(renderCard(state, density));
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
          await controller.update(renderCard(state, density));
        } finally {
          if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
        }
      },
      replyOptions,
    );
    input.sessions.recordExchange(input.scope, cwd, input.messages, assistantOutput, {
      ...(input.retention === undefined ? {} : { retention: input.retention }),
      ...(input.archiver
        ? {
            onArchive: (overflow) =>
              input.archiver!.archive({
                scope: input.scope,
                cwd,
                messages: overflow,
                source: 'retention',
              }).then(() => pruneArchives(input)),
          }
        : {}),
    });
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
    input.activeRuns.delete(input.scope, runId);
    if (input.approvals) {
      input.approvals.settleAll(input.scope, 'cancelled');
    }
    if (input.questions) {
      input.questions.settleAll(input.scope);
    }
  }
}

async function pruneArchives(input: RunFlowInput): Promise<void> {
  if (!input.archiver) return;
  await input.archiver.prune({
    ...(input.archiveMax !== undefined && input.archiveMax > 0
      ? { maxArchives: input.archiveMax }
      : {}),
    ...(input.archiveMaxAgeDays !== undefined && input.archiveMaxAgeDays > 0
      ? { maxAgeMs: input.archiveMaxAgeDays * 24 * 60 * 60 * 1000 }
      : {}),
  });
}

/** Build the per-run approval handler wiring ACP requests to approval cards. */
export function approvalHandlerFor(
  input: {
    approvals: ApprovalRegistry | undefined;
    channel: { sendCard?: (chatId: string, card: object) => Promise<void> };
    chatId: string;
    scope: string;
  },
): (request: ApprovalRequest) => Promise<ApprovalOutcome> {
  return async (request) => {
    if (!input.approvals || !input.channel.sendCard) return 'cancelled';
    const promise = input.approvals.register(input.scope, request);
    try {
      await input.channel.sendCard(
        input.chatId,
        renderApprovalCard({
          id: request.id,
          toolName: request.toolName,
          reason: request.reason,
          options: request.options,
        }),
      );
    } catch (error) {
      log.fail('approval-card', error, { scope: input.scope });
      input.approvals.settleAll(input.scope, 'cancelled');
      return 'cancelled';
    }
    return promise;
  };
}

/** Build the per-run question handler wiring `/ask` cards back to sessions. */
export function questionHandlerFor(
  input: {
    questions: QuestionRegistry | undefined;
    channel: { sendCard?: (chatId: string, card: object) => Promise<void> };
    chatId: string;
    scope: string;
  },
): (question: QuestionCardInput) => Promise<string | string[] | undefined> {
  return async (question) => {
    if (!input.questions || !input.channel.sendCard) return undefined;
    const { id, promise } = input.questions.register(input.scope, {
      kind: question.kind,
      question: question.question,
      ...(question.options === undefined ? {} : { options: question.options }),
      ...(question.placeholder === undefined ? {} : { placeholder: question.placeholder }),
    });
    try {
      await input.channel.sendCard(input.chatId, renderQuestionCard({ ...question, id }));
    } catch (error) {
      log.fail('question-card', error, { scope: input.scope });
      input.questions.settleAll(input.scope);
      return undefined;
    }
    return promise;
  };
}

function buildPrompt(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  messages: string[],
  role: RoleDefinition | undefined,
): string {
  const rolePreamble = role ? renderRolePreamble(role) : undefined;
  const userText = messages.join('\n\n');
  if (history.length === 0 && !rolePreamble) return userText;

  const transcript = history
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n\n');

  const parts: string[] = [];
  if (rolePreamble) parts.push(rolePreamble, '');
  if (history.length > 0) {
    parts.push('Continue the conversation using the history below.', '', transcript, '');
  }
  parts.push(`Current user message:\n${userText}`);
  return parts.join('\n');
}

function renderRolePreamble(role: RoleDefinition): string {
  const lines = [
    `[Role instructions]`,
    `Role: ${role.name} (${role.id})`,
    `Persona: ${role.persona}`,
  ];
  if (role.model) lines.push(`Model preference: ${role.model}`);
  if (role.tools) lines.push(`Tools guidance: ${role.tools}`);
  if (role.agentsMd) {
    lines.push('', 'Role rules (AGENTS.md):', role.agentsMd);
  }
  lines.push(
    '',
    'Stay in this role for the whole turn unless the user explicitly changes it.',
  );
  return lines.join('\n');
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
