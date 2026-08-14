import type { DeepSeekHarness, HarnessNotification } from '@deepseek-ai/dsh-sdk-client';
import type { AgentEvent } from '../types.js';
import { EventChannel } from './event-channel.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function safeParseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function textOfBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter(isRecord)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
}

interface ToolDeltaTracker {
  emitted: Set<string>;
}

function translateChunk(chunk: unknown, tracker: ToolDeltaTracker): AgentEvent[] {
  if (!isRecord(chunk)) return [];
  switch (chunk.type) {
    case 'reasoning-delta':
      return typeof chunk.text === 'string' && chunk.text
        ? [{ type: 'thinking', delta: chunk.text }]
        : [];
    case 'text-delta':
      return typeof chunk.text === 'string' && chunk.text
        ? [{ type: 'text', delta: chunk.text }]
        : [];
    case 'tool-call-delta': {
      const id = stringValue(chunk.id);
      if (!id || tracker.emitted.has(id)) return [];
      tracker.emitted.add(id);
      return [
        {
          type: 'tool_use',
          id,
          name: stringValue(chunk.name) ?? 'tool',
          input: {},
        },
      ];
    }
    default:
      return [];
  }
}

function translateToolResult(data: unknown): AgentEvent[] {
  if (!isRecord(data)) return [];
  const message = isRecord(data.message) ? data.message : undefined;
  const block = Array.isArray(message?.content) ? message.content[0] : undefined;
  const toolCallId = stringValue(
    isRecord(block) ? block.toolCallId : undefined,
  );
  if (!toolCallId) return [];
  const output = textOfBlocks(isRecord(block) ? block.content : undefined);
  const isError =
    data.error !== undefined || (isRecord(block) ? block.isError === true : false);
  return [
    {
      type: 'tool_result',
      id: toolCallId,
      output,
      isError,
    },
  ];
}

function translateAssistantMessage(data: unknown): AgentEvent[] {
  if (!isRecord(data) || !isRecord(data.usage)) return [];
  const usage = data.usage;
  const inputTokens =
    typeof usage.inputTokens === 'number' ? usage.inputTokens : undefined;
  const outputTokens =
    typeof usage.outputTokens === 'number' ? usage.outputTokens : undefined;
  if (inputTokens === undefined && outputTokens === undefined) return [];
  return [
    {
      type: 'usage',
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
    },
  ];
}

function translateTurnEnd(data: unknown): AgentEvent[] {
  if (!isRecord(data) || !isRecord(data.reason) || data.reason.kind !== 'error') return [];
  const failure = isRecord(data.reason.error) ? data.reason.error : undefined;
  const message = stringValue(failure?.message) ?? 'dsh turn failed';
  return [{ type: 'error', message, terminationReason: 'failed' }];
}

/**
 * Translate one SDK session event into bridge `AgentEvent`s.
 * Token-level `assistant/chunk` deltas give the streaming (typewriter) card
 * experience: reasoning deltas feed the thinking section, text deltas feed
 * the output block, tool deltas surface live tool activity.
 */
export function translateSessionEvent(
  event: unknown,
  tracker: ToolDeltaTracker,
): AgentEvent[] {
  if (!isRecord(event) || typeof event.type !== 'string') return [];
  switch (event.type) {
    case 'assistant/chunk':
      return translateChunk(isRecord(event.data) ? event.data.chunk : undefined, tracker);
    case 'tool/call': {
      const data = isRecord(event.data) ? event.data : undefined;
      const id = stringValue(data?.callId);
      if (!id) return [];
      return [
        {
          type: 'tool_use',
          id,
          name: stringValue(data?.name) ?? 'tool',
          input: safeParseJson(data?.arguments),
        },
      ];
    }
    case 'tool/result':
      return translateToolResult(event.data);
    case 'assistant/message':
      return translateAssistantMessage(event.data);
    case 'turn/end':
      return translateTurnEnd(event.data);
    default:
      return [];
  }
}

function translateNotification(
  notification: HarnessNotification,
  sessionId: string,
  tracker: ToolDeltaTracker,
): AgentEvent[] {
  if (notification.method !== 'session.event') return [];
  const params = isRecord(notification.params) ? notification.params : undefined;
  if (params?.sessionId !== sessionId) return [];
  return translateSessionEvent(params.event, tracker);
}

export interface SdkRunOptions {
  sessionId: string;
  cwd: string | undefined;
  model: string | undefined;
  images: readonly string[] | undefined;
  stopRequested: { value: boolean };
}

export interface SdkRunHandle {
  events: AsyncIterable<AgentEvent>;
  /** Resolves when the underlying SDK turn settles (success or failure). */
  settled: Promise<void>;
}

function buildPromptText(prompt: string, images: readonly string[] | undefined): string {
  return images?.length
    ? `${prompt}\n\nImage files attached to this message:\n${images.join('\n')}`
    : prompt;
}

/**
 * Run one prompt on a harness session and stream the result as `AgentEvent`s.
 * The SDK client owns the runtime handshake; this helper owns the
 * notification-to-event translation and the run lifecycle.
 */
export function createSdkRun(
  harness: DeepSeekHarness,
  prompt: string,
  options: SdkRunOptions,
): SdkRunHandle {
  const channel = new EventChannel<AgentEvent>();
  const tracker: ToolDeltaTracker = { emitted: new Set() };
  let hadError = false;

  const task = harness
    .run(buildPromptText(prompt, options.images), {
      sessionId: options.sessionId,
      onNotification: (notification) => {
        for (const event of translateNotification(notification, options.sessionId, tracker)) {
          if (event.type === 'error') hadError = true;
          channel.push(event);
        }
      },
    })
    .catch((error: unknown) => {
      if (!options.stopRequested.value) {
        channel.push({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
          terminationReason: 'failed',
        });
        hadError = true;
      }
    })
    .finally(() => {
      channel.close();
    });

  async function* events(): AsyncGenerator<AgentEvent> {
    yield {
      type: 'system',
      sessionId: options.sessionId,
      cwd: options.cwd,
      model: options.model,
    };
    for await (const event of channel) {
      yield event;
    }
    await task;
    if (!hadError) {
      yield {
        type: 'done',
        sessionId: options.sessionId,
        terminationReason: options.stopRequested.value ? 'interrupted' : 'normal',
      };
    }
  }

  return { events: events(), settled: task.then(() => undefined) };
}
