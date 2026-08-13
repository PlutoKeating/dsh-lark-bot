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

export interface AgentRunOptions {
  runId: string;
  prompt: string;
  cwd: string | undefined;
  sessionId: string | undefined;
  model: string | undefined;
  images: readonly string[] | undefined;
  stopGraceMs: number | undefined;
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
}

export function isTerminalEvent(event: AgentEvent): boolean {
  return event.type === 'done' || event.type === 'error';
}
