import { homedir } from 'node:os';
import { redactSecrets } from '../config/security.js';

const MAX_LOG_BYTES = 64 * 1024;
const SENSITIVE_ENV_KEY = /(secret|token|password|api[_-]?key|credential)/i;
const SAFE_LOG_CATEGORIES = new Set([
  'approval-card', 'approvals', 'archive', 'channel', 'cli', 'fleet', 'group-poller',
  'job-ledger', 'notify', 'plan-card', 'run-flow', 'session', 'session-projection',
  'tui-compat', 'wizard',
]);
const SAFE_LOG_EVENTS = new Set([
  'cancel-confirm-failed', 'cancel-recall-failed', 'card-send-failed',
  'card-stream-finalize-failed', 'card-update-failed', 'checkpoint-failed',
  'corrupt-file-moved', 'fail', 'git-commit-failed', 'git-prune-commit-failed',
  'git-workspace-migration-commit-failed', 'heal-archived', 'hub-card-send-failed',
  'identity-unavailable', 'legacy-card-failed', 'native-card-fallback',
  'no-allowed-users', 'pruned', 'reconnected', 'reconnecting', 'resume-fallback',
  'server-started', 'settled-pending', 'stale-message-dropped', 'started',
  'mux-connected', 'mux-error', 'optional-seams-attached', 'optional-seams-unavailable',
  'status-cleanup-failed',
]);
const SAFE_LOG_NUMBER_FIELDS = new Set([
  'count', 'durationMs', 'events', 'outputLength', 'pollIntervalMs', 'restarts',
  'timeoutMs',
]);

export interface DiagnosticRequestSnapshot {
  scope: string;
  chatMode: 'p2p' | 'group' | 'topic';
  workspace: string;
  model: string;
  sessionId?: string;
  activeRunIds: string[];
  pending: { approvals: number; questions: number; plans: number };
  jobs?: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    interrupted: number;
  };
}

export interface DiagnosticBundleInput {
  generatedAt?: Date;
  version: string;
  node: string;
  platform: string;
  profile: string;
  dshProfile: string;
  tenant: 'feishu' | 'lark';
  adapter: string;
  config: {
    credentialsConfigured: boolean;
    allowedUsers: number;
    allowedChats: number;
    admins: number;
    groupNoAt: boolean;
    sessionProjectionEnabled?: boolean;
    projectionBindings?: number;
  };
  request: DiagnosticRequestSnapshot;
  service?: {
    installed: boolean;
    state: string;
    platform: string;
    autostartEnabled?: boolean;
    detail?: string;
  };
  runtimeLogs: string[];
  knownSecrets?: string[];
  homeDir?: string;
}

export interface DiagnosticFile {
  fileName: string;
  content: Buffer;
}

/** Values from secret-bearing environment keys; keys and values are never emitted. */
export function knownSecretsFromEnv(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(env)
    .filter(([key, value]) => SENSITIVE_ENV_KEY.test(key) && Boolean(value))
    .map(([, value]) => value as string);
}

