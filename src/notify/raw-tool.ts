import type { Context } from '@deepseek-ai/cordis';

export interface RawToolExecution {
  agent?: object & { session?: { id?: unknown } };
  signal?: AbortSignal;
}

export interface RawToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: {
    schema: Record<string, unknown>;
    render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }>;
  };
  timeoutMs?: number;
  execute(args: unknown, exec?: RawToolExecution): Promise<unknown>;
}

export type ToolPluginContext = Context & {
  tools: {
    register(definition: RawToolDefinition): void;
    get?(name: string, scope?: unknown): {
      presentCall?(args: unknown): { card?: string; kind?: string } | undefined;
    } | undefined;
  };
};

export function objectArgs(value: unknown, toolName: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${toolName} arguments must be an object`);
  }
  return value as Record<string, unknown>;
}

export function requiredString(
  args: Record<string, unknown>,
  key: string,
  toolName: string,
): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${toolName}.${key} must be a non-empty string`);
  }
  return value;
}

export function optionalString(
  args: Record<string, unknown>,
  key: string,
  toolName: string,
): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${toolName}.${key} must be a string`);
  return value;
}

export function optionalStringArray(
  args: Record<string, unknown>,
  key: string,
  toolName: string,
): string[] | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`${toolName}.${key} must be an array of strings`);
  }
  return value;
}
