import { randomUUID } from 'node:crypto';
import type { AgentAdapter, AgentEvent } from '../adapters/types.js';
import type { ActiveRuns } from '../bot/active-runs.js';
import { ApprovalRegistry } from '../bot/approvals.js';
import type { DensityStore } from '../bot/density-store.js';
import type { RunPolicyStore } from '../bot/run-policy.js';
import type { QuestionRegistry } from '../bot/questions.js';
import type { PlanApprovalRegistry } from '../bot/plan-approvals.js';
import {
  finalizeIfRunning,
  initialState,
  markFinalDeliveryFailed,
  markIdleTimeout,
  markInterrupted,
  reduce,
  type RunState,
} from '../card/run-state.js';
import { renderCard, renderLegacyCard } from '../card/run-renderer.js';
import { renderSessionRecoveryCard } from '../card/session-recovery-card.js';
import { bilingualMarkdown } from '../card/i18n.js';
import { renderApprovalCard } from '../card/approval-card.js';
import { renderQuestionCard } from '../card/question-card.js';
import { log } from '../core/logger.js';
import type { SessionStore } from '../session/store.js';
import type { SessionArchive } from '../session/archive.js';
import type { RoleDefinition } from '../bot/role-store.js';
import type { WorkspaceStore } from '../workspace/store.js';
import type { GitWorktreeManager } from '../workspace/git-worktree.js';
import type { CardStreamController, StreamingChannel } from './types.js';
import type { ApprovalOutcome, ApprovalRequest } from '../adapters/types.js';
import type { QuestionCardInput } from '../card/question-card.js';
import { archiveSessionDir, classifySessionError } from '../session/heal.js';
import type { SendOptions } from './send-options.js';
import type { PermissionPolicyStore } from '../bot/permission-policy-store.js';
import type { ExecutionMode } from '../bot/execution-mode-store.js';
import { permissionPolicyDenial, policyDenialText } from '../policy/tool-policy.js';
import { renderChannelContext, type ChannelContext } from './channel-context.js';

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
  /** Workspace selected when the inbound batch was queued; immutable for this run. */
  workspaceCwd?: string;
  workspaceManager?: GitWorktreeManager;
  activeRuns: ActiveRuns;
  runPolicies?: RunPolicyStore;
  /** Max concurrent runs allowed in the scope (queue enforces; guard is a fallback). */
  maxConcurrency?: number;
  approvals?: ApprovalRegistry;
  permissionPolicies?: PermissionPolicyStore;
  onApprovalWaiting?: (scope: string, toolName: string) => () => void;
  questions?: QuestionRegistry;
  plans?: PlanApprovalRegistry;
  densityStore?: DensityStore;
  channel: StreamingChannel;
  defaultWorkspace: string;
  /** Provider route resolved from `model` (hot-switch support). */
  provider?: string;
  model?: string;
  /** Snapshotted when this run starts; later /mode changes affect only later runs. */
  executionMode?: ExecutionMode;
  stopGraceMs?: number;
  runTimeoutMs?: number;
  images?: string[];
  replyTo?: string;
  /** Optional per-scope final-answer batching/rate-limit seam. */
  deliverFinalReply?: (
    scope: string,
    chatId: string,
    markdown: string,
    options?: SendOptions,
  ) => Promise<void>;
  /** Visible member identity when the group uses member-isolated scopes. */
  scopeOwner?: string;
  /** Trusted peer identities available for an explicit lark_notify handoff. */
  collaborationPeers?: Array<{ name: string; openId: string; displayName?: string }>;
  /** Non-secret bridge metadata injected on every fresh and resumed turn. */
  channelContext?: ChannelContext;
  onCheckpoint?: (checkpoint: {
    runId: string;
    stage: 'starting' | 'thinking' | 'tool' | 'responding' | 'finalizing';
    detail?: string;
    nativeSessionId?: string;
  }) => void | Promise<void>;
}

export type RunBatchOutcome = 'completed' | 'failed' | 'interrupted';

