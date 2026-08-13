import type { AgentEvent } from '../types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function translateDshLine(line: string): AgentEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isRecord(parsed) || typeof parsed.type !== 'string') return [];

    switch (parsed.type) {
      case 'system':
        return [
          {
            type: 'system',
            sessionId: stringValue(parsed.sessionId),
            cwd: stringValue(parsed.cwd),
            model: stringValue(parsed.model),
          },
        ];
      case 'text':
        return [{ type: 'text', delta: stringValue(parsed.delta) ?? '' }];
      case 'final_text':
        return [{ type: 'final_text', content: stringValue(parsed.content) ?? '' }];
      case 'thinking':
        return [{ type: 'thinking', delta: stringValue(parsed.delta) ?? '' }];
      case 'tool_use':
        return [
          {
            type: 'tool_use',
            id: stringValue(parsed.id) ?? 'unknown',
            name: stringValue(parsed.name) ?? 'tool',
            input: parsed.input,
          },
        ];
      case 'tool_result':
        return [
          {
            type: 'tool_result',
            id: stringValue(parsed.id) ?? 'unknown',
            output: stringValue(parsed.output) ?? '',
            isError: parsed.isError === true,
          },
        ];
      case 'done':
        return [
          {
            type: 'done',
            sessionId: stringValue(parsed.sessionId),
            terminationReason: 'normal',
          },
        ];
      case 'error':
        return [
          {
            type: 'error',
            message: stringValue(parsed.message) ?? 'dsh failed',
            terminationReason: 'failed',
          },
        ];
      default:
        return [];
    }
  } catch {
    return [];
  }
}

export function plainOutputEvent(output: string): AgentEvent[] {
  const trimmed = output.trim();
  return trimmed ? [{ type: 'final_text', content: trimmed }] : [];
}