/** Render a bounded, forwardable Markdown report. No credential identifiers are included. */
export function createDiagnosticBundle(input: DiagnosticBundleInput): DiagnosticFile {
  const generatedAt = input.generatedAt ?? new Date();
  const home = input.homeDir ?? homedir();
  const sanitize = (text: string): string => sanitizeDiagnosticText(
    text,
    input.knownSecrets ?? [],
    home,
  );
  const request = input.request;
  const jobs = request.jobs;
  const runtimeLogs = boundedLogTail(projectDiagnosticLogs(input.runtimeLogs).map(sanitize));
  const lines = [
    '# dsh-lark-bot diagnostic bundle',
    '',
    '> Automatically redacted. The bundle omits credentials and message/session transcripts.',
    '> 自动脱敏；不包含凭据值，也不包含消息正文或会话 transcript。',
    '',
    '## Environment',
    '',
    `- generated: \`${generatedAt.toISOString()}\``,
    `- version: \`${sanitize(input.version)}\``,
    `- node: \`${sanitize(input.node)}\``,
    `- platform: \`${sanitize(input.platform)}\``,
    `- bridge profile: \`${sanitize(input.profile)}\``,
    `- dsh profile: \`${sanitize(input.dshProfile)}\``,
    `- tenant: \`${input.tenant}\``,
    `- adapter: \`${sanitize(input.adapter)}\``,
    '',
    '## Configuration summary',
    '',
    `- credentials configured: \`${input.config.credentialsConfigured ? 'yes' : 'no'}\``,
    `- allowed users/chats/admins: \`${input.config.allowedUsers}/${input.config.allowedChats}/${input.config.admins}\``,
    `- group no-at: \`${input.config.groupNoAt ? 'enabled' : 'disabled'}\``,
    `- explicit session projection: \`${input.config.sessionProjectionEnabled ? 'enabled' : 'disabled'}\``,
    `- durable projection bindings: \`${input.config.projectionBindings ?? 0}\``,
    '',
    '## Current request scope',
    '',
    `- scope: \`${sanitize(request.scope)}\``,
    `- chat mode: \`${request.chatMode}\``,
    `- workspace: \`${sanitize(request.workspace)}\``,
    `- model: \`${sanitize(request.model)}\``,
    `- native session: \`${sanitize(request.sessionId ?? 'none')}\``,
    `- active runs: ${request.activeRunIds.length > 0 ? request.activeRunIds.map((id) => `\`${sanitize(id)}\``).join(', ') : '`none`'}`,
    `- pending approval/question/plan: \`${request.pending.approvals}/${request.pending.questions}/${request.pending.plans}\``,
    ...(jobs
      ? [`- jobs queued/running/completed/failed/interrupted: \`${jobs.queued}/${jobs.running}/${jobs.completed}/${jobs.failed}/${jobs.interrupted}\``]
      : ['- durable job ledger: `unavailable`']),
    '',
    '## Managed service',
    '',
    ...(input.service
      ? [
          `- installed: \`${input.service.installed ? 'yes' : 'no'}\``,
          `- state: \`${sanitize(input.service.state)}\``,
          `- platform: \`${sanitize(input.service.platform)}\``,
          `- autostart: \`${input.service.autostartEnabled === undefined ? 'unknown' : input.service.autostartEnabled ? 'on' : 'off'}\``,
          ...(input.service.detail ? [`- detail: ${sanitize(input.service.detail)}`] : []),
        ]
      : ['- status: `unavailable`']),
    '',
    '## Recent bridge logs',
    '',
    '```jsonl',
    runtimeLogs || '(none captured in this process)',
    '```',
    '',
  ];
  const stamp = generatedAt.toISOString()
    .replace(/\.\d{3}Z$/u, 'Z')
    .replaceAll(/[-:]/g, '');
  return {
    fileName: `dsh-lark-diagnostic-${stamp}.md`,
    content: Buffer.from(lines.join('\n'), 'utf8'),
  };
}

function sanitizeDiagnosticText(text: string, knownSecrets: string[], home: string): string {
  let output = redactSecrets(text);
  for (const value of knownSecrets) {
    if (value.length < 4) continue;
    output = output.split(value).join('[redacted]');
  }
  if (home.length > 1) output = output.split(home).join('~');
  return output.replaceAll('```', "''' ").replaceAll('`', "'");
}

function boundedLogTail(lines: string[]): string {
  const joined = lines.join('\n');
  if (Buffer.byteLength(joined, 'utf8') <= MAX_LOG_BYTES) return joined;
  let tail = joined.slice(-MAX_LOG_BYTES);
  while (Buffer.byteLength(tail, 'utf8') > MAX_LOG_BYTES) tail = tail.slice(1);
  const code = tail.charCodeAt(0);
  if (code >= 0xdc00 && code <= 0xdfff) tail = tail.slice(1);
  return `[older log lines omitted]\n${tail}`;
}

/**
 * Fail-closed log projection: retain only static event metadata plus numeric/boolean fields.
 * Arbitrary strings (messages, prompts, paths, errors and unknown credentials) never leave.
 */
function projectDiagnosticLogs(lines: string[]): string[] {
  const projected: string[] = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (typeof entry.time !== 'string') continue;
      const timestamp = Date.parse(entry.time);
      if (!Number.isFinite(timestamp)) continue;
      if (entry.level !== 'info' && entry.level !== 'warn' && entry.level !== 'error') continue;
      if (entry.fields === null || typeof entry.fields !== 'object' || Array.isArray(entry.fields)) continue;
      const fields = Object.fromEntries(
        Object.entries(entry.fields as Record<string, unknown>)
          .filter(([key, value]) => SAFE_LOG_NUMBER_FIELDS.has(key) &&
            typeof value === 'number' && Number.isFinite(value)),
      );
      projected.push(JSON.stringify({
        time: new Date(timestamp).toISOString(),
        level: entry.level,
        category: typeof entry.category === 'string' && SAFE_LOG_CATEGORIES.has(entry.category)
          ? entry.category
          : 'other',
        event: typeof entry.event === 'string' && SAFE_LOG_EVENTS.has(entry.event)
          ? entry.event
          : 'other',
        fields,
      }));
    } catch {
      // Ignore malformed in-process entries rather than exporting raw text.
    }
  }
  return projected;
}