export async function runAgentBatch(input: RunFlowInput): Promise<RunBatchOutcome> {
  const replyOptions = input.replyTo ? { replyTo: input.replyTo } : {};

  const activeBefore = input.activeRuns.count(input.scope);
  if (input.maxConcurrency !== undefined && activeBefore >= input.maxConcurrency) {
    await input.channel.sendMarkdown(input.chatId, bilingualMarkdown(
      '当前会话的并行任务数已达上限，请稍后再试或 `/stop` 部分任务。',
      'This session has reached its parallel-task limit. Try again later or use `/stop` to stop some tasks.',
    ), {
      ...replyOptions,
    });
    return 'failed';
  }

  const requestedCwd = input.workspaceCwd ??
    input.workspaces.cwdFor(input.scope) ?? input.defaultWorkspace;
  const activeInWorkspace = input.activeRuns.countWorkspace(input.scope, requestedCwd);
  const workspace = input.workspaceManager
    ? await input.workspaceManager.ensure(input.scope, requestedCwd)
    : { cwd: requestedCwd };
  const cwd = workspace.cwd;
  // Only the first run in this scope+workspace resumes its native dsh session:
  // concurrent runs in the same workspace get fresh wire session ids, while a
  // sibling workspace may safely resume its own independent binding.
  const runtimeKey = `${input.scope}\0${requestedCwd ?? ''}`;
  const storedSessionId =
    activeInWorkspace === 0
      ? input.sessions.resumeFor(input.scope, requestedCwd)
      : undefined;
  const resuming =
    storedSessionId !== undefined &&
    input.adapter.resumeCapable === true &&
    (input.adapter.canResume?.({
      runtimeKey,
      cwd,
      sessionId: storedSessionId,
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      model: input.model,
    }) ?? true);
  const sessionId = resuming ? storedSessionId : undefined;

  try {
    return terminalOutcome(await runAttempt(input, cwd, requestedCwd, sessionId, resuming, replyOptions));
  } catch (error) {
    if (resuming && classifySessionError(errorMessage(error)) !== undefined) {
      // A native-session resume can be rejected by the dsh runtime when its
      // persisted log no longer matches the live session (e.g. the previous
      // run was interrupted mid-stream). Fall back to a fresh session so the
      // user's message is still handled; the scope transcript is replayed.
      log.warn('run-flow', 'resume-fallback', { scope: input.scope, sessionId });
      // Self-heal v2: a genuinely corrupt persisted log (seq gap) is archived
      // so the session list stays clean; the id-collision class only resets
      // the binding and keeps the history recoverable.
      if (sessionId !== undefined && classifySessionError(errorMessage(error)) === 'corrupt') {
        try {
          const archived = await archiveSessionDir(sessionId);
          if (archived.archivePath !== undefined) {
            log.info('session', 'heal-archived', {
              sessionId,
              archivePath: archived.archivePath,
            });
          }
        } catch (archiveError) {
          log.fail('session', 'heal-archive-failed', {
            sessionId,
            error: archiveError,
          });
        }
      }
      input.sessions.clearSession(input.scope, requestedCwd);
      try {
        return terminalOutcome(
          await runAttempt(input, cwd, requestedCwd, undefined, false, replyOptions),
        );
      } catch (retryError) {
        log.fail('run-flow', retryError, {
          scope: input.scope,
          step: 'resume-fallback',
        });
        await reportRunFailure(input, retryError, replyOptions);
        return 'failed';
      }
    }
    await reportRunFailure(input, error, replyOptions);
    return 'failed';
  }
}

async function reportRunFailure(
  input: RunFlowInput,
  error: unknown,
  replyOptions: Record<string, unknown>,
): Promise<void> {
  log.fail('run-flow', error, { scope: input.scope });
  try {
    await input.channel.sendMarkdown(
      input.chatId,
      bilingualMarkdown(`⚠️ agent 运行失败：${errorMessage(error)}`, `⚠️ Agent run failed: ${errorMessage(error)}`),
      replyOptions,
    );
  } catch {
    // best effort; the card may already have failed
  }
}

