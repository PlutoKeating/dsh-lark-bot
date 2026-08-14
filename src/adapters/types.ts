export type AgentEvent =
  | { type: 'system'; sessionId: string | undefined; cwd: string | undefined; model: string | undefined }
  | { type: 'text'; delta: string }
  | { type: 'final_text'; content: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: string; isError: boolean }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number }
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
  sessionId: string | undefined;
  toolName: string;
  reason: string | undefined;
  options: readonly ApprovalOption[];
}

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled';

export interface AgentRunOptions {
  runId: string;
  prompt: string;
  cwd: string | undefined;
  sessionId: string | undefined;
  model: string | undefined;
  images: readonly string[] | undefined;
  stopGraceMs: number | undefined;
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
  isAvailable(): Promise<boolean>;
  checkAvailability(): Promise<AgentAvailability>;
  run(options: AgentRunOptions): AgentRun;
  /** Optional teardown hook called on bridge shutdown. */
  dispose?(): Promise<void>;
}

export function isTerminalEvent(event: AgentEvent): boolean {
  return event.type === 'done' || event.type === 'error';
}
