import { lstatSync, realpathSync } from 'node:fs';
import { isIP } from 'node:net';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const REDACTED = '[redacted]';

const SECRET_PATTERNS: readonly { label: string; pattern: RegExp; keyed: boolean }[] = [
  { label: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, keyed: false },
  { label: 'deepseek-key', pattern: /\bsk-[A-Za-z0-9_-]{8,}/g, keyed: false },
  { label: 'api-key', pattern: /\b(api[_-]?key)\s*[=:]\s*["']?[A-Za-z0-9._~+/=-]{8,}/gi, keyed: true },
];

/** Redact common secret shapes (Bearer / sk- / api_key=…) from free text. */
export function redactSecrets(text: string): string {
  let result = text;
  for (const { pattern, keyed } of SECRET_PATTERNS) {
    result = keyed
      ? result.replace(pattern, (_match, keyName: string) => `${keyName}=${REDACTED}`)
      : result.replace(pattern, REDACTED);
  }
  return result;
}

function resolveReal(path: string): string | undefined {
  let cursor = resolve(path);
  const missingParts: string[] = [];

  while (true) {
    try {
      return resolve(realpathSync(cursor), ...missingParts.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined;

      // A broken symlink also reports ENOENT from realpath. Fail closed instead
      // of treating the symlink name as an ordinary missing path segment.
      try {
        lstatSync(cursor);
        return undefined;
      } catch (lstatError) {
        if ((lstatError as NodeJS.ErrnoException).code !== 'ENOENT') return undefined;
      }

      const parent = dirname(cursor);
      if (parent === cursor) return undefined;
      missingParts.push(basename(cursor));
      cursor = parent;
    }
  }
}

/**
 * Path containment: `candidate` is inside (or equal to) `root`.
 * Uses realpath when the path exists so symlink escapes are rejected.
 */
export function isPathWithin(root: string, candidate: string): boolean {
  const rootReal = resolveReal(root);
  const candidateReal = resolveReal(candidate);
  if (rootReal === undefined || candidateReal === undefined) return false;
  const rel = relative(rootReal, candidateReal);
  return (
    rel === '' ||
    (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
  );
}

/**
 * Truncate text to `maxBytes` UTF-8 without splitting a multi-byte sequence
 * or a UTF-16 surrogate pair.
 */
export function truncateUtf8Safe(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let slice = text.slice(0, maxBytes);
  while (Buffer.byteLength(slice, 'utf8') > maxBytes && slice.length > 0) {
    slice = slice.slice(0, -1);
  }
  const code = slice.charCodeAt(slice.length - 1);
  if (code >= 0xd800 && code <= 0xdbff) {
    slice = slice.slice(0, -1);
  }
  return slice;
}

/** Reject stale events (e.g. replayed/duplicated IM messages). */
export function isEventFresh(
  timestampMs: number | undefined,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  if (timestampMs === undefined) return true;
  return now - timestampMs <= windowMs;
}

/** Interactive tools that cannot be answered back through IM; default-deny. */
export const DEFAULT_DENIED_INTERACTIVE_TOOLS: readonly string[] = [
  'ask_user_question',
  'terminal',
  'browser',
  'vim',
  'code',
];

export function isDeniedTool(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return DEFAULT_DENIED_INTERACTIVE_TOOLS.includes(normalized);
}

function ipv4IsPrivate(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true;
  return false;
}

function ipv6IsPrivate(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (normalized === '::' || normalized.startsWith('0:')) return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  return false;
}

/**
 * SSRF guard: only http(s) URLs whose hostname is a public address are safe.
 * Loopback, link-local, private, CGNAT and IPv6 ULA ranges are rejected.
 */
export function isSafeHttpUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    return !ipv4IsPrivate(host.split('.').map((part) => Number(part)));
  }
  if (ipVersion === 6) {
    return !ipv6IsPrivate(host);
  }
  // Hostnames resolve later; the URL-level guard is the transport boundary.
  return true;
}
