import type { ToolPluginContext } from '../notify/raw-tool.js';

export type PolicyLayer = 'plan-gate' | 'permission-policy' | 'tool-approval' | 'file-sandbox';

export interface PolicyDenial {
  layer: PolicyLayer;
  reason: string;
  toChange: string;
}

export interface PlanPolicyExecution {
  name: string;
  arguments: unknown;
  agent?: object;
}

const READ_ONLY_SHELL_TOOLS = new Set(['bash', 'shell']);
const READ_ONLY_COMMANDS = new Set([
  'date', 'id', 'pwd', 'uname', 'whoami',
]);
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'diff', 'ls-files', 'ls-tree', 'log', 'merge-base', 'rev-parse', 'show', 'status',
]);
const SHELL_CONTROL_SYNTAX = /[\n\r;&|<>`]|\$\(|\$\{/u;

export function policyDenialText(denial: PolicyDenial): string {
  return `[policy-denial layer=${denial.layer}] denied by ${denial.layer}: ${denial.reason}\n` +
    `to change: ${denial.toChange}`;
}

export function planGateDenial(): PolicyDenial {
  return {
    layer: 'plan-gate',
    reason: 'this substantial or high-risk action has no plan approval for the current turn',
    toChange: 'call lark_request_plan_approval and wait for approval; /permission does not change the plan gate',
  };
}

export function permissionPolicyDenial(scope: string, toolName: string): PolicyDenial {
  return {
    layer: 'permission-policy',
    reason: `tool ${toolName} is blocked by scope ${scope}'s deny policy`,
    toChange: `an admin can run /permission ask ${scope} or /permission allow ${scope}`,
  };
}

export function toolApprovalDenial(toolName: string): PolicyDenial {
  return {
    layer: 'tool-approval',
    reason: `the user rejected the one-shot approval for tool ${toolName}`,
    toChange: 'choose a safer alternative or ask the user before requesting approval again',
  };
}

/** Persona text generated from the same command vocabulary used for enforcement. */
export function renderToolPolicyPersona(): string[] {
  return [
    `The bridge policy treats one uncomposed shell call as read-only only when its executable is one of: ${[...READ_ONLY_COMMANDS].join(', ')}; read-only git subcommands are ${[...READ_ONLY_GIT_SUBCOMMANDS].join(', ')} plus listing branch/remote forms.`,
    'Read-only calls must not use chaining, redirects, command substitution, background execution, escalation, or mutating flags; run qualifying inspections directly.',
    'Before modifying files, installing packages, running scripts, pushing, deleting, or taking another substantial or high-risk action, use lark_request_plan_approval and wait for approval.',
    'The plan-gate confirms the intended plan; /permission separately controls per-tool approval and never bypasses the plan-gate or the Harness file-sandbox.',
    'Policy refusals use [policy-denial layer=...] with a reason and to-change instruction. Harness errors beginning [sandbox: ...] are file-sandbox refusals. Report the named layer and exact error; never invent a different restriction.',
    'After any policy or sandbox refusal, do not try an equivalent command, tool, or path to obtain the same result. Stop, report the refusal accurately, and let the user decide whether to change the policy or approve another approach.',
  ];
}

export function isHighRiskTool(ctx: ToolPluginContext, execution: PlanPolicyExecution): boolean {
  if (execution.name === 'lark_request_plan_approval') return false;
  if (execution.name === 'run_code') return true;
  const normalized = execution.name.toLowerCase().replaceAll('-', '_');
  if (READ_ONLY_SHELL_TOOLS.has(normalized)) {
    return !isSimpleReadOnlyShellCommand(execution.arguments);
  }
  try {
    const view = ctx.tools.get?.(execution.name, execution.agent)?.presentCall?.(
      execution.arguments,
    ) as { card?: string; kind?: string } | undefined;
    if (view?.card === 'terminal' || view?.card === 'diff') return true;
    const kind = view?.kind;
    if (kind && ['edit', 'delete', 'move', 'execute'].includes(kind)) return true;
  } catch {
    // Fall through to the conservative name classifier.
  }
  return /(^|_)(bash|shell|exec|execute|run|write|edit|patch|delete|remove|move|rename)(_|$)/u
    .test(normalized);
}

function isSimpleReadOnlyShellCommand(rawArguments: unknown): boolean {
  const command = shellCommand(rawArguments)?.trim();
  if (!command || SHELL_CONTROL_SYNTAX.test(command)) return false;
  const words = command.split(/\s+/u);
  const executablePath = words[0];
  if (
    !executablePath ||
    (executablePath.includes('/') &&
      !executablePath.startsWith('/bin/') &&
      !executablePath.startsWith('/usr/bin/'))
  ) return false;
  const executable = executablePath.split('/').at(-1);
  if (!executable) return false;
  if (executable === 'git') return isReadOnlyGitCommand(words.slice(1));
  if (!READ_ONLY_COMMANDS.has(executable)) return false;
  if (executable === 'date') {
    return words.slice(1).every((word) =>
      word === '-u' || word === '--utc' || word === '--universal' || word.startsWith('+')
    );
  }
  return words.length === 1;
}

function shellCommand(rawArguments: unknown): string | undefined {
  if (typeof rawArguments === 'object' && rawArguments !== null && !Array.isArray(rawArguments)) {
    const record = rawArguments as Record<string, unknown>;
    const allowedKeys = new Set(['command', 'description', 'workdir', 'run_in_background']);
    if (Object.keys(record).some((key) => !allowedKeys.has(key))) return undefined;
    if (record.description !== undefined && typeof record.description !== 'string') return undefined;
    if (record.workdir !== undefined && typeof record.workdir !== 'string') return undefined;
    if (record.run_in_background !== undefined && record.run_in_background !== false) return undefined;
    const command = record.command;
    return typeof command === 'string' ? command : undefined;
  }
  if (typeof rawArguments !== 'string') return undefined;
  try {
    return shellCommand(JSON.parse(rawArguments));
  } catch {
    return rawArguments;
  }
}

function isReadOnlyGitCommand(words: readonly string[]): boolean {
  const index = 0;
  const subcommand = words[index];
  if (subcommand === 'branch') {
    const flags = words.slice(index + 1);
    return flags.length === 0 || flags.every((word) =>
      ['--show-current', '--list', '--all', '-a', '--remotes', '-r', '-v', '-vv'].includes(word)
    );
  }
  if (subcommand === 'remote') {
    const args = words.slice(index + 1);
    return args.length === 0 ||
      args.every((word) => word === '-v' || word === '--verbose') ||
      args[0] === 'get-url';
  }
  if (!subcommand || !READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) return false;
  return !words.slice(index + 1).some((word) =>
    word === '-o' || word === '--output' || word.startsWith('--output=') ||
    word === '--ext-diff' || word === '--textconv' || word === '--no-index' ||
    word.startsWith('/') || word.startsWith('~') || /(^|\/)\.\.(\/|$)/u.test(word)
  );
}
