import type { AgentEvent } from '../adapters/types.js';

export type ToolStatus = 'running' | 'done' | 'error';

export interface ToolEntry {
  id: string;
  name: string;
  input: unknown;
  status: ToolStatus;
  output?: string;
}

export type Block =
  | { kind: 'text'; content: string; streaming: boolean }
  | { kind: 'tool'; tool: ToolEntry };

export type FooterStatus = 'thinking' | 'tool_running' | 'streaming' | null;
export type Terminal = 'running' | 'done' | 'interrupted' | 'error' | 'idle_timeout';

export interface RunState {
  blocks: Block[];
  reasoning: { content: string; active: boolean };
  usage: { inputTokens: number | undefined; outputTokens: number | undefined } | undefined;
  footer: FooterStatus;
  terminal: Terminal;
  errorMsg: string | undefined;
  /** Delivery failure for the separate final-answer message. */
  finalDeliveryError: string | undefined;
  /** Final answer rendered back into the card when separate delivery fails. */
  finalDeliveryFallback: string | undefined;
  idleTimeoutMinutes: number | undefined;
  /** Visible owner marker for member-isolated group runs. */
  scopeOwner: string | undefined;
  /** Immutable scope encoded into run-card actions across isolation switches. */
  actionScope: string | undefined;
  /** Immutable run id encoded into run-card stop actions. */
  actionRunId: string | undefined;
  /** Wall-clock start of the run (ms epoch); set by the runner, not reduce(). */
  startedAtMs: number | undefined;
  /** Last moment an agent event arrived (ms epoch); drives the stall hint. */
  lastActivityMs: number | undefined;
}

export const initialState: RunState = {
  blocks: [],
  reasoning: { content: '', active: false },
  usage: undefined,
  footer: 'thinking',
  terminal: 'running',
  errorMsg: undefined,
  finalDeliveryError: undefined,
  finalDeliveryFallback: undefined,
  idleTimeoutMinutes: undefined,
  scopeOwner: undefined,
  actionScope: undefined,
  actionRunId: undefined,
  startedAtMs: undefined,
  lastActivityMs: undefined,
};

function closeStreamingText(blocks: Block[]): Block[] {
  return blocks.map((block) =>
    block.kind === 'text' && block.streaming ? { ...block, streaming: false } : block,
  );
}

export function markFinalDeliveryFailed(
  state: RunState,
  message: string,
  answer: string,
): RunState {
  return { ...state, finalDeliveryError: message, finalDeliveryFallback: answer };
}

export function reduce(state: RunState, event: AgentEvent): RunState {
  switch (event.type) {
    case 'text': {
      const last = state.blocks[state.blocks.length - 1];
      if (last?.kind === 'text' && last.streaming) {
        return {
          ...state,
          blocks: [
            ...state.blocks.slice(0, -1),
            { ...last, content: last.content + event.delta },
          ],
          reasoning: { ...state.reasoning, active: false },
          footer: 'streaming',
        };
      }
      return {
        ...state,
        blocks: [...state.blocks, { kind: 'text', content: event.delta, streaming: true }],
        reasoning: { ...state.reasoning, active: false },
        footer: 'streaming',
      };
    }

    case 'thinking':
      return {
        ...state,
        reasoning: {
          content: state.reasoning.content + event.delta,
          active: true,
        },
        footer: 'thinking',
      };

    case 'final_text':
      return {
        ...state,
        blocks: [
          ...closeStreamingText(state.blocks),
          { kind: 'text', content: event.content, streaming: false },
        ],
        reasoning: { ...state.reasoning, active: false },
        footer: null,
      };

    case 'usage':
      return {
        ...state,
        usage: {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
        },
      };

    case 'tool_use': {
      const blocks = closeStreamingText(state.blocks);
      const existingIndex = blocks.findIndex(
        (block) => block.kind === 'tool' && block.tool.id === event.id,
      );
      const nextBlocks = existingIndex === -1
        ? [
            ...blocks,
            {
              kind: 'tool' as const,
              tool: {
                id: event.id,
                name: event.name,
                input: event.input,
                status: 'running' as const,
              },
            },
          ]
        : blocks.map((block, index) => {
            if (index !== existingIndex || block.kind !== 'tool') return block;
            return {
              ...block,
              tool: {
                ...block.tool,
                name: event.name,
                input: event.input,
              },
            };
          });
      return {
        ...state,
        blocks: nextBlocks,
        reasoning: { ...state.reasoning, active: false },
        footer: existingIndex === -1 ? 'tool_running' : state.footer,
      };
    }

    case 'tool_result':
      return {
        ...state,
        footer: 'thinking',
        blocks: state.blocks.map((block) => {
          if (block.kind !== 'tool' || block.tool.id !== event.id) return block;
          return {
            ...block,
            tool: {
              ...block.tool,
              status: event.isError ? 'error' : 'done',
              output: event.output,
            },
          };
        }),
      };

    case 'error':
      return {
        ...state,
        terminal:
          event.terminationReason === 'interrupted'
            ? 'interrupted'
            : event.terminationReason === 'timeout'
              ? 'idle_timeout'
              : 'error',
        errorMsg: event.terminationReason === 'failed' ? event.message : undefined,
        idleTimeoutMinutes: undefined,
        footer: null,
      };

    case 'done':
      return {
        ...state,
        blocks: closeStreamingText(state.blocks),
        reasoning: { ...state.reasoning, active: false },
        terminal:
          event.terminationReason === 'interrupted'
            ? 'interrupted'
            : event.terminationReason === 'timeout'
              ? 'idle_timeout'
              : 'done',
        footer: null,
      };

    default:
      return state;
  }
}

export function markInterrupted(state: RunState): RunState {
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: 'interrupted',
    footer: null,
  };
}

export function markIdleTimeout(state: RunState, minutes: number): RunState {
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: 'idle_timeout',
    footer: null,
    idleTimeoutMinutes: minutes,
  };
}

export function finalizeIfRunning(state: RunState): RunState {
  if (state.terminal !== 'running') return state;
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: 'done',
    footer: null,
  };
}
