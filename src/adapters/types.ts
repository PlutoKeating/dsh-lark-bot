export type AgentEvent =
  | { type: 'system'; sessionId: string | undefined; cwd: string | undefined; model: string | undefined }
  | { type: 'text'; delta: string }
  | { type: 'final_text'; content: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: string; isError: boolean }
  | {
      type: 'usage';
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      costUsd?: number;
    }
  | { type: 'context_usage'; usedTokens: number; contextWindow: number }
  | { type: 'done'; sessionId: string | undefined; terminationReason: 'normal' | 'interrupted' | 'timeout' }
  | { type: 'error'; message: string; terminationReason: 'failed' | 'interrupted' | 'timeout' };

export type ApprovalOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface ApprovalOption {
  optionId: string;
  name: string;
  kind: ApprovalOptionKind;
}

export interface ApprovalRequest {
  id: string;
  /** Runtime tool-call identity shown for audit; card action uses the unique id above. */
  callId?: string;
  sessionId: string | undefined;
  toolName: string;
  reason: string | undefined;
  /** Exact arguments already presented for this tool call, when available. */
  toolInput?: unknown;
  options: readonly ApprovalOption[];
}

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

export interface AgentRunOptions {
  runId: string;
  /** Stable cancellation/runtime ownership domain (normally scope + workspace). */
  runtimeKey?: string;
  prompt: string;
  cwd: string | undefined;
  sessionId: string | undefined;
  /** Provider route for this run; adapters that bind a runtime route at
   *  construction time (SDK/ACP) rebind when it differs from the default. */
  provider?: string;
  model: string | undefined;
  images: readonly string[] | undefined;
  stopGraceMs: number | undefined;
  /** Trusted inbound transport identity used for event-log echo suppression. */
  origin?: {
    source: 'feishu';
    messageId: string;
    scope: string;
    workspaceCwd: string;
  };
  /** ACP approval channel: invoked when the agent requests a one-shot permission. */
  onApprovalRequest?: (request: ApprovalRequest) => Promise<ApprovalOutcome>;
}

export interface AgentRun {
  readonly runId: string;
  readonly events: AsyncIterable<AgentEvent>;
  stop(): Promise<void>;
  waitForExit(timeoutMs: number): Promise<boolean>;
}

export interface AgentAvailability {
  ok: boolean;
  error: string | undefined;
  version: string | undefined;
}

export interface AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  /**
   * Whether `run()` natively resumes the session identified by
   * `options.sessionId` (the SDK and web adapters do). ACP / headless always
   * start a fresh session, so the bridge replays the scope transcript into the
   * prompt for them instead.
   */
  resumeCapable?: boolean;
  /** Whether this live adapter instance still owns the named native session. */
  canResume?(options: {
    runtimeKey?: string;
    cwd: string | undefined;
    sessionId: string;
    provider?: string;
    model: string | undefined;
  }): boolean;
  isAvailable(): Promise<boolean>;
  checkAvailability(): Promise<AgentAvailability>;
  run(options: AgentRunOptions): AgentRun;
  /** Optional teardown hook called on bridge shutdown. */
  dispose?(): Promise<void>;
}

export function isTerminalEvent(event: AgentEvent): boolean {
  return event.type === 'done' || event.type === 'error';
}