async function runAttempt(
  input: RunFlowInput,
  cwd: string,
  workspaceCwd: string,
  sessionId: string | undefined,
  resuming: boolean,
  replyOptions: Record<string, unknown>,
): Promise<Exclude<RunState['terminal'], 'running'>> {
  // A native-resuming adapter (SDK) already has the conversation persisted in
  // the dsh session; replaying the transcript would duplicate it and can drift
  // from the runtime log. Fresh runs (and non-resuming adapters) replay it.
  const history = resuming ? [] : input.sessions.historyFor(input.scope, workspaceCwd);
  const prompt = buildPrompt(history, input.messages, input.role, input.collaborationPeers, input.executionMode ?? 'balanced', input.channelContext);
  const runId = randomUUID();

  const run = input.adapter.run({
    runId,
    runtimeKey: `${input.scope}\0${workspaceCwd ?? ''}`,
    prompt,
    cwd,
    sessionId,
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    model: input.model,
    images: input.images,
    stopGraceMs: input.stopGraceMs,
    ...(input.replyTo
      ? {
          origin: {
            source: 'feishu' as const,
            messageId: input.replyTo,
            scope: input.scope,
            workspaceCwd,
          },
        }
      : {}),
    ...(input.approvals
      ? {
          onApprovalRequest: approvalHandlerFor({
            approvals: input.approvals,
            channel: input.channel,
            chatId: input.chatId,
            scope: input.scope,
            ownerSessionId: runId,
            sendOptions: replyOptions,
            ...(input.permissionPolicies ? { permissionPolicies: input.permissionPolicies } : {}),
            ...(input.onApprovalWaiting ? { onApprovalWaiting: input.onApprovalWaiting } : {}),
          }),
        }
      : {}),
  });
  input.activeRuns.set(input.scope, { runId, workspaceCwd, stop: run.stop });

  const now = Date.now();
  let state: RunState = {
    ...initialState,
    startedAtMs: now,
    lastActivityMs: now,
    scopeOwner: input.scopeOwner,
    actionScope: input.scope,
    actionRunId: runId,
  };
  const stopRequested = { value: false };
  const timeoutMs = input.runPolicies?.get(input.scope) ?? input.runTimeoutMs ?? 0;
  let timedOut = false;
  let assistantOutput = '';
  let sawActivity = false;
  let resumeFailure: string | undefined;
  let activeSessionId = sessionId;
  let activeModel = modelRoute(input.provider, input.model);
  const density = input.densityStore?.get(input.scope) ?? 'standard';
  let checkpointKey = '';
  const emitCheckpoint = async (value: Parameters<NonNullable<RunFlowInput['onCheckpoint']>>[0]): Promise<void> => {
    try {
      await input.onCheckpoint?.(value);
    } catch (error) {
      // Checkpoint persistence is observability, not execution control. A
      // transient disk failure must not abandon a live adapter run; the
      // already-durable running receipt will be reconciled after restart.
      log.warn('run-flow', 'checkpoint-failed', {
        scope: input.scope,
        runId,
        stage: value.stage,
        error,
      });
    }
  };
  const checkpoint = async (
    stage: 'thinking' | 'tool' | 'responding' | 'finalizing',
    detail?: string,
  ): Promise<void> => {
    const key = `${stage}:${detail ?? ''}:${activeSessionId ?? ''}`;
    if (key === checkpointKey) return;
    checkpointKey = key;
    await emitCheckpoint({
      runId,
      stage,
      ...(detail ? { detail } : {}),
      ...(activeSessionId ? { nativeSessionId: activeSessionId } : {}),
    });
  };

  try {
    await emitCheckpoint({
      runId,
      stage: 'starting',
      ...(sessionId ? { nativeSessionId: sessionId } : {}),
    });
    const produceCard = async (
      controller: CardStreamController,
      renderer: typeof renderCard,
    ): Promise<void> => {
        const safeUpdate = async (): Promise<void> => {
          try {
            await controller.update(renderer(state, density, Date.now()));
          } catch (error) {
            log.warn('run-flow', 'card-update-failed', { scope: input.scope, error });
          }
        };
        const showResumeRecovery = async (error: unknown): Promise<void> => {
          if (classifySessionError(errorMessage(error)) === undefined) throw error;
          resumeFailure = errorMessage(error);
          try {
            await controller.update(renderSessionRecoveryCard());
          } catch (updateError) {
            log.warn('run-flow', 'resume-recovery-card-failed', {
              scope: input.scope,
              error: updateError,
            });
          }
        };
        let timeoutTimer: NodeJS.Timeout | undefined;
        let armTimeout: (() => void) | undefined;
        const ticker = setInterval(() => {
          void controller.update(renderer(state, density, Date.now())).catch(() => {
            // The card may already be closed; the event loop still owns the
            // final state transition below.
          });
        }, 5_000);
        ticker.unref?.();
        const consume = async (): Promise<void> => {
          for await (const event of run.events) {
            if (timedOut) return;
            if (
              resuming &&
              !sawActivity &&
              event.type === 'error' &&
              event.terminationReason === 'failed'
            ) {
              await showResumeRecovery(event.message);
              return;
            }
            state = applyEvent(state, event, stopRequested);
            state = { ...state, lastActivityMs: Date.now() };
            // Self-heal: a broken-session error must not destroy the log. Only
            // genuinely corrupt logs (seq gap / unparsable) are archived; the
            // id-collision class just resets the chat mapping and keeps the
            // persisted history recoverable. A native-session resume failure
            // before any activity is left to the resume-fallback in
            // `runAgentBatch` (fresh-session retry) so the user's message is
            // still handled — it is not consumed here.
            const healKind =
              event.type === 'error' && event.terminationReason === 'failed'
                ? classifySessionError(event.message)
                : undefined;
            if (
              event.type === 'error' &&
              event.terminationReason === 'failed' &&
              healKind !== undefined &&
              !(resuming && !sawActivity)
            ) {
              const brokenId = input.sessions.getRaw(input.scope, workspaceCwd)?.sessionId;
              if (brokenId !== undefined) {
                let archivePath: string | undefined;
                if (healKind === 'corrupt') {
                  try {
                    const archived = await archiveSessionDir(brokenId);
                    archivePath = archived.archivePath;
                    if (archivePath !== undefined) {
                      log.info('session', 'heal-archived', {
                        sessionId: brokenId,
                        archivePath,
                      });
                    }
                  } catch (error) {
                    log.fail('session', 'heal-archive-failed', {
                      sessionId: brokenId,
                      error,
                    });
                  }
                }
                input.sessions.clearSession(input.scope, workspaceCwd);
                await input.channel.sendMarkdown(
                  input.chatId,
                  healKind === 'corrupt'
                    ? bilingualMarkdown(
                        `⚠️ 会话记录损坏，已归档并重置（归档：\`${archivePath ?? '归档失败'}\`）。请重新发送你的消息。`,
                        `⚠️ The session record was corrupt, so it was archived and reset (archive: \`${archivePath ?? 'archive failed'}\`). Please send your message again.`,
                      )
                    : bilingualMarkdown(
                        '⚠️ 会话状态异常，已重置会话映射（历史日志保留，未删除）。请重新发送你的消息。',
                        '⚠️ The session state was invalid, so its binding was reset. History was preserved. Please send your message again.',
                      ),
                  { ...replyOptions },
                );
                void run.stop();
                return;
              }
            }
            if (event.type === 'final_text') {
              assistantOutput = event.content;
            } else if (event.type === 'text') {
              assistantOutput += event.delta;
            }
            if (event.type === 'system' && event.sessionId) {
              activeSessionId = event.sessionId;
              activeModel = modelRoute(input.provider, event.model ?? input.model);
              input.sessions.set(input.scope, event.sessionId, workspaceCwd);
            }
            if (event.type === 'thinking') await checkpoint('thinking');
            if (event.type === 'tool_use') await checkpoint('tool', event.name);
            if (event.type === 'text' || event.type === 'final_text') await checkpoint('responding');
            if (event.type === 'tool_use' && activeSessionId !== undefined) {
              input.approvals?.recordToolCall(activeSessionId, event.id, event.input);
            }
            if (event.type === 'usage') {
              input.sessions.recordUsage(input.scope, workspaceCwd, {
                ...(event.inputTokens === undefined ? {} : { inputTokens: event.inputTokens }),
                ...(event.outputTokens === undefined ? {} : { outputTokens: event.outputTokens }),
                ...(event.cacheReadTokens === undefined
                  ? {}
                  : { cacheReadTokens: event.cacheReadTokens }),
                ...(event.cacheWriteTokens === undefined
                  ? {}
                  : { cacheWriteTokens: event.cacheWriteTokens }),
              });
            } else if (event.type === 'context_usage') {
              if (activeSessionId !== undefined && activeModel !== undefined) {
                input.sessions.recordContextUsage(input.scope, workspaceCwd, {
                  usedTokens: event.usedTokens,
                  contextWindow: event.contextWindow,
                  sessionId: activeSessionId,
                  model: activeModel,
                });
              }
            }
            if (event.type !== 'system' && event.type !== 'error') {
              sawActivity = true;
            }
            // Every agent event counts as activity: restart the idle window so
            // a long but responsive run is never killed by the wall clock.
            armTimeout?.();
            await safeUpdate();
          }
        };
        const consumeWithResumeRecovery = async (): Promise<void> => {
          try {
            await consume();
          } catch (error) {
            if (resuming && !sawActivity) {
              await showResumeRecovery(error);
              return;
            }
            throw error;
          }
        };

        // Idle watchdog: armed once, then re-armed on every agent event (and
        // after a human decision card is answered). Only a run that goes silent for
        // the configured window is stopped — active work is never cut short.
        const timeoutPromise =
          timeoutMs > 0
            ? new Promise<void>((resolve) => {
                armTimeout = (): void => {
                  if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
                  timeoutTimer = setTimeout(() => {
                    if (timedOut) return;
                    if (
                      (activeSessionId !== undefined &&
                        input.questions?.pendingCount(input.scope, activeSessionId)) ||
                      (activeSessionId !== undefined &&
                        input.plans?.pendingCount(input.scope, activeSessionId))
                      || input.approvals?.pendingCount(input.scope, runId)
                      || (activeSessionId !== undefined &&
                        input.approvals?.pendingCount(input.scope, activeSessionId))
                    ) {
                      // A question, plan, or tool approval is awaiting the user: keep the task
                      // alive; the onSettled handler re-arms once answered.
                      armTimeout?.();
                      return;
                    }
                    timedOut = true;
                    void run.stop();
                    resolve();
                  }, timeoutMs);
                };
                armTimeout();
              })
            : undefined;
        // The user answered a card: restart a full idle window so time spent
        // waiting for input never eats into the next stretch of work.
        const rearmAfterHumanInput = (): void => {
          if (timedOut) return;
          if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
          armTimeout?.();
        };
        const unsubscribeQuestion = timeoutPromise
          ? input.questions?.onSettled(input.scope, (settledSessionId) => {
              if (settledSessionId === activeSessionId) rearmAfterHumanInput();
            })
          : undefined;
        const unsubscribePlan = timeoutPromise
          ? input.plans?.onSettled(input.scope, (settledSessionId) => {
              if (settledSessionId === activeSessionId) rearmAfterHumanInput();
            })
          : undefined;
        const unsubscribeApproval = timeoutPromise
          ? input.approvals?.onSettled(input.scope, (settledSessionId) => {
              if (settledSessionId === runId || settledSessionId === activeSessionId) rearmAfterHumanInput();
            })
          : undefined;

        try {
          if (timeoutPromise) {
            await Promise.race([consumeWithResumeRecovery(), timeoutPromise]);
          } else {
            await consumeWithResumeRecovery();
          }

          if (resumeFailure !== undefined) return;

          state = timedOut
            ? markIdleTimeout(state, timeoutMs / 60_000)
            : finalizeIfRunning(state);
          await safeUpdate();
          await checkpoint('finalizing');
          if (state.terminal === 'done' && assistantOutput.trim() !== '') {
            try {
              await (input.deliverFinalReply
                ? input.deliverFinalReply(input.scope, input.chatId, assistantOutput, { ...replyOptions })
                : input.channel.sendMarkdown(input.chatId, assistantOutput, { ...replyOptions }));
            } catch (error) {
              const message = errorMessage(error);
              log.fail('run-flow', error, { scope: input.scope, step: 'final-answer' });
              state = markFinalDeliveryFailed(state, message, assistantOutput);
              await safeUpdate();
            }
          }
        } finally {
          clearInterval(ticker);
          if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
          unsubscribeQuestion?.();
          unsubscribePlan?.();
          unsubscribeApproval?.();
        }
    };
    let producerStarted = false;
    let producerCompleted = false;
    const streamWith = async (renderer: typeof renderCard): Promise<void> => {
      await input.channel.streamCard(
        input.chatId,
        renderer(state, density),
        async (controller) => {
          producerStarted = true;
          await produceCard(controller, renderer);
          producerCompleted = true;
        },
        replyOptions,
      );
    };
    try {
      await streamWith(renderCard);
    } catch (error) {
      if (producerStarted && !producerCompleted) throw error;
      if (producerCompleted) {
        log.warn('run-flow', 'card-stream-finalize-failed', { scope: input.scope, error });
      } else {
        log.warn('run-flow', 'native-card-fallback', { scope: input.scope, error });
      }
      if (!producerStarted) {
        try {
          await streamWith(renderLegacyCard);
        } catch (fallbackError) {
          log.warn('run-flow', 'legacy-card-failed', { scope: input.scope, error: fallbackError });
          if (producerStarted && !producerCompleted) throw fallbackError;
          if (!producerStarted) {
            await produceCard({ update: async () => {} }, renderLegacyCard);
          }
        }
      }
    }
    if (resumeFailure !== undefined) {
      throw new Error(resumeFailure);
    }
    // SDK adapters surface session-level failures (e.g. a resume rejected by
    // dsh's persistence layer with "id collision") as an error EVENT rather
    // than a thrown error. When we were resuming a native session and the run
    // failed before any real activity, the persisted session itself is
    // unusable: throw so the caller clears the binding and retries with a
    // fresh session instead of leaving the user with a hard failure card.
    if (resuming && state.terminal === 'error' && !sawActivity) {
      throw new Error(state.errorMsg ?? 'native session resume failed');
    }
    input.sessions.recordExchange(input.scope, workspaceCwd, input.messages, assistantOutput, {
      ...(input.retention === undefined ? {} : { retention: input.retention }),
      ...(input.archiver
        ? {
            onArchive: (overflow) =>
              input.archiver!.archive({
                scope: input.scope,
                cwd: workspaceCwd,
                messages: overflow,
                source: 'retention',
              }).then(() => pruneArchives(input, workspaceCwd)),
          }
        : {}),
    });
  } catch (error) {
    state = markInterrupted(state);
    // A failed native-session resume (thrown above when `resuming` and no
    // activity yet) must propagate so `runAgentBatch` clears the binding and
    // retries with a fresh session — do not swallow it here.
    if (resuming && !sawActivity) {
      log.warn('run-flow', 'resume-attempt-failed', { scope: input.scope, runId });
      throw error;
    }
    log.fail('run-flow', error, { scope: input.scope, runId });
    const runErrorText = errorMessage(error);
    const healKind = classifySessionError(runErrorText);
    if (healKind !== undefined) {
      const brokenSessionId = input.sessions.getRaw(input.scope, workspaceCwd)?.sessionId;
      if (brokenSessionId !== undefined) {
        let archivePath: string | undefined;
        if (healKind === 'corrupt') {
          try {
            const archived = await archiveSessionDir(brokenSessionId);
            archivePath = archived.archivePath;
            if (archivePath !== undefined) {
              log.info('session', 'heal-archived', {
                sessionId: brokenSessionId,
                archivePath,
              });
            }
          } catch (archiveError) {
            log.fail('session', 'heal-archive-failed', {
              sessionId: brokenSessionId,
              error: archiveError,
            });
          }
        }
        input.sessions.clearSession(input.scope, workspaceCwd);
        await input.channel.sendMarkdown(
          input.chatId,
          healKind === 'corrupt'
            ? bilingualMarkdown(
                `⚠️ 会话记录损坏，已归档并重置（归档：\`${archivePath ?? '归档失败'}\`）。请重新发送你的消息。`,
                `⚠️ The session record was corrupt, so it was archived and reset (archive: \`${archivePath ?? 'archive failed'}\`). Please send your message again.`,
              )
            : bilingualMarkdown(
                '⚠️ 会话状态异常，已重置会话映射（历史日志保留，未删除）。请重新发送你的消息。',
                '⚠️ The session state was invalid, so its binding was reset. History was preserved. Please send your message again.',
              ),
          { ...replyOptions },
        );
        return 'error';
      }
    }
    try {
      await input.channel.sendMarkdown(input.chatId, bilingualMarkdown(`⚠️ agent 运行失败：${runErrorText}`, `⚠️ Agent run failed: ${runErrorText}`), {
        ...replyOptions,
      });
    } catch {
      // best effort; the card may already have failed
    }
    return 'error';
  } finally {
    input.activeRuns.delete(input.scope, runId);
    if (input.approvals) {
      input.approvals.settleSession(input.scope, runId, 'cancelled');
      if (activeSessionId !== undefined) {
        input.approvals.settleSession(input.scope, activeSessionId, 'cancelled');
        input.approvals.clearToolCalls(activeSessionId);
      }
    }
    if (input.questions && activeSessionId !== undefined) {
      input.questions.settleSession(input.scope, activeSessionId);
    }
    if (input.plans && activeSessionId !== undefined) {
      input.plans.settleSession(input.scope, activeSessionId);
    }
  }
  return state.terminal === 'running' ? 'interrupted' : state.terminal;
}

