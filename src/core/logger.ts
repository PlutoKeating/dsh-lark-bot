import type { Writable } from 'node:stream';
import { redactSecrets } from '../config/security.js';

type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

const REDACTED = '[redacted]';
const SENSITIVE_KEY = /(secret|token|password|api[_-]?key)/i;

function redactValue(value: unknown, key: string, depth: number): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === 'string') return redactSecrets(value);
  if (depth === 0) return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => redactValue(item, `${key}.${index}`, depth - 1));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = redactValue(childValue, childKey, depth - 1);
    }
    return out;
  }
  return value;
}

export function redactFields(fields: LogFields, depth = 4): LogFields {
  return redactValue(fields, '', depth) as LogFields;
}

function serializeMessage(
  level: LogLevel,
  category: string,
  event: string,
  fields: LogFields,
): string {
  const entry = {
    time: new Date().toISOString(),
    level,
    category,
    event,
    fields: redactFields(fields),
  };
  return JSON.stringify(entry);
}

export interface Logger {
  info(category: string, event: string, fields?: LogFields): void;
  warn(category: string, event: string, fields?: LogFields): void;
  error(category: string, event: string, fields?: LogFields): void;
  fail(category: string, error: unknown, fields?: LogFields): void;
}

export function createLogger(output: Writable = process.stderr): Logger {
  const write = (level: LogLevel, category: string, event: string, fields: LogFields): void => {
    output.write(`${serializeMessage(level, category, event, fields)}\n`);
  };

  return {
    info: (category, event, fields = {}) => write('info', category, event, fields),
    warn: (category, event, fields = {}) => write('warn', category, event, fields),
    error: (category, event, fields = {}) => write('error', category, event, fields),
    fail(category, error, fields = {}) {
      const message = error instanceof Error ? error.message : String(error);
      write('error', category, 'fail', { message, ...fields });
    },
  };
}

export const log = createLogger();