function terminalOutcome(terminal: Exclude<RunState['terminal'], 'running'>): RunBatchOutcome {
  if (terminal === 'done') return 'completed';
  if (terminal === 'interrupted' || terminal === 'idle_timeout') return 'interrupted';
  return 'failed';
}

function modelRoute(provider: string | undefined, model: string | undefined): string | undefined {
  if (model === undefined) return undefined;
  return provider === undefined ? model : `${provider}/${model}`;
}

async function pruneArchives(input: RunFlowInput, workspaceCwd: string): Promise<void> {
  if (!input.archiver) return;
  await input.archiver.prune({
    scope: input.scope,
    cwd: workspaceCwd,
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
    channel: {
      sendCard?: (
        chatId: string,
        card: object,
        options?: SendOptions,
      ) => Promise<string | undefined>;
      sendMarkdown?: (
        chatId: string,
        markdown: string,
        options?: SendOptions,
      ) => Promise<void>;
    };
    chatId: string;
    scope: string;
    ownerSessionId?: string;
    sendOptions?: SendOptions;
    permissionPolicies?: PermissionPolicyStore;
    onApprovalWaiting?: (scope: string, toolName: string) => () => void;
  },
): (request: ApprovalRequest) => Promise<ApprovalOutcome> {
  return async (request) => {
    const policy = input.permissionPolicies?.get(input.scope) ?? 'ask';
    if (policy === 'allow') return 'allowed-once';
    if (policy === 'deny') {
      const denial = permissionPolicyDenial(input.scope, request.toolName);
      try {
        await input.channel.sendMarkdown?.(
          input.chatId,
          bilingualMarkdown(
            `⛔ **权限策略拒绝**\n\n\`\`\`text\n${policyDenialText(denial)}\n\`\`\``,
            `⛔ **Permission policy denial**\n\n\`\`\`text\n${policyDenialText(denial)}\n\`\`\``,
          ),
          input.sendOptions,
        );
      } catch (error) {
        log.warn('approval-policy', 'deny-notice-failed', { scope: input.scope, error });
      }
      return 'rejected';
    }
    if (!input.approvals || !input.channel.sendCard) return 'cancelled';
    const cardRequest: ApprovalRequest = {
      ...request,
      id: `approval-${randomUUID().replaceAll('-', '')}`,
      callId: request.callId ?? request.id,
    };
    const promise = input.approvals.register(input.scope, cardRequest, input.ownerSessionId);
    try {
      await input.channel.sendCard(
        input.chatId,
        renderApprovalCard({
          id: cardRequest.id,
          ...(cardRequest.callId === undefined ? {} : { callId: cardRequest.callId }),
          toolName: cardRequest.toolName,
          reason: cardRequest.reason,
          ...(cardRequest.toolInput === undefined ? {} : { toolInput: cardRequest.toolInput }),
          options: cardRequest.options,
          actionScope: input.scope,
        }),
        input.sendOptions,
      );
    } catch (error) {
      log.fail('approval-card', error, { scope: input.scope });
      input.approvals.cancel(input.scope, cardRequest.id);
      return 'cancelled';
    }
    const cancelReminder = input.onApprovalWaiting?.(input.scope, cardRequest.toolName);
    try {
      return await promise;
    } finally {
      cancelReminder?.();
    }
  };
}

/** Build the per-run question handler wiring `/ask` cards back to sessions. */
export function questionHandlerFor(
  input: {
    questions: QuestionRegistry | undefined;
    channel: {
      sendCard?: (
        chatId: string,
        card: object,
        options?: SendOptions,
      ) => Promise<string | undefined>;
    };
    chatId: string;
    scope: string;
    ownerSessionId?: string;
    sendOptions?: SendOptions;
  },
): (question: QuestionCardInput) => Promise<string | string[] | undefined> {
  return async (question) => {
    if (!input.questions || !input.channel.sendCard) return undefined;
    const { id, promise } = input.questions.register(input.scope, {
      kind: question.kind,
      question: question.question,
      ...(question.options === undefined ? {} : { options: question.options }),
      ...(question.placeholder === undefined ? {} : { placeholder: question.placeholder }),
    }, input.ownerSessionId);
    try {
      const messageId = await input.channel.sendCard(
        input.chatId,
        renderQuestionCard({ ...question, id, actionScope: input.scope }),
        input.sendOptions,
      );
      if (messageId) input.questions.bindMessage(input.scope, id, messageId);
    } catch (error) {
      log.fail('question-card', error, { scope: input.scope });
      input.questions.cancel(input.scope, id);
      return undefined;
    }
    return promise;
  };
}

function buildPrompt(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  messages: string[],
  role: RoleDefinition | undefined,
  collaborationPeers: RunFlowInput['collaborationPeers'],
  executionMode: ExecutionMode,
  channelContext?: ChannelContext,
): string {
  const rolePreamble = role ? renderRolePreamble(role) : undefined;
  const collaborationPreamble = renderCollaborationPreamble(collaborationPeers);
  const executionPreamble = renderExecutionModePreamble(executionMode);
  const userText = messages.join('\n\n');

  const transcript = history
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n\n');

  const parts: string[] = [];
  if (channelContext) parts.push(renderChannelContext(channelContext), '');
  parts.push(executionPreamble, '');
  if (rolePreamble) parts.push(rolePreamble, '');
  if (collaborationPreamble) parts.push(collaborationPreamble, '');
  if (history.length > 0) {
    parts.push('Continue the conversation using the history below.', '', transcript, '');
  }
  parts.push(`Current user message:\n${userText}`);
  return parts.join('\n');
}

function renderExecutionModePreamble(mode: ExecutionMode): string {
  const guidance = mode === 'quick'
    ? 'Answer directly with only the necessary investigation and verification. Prefer the shortest reliable path.'
    : mode === 'deep'
      ? 'Investigate thoroughly and verify assumptions and results. Use additional checks when they materially reduce uncertainty.'
      : 'Balance speed with reasonable investigation and verification. Use the normal reliable workflow for the task.';
  return [
    `[Execution mode: ${mode}]`,
    guidance,
    'Do not bypass safety, permission, or plan-approval requirements, and do not expand the user-requested scope.',
  ].join('\n');
}

function renderCollaborationPreamble(
  peers: RunFlowInput['collaborationPeers'],
): string | undefined {
  if (!peers || peers.length === 0) return undefined;
  return [
    '[Trusted bot collaboration peers]',
    ...peers.map((peer) =>
      `- ${peer.name}${peer.displayName ? ` (${peer.displayName})` : ''}: open_id=${peer.openId}`
    ),
    'When the user or your assigned workflow requests a handoff, call lark_notify for the current chat/scope, include a concise result/next-step summary, and pass exactly one listed open_id in mention_user_ids. Never guess an identity or start an unrequested bot loop.',
  ].join('\n');
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
