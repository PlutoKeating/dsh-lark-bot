# API 契约 · API Contract

> 本文记录 dsh-lark-bot 对内部模块和外部调用方暴露的稳定接口。当前处于 P1 演进阶段，接口仍可能随 dsh ACP/SDK 落版而调整。
> This file records stable interfaces exposed by dsh-lark-bot. They are still evolving during P1 and may change when the dsh ACP/SDK integration is finalized.

## 1. 运行时环境 · Runtime environment

`src/config/env.ts` 提供：

```ts
export interface RuntimeEnv {
  home: string;
  tenant: 'feishu' | 'lark';
  appId: string | undefined;
  appSecret: string | undefined;
  workspace: string | undefined;
  dshCommand: string;
  dshArgs: string[];
  dshExplicit: boolean;
  adapterMode: 'sdk' | 'acp' | 'headless';
  provider: string;
  model: string;
  maxTokens: number | undefined;
  runTimeoutMs: number;
  stopGraceMs: number;
  accessDefaultDeny: boolean;
  eventFreshnessMs: number;
}

export function loadRuntimeEnv(source?: NodeJS.ProcessEnv): RuntimeEnv;
```

环境变量前缀统一为 `DSH_LARK_*`，敏感值只保留在运行时对象中，不写入日志或提交。

主要环境变量：

- `DSH_LARK_ADAPTER`：`sdk`（默认，官方 SDK client）/ `acp`（ACP 审批）/ `headless`（legacy）。
- `DSH_LARK_DSH_COMMAND` / `DSH_LARK_DSH_ARGS`：可选；未设置时自动发现本机 `@deepseek-ai/dsh` 安装路径。
- `DSH_LARK_MAX_TOKENS`：可选，SDK-created agent 的每请求输出 token 上限。
- `DSH_LARK_ACCESS_DEFAULT_DENY`：无白名单时是否拒绝私聊（默认 `false`，兼容 onboarding）。
- `DSH_LARK_EVENT_FRESHNESS_MS`：过期消息拒绝窗口（默认 `600000`，`0` 关闭）。
- `DSH_LARK_RUN_TIMEOUT_MS`：单次运行墙钟超时，默认 `300000`。
- `DSH_LARK_STOP_GRACE_MS`：SIGTERM 后等待退出再 SIGKILL 的宽限期，默认 `5000`。

## 2.4 Agent adapter 工厂

`src/adapters/index.ts` 提供：

```ts
export async function buildAgentAdapter(
  env: RuntimeEnv,
  preferences: { stopGraceMs: number | undefined; model: string | undefined },
): Promise<AgentAdapter>;
```

`sdk` 模式会先 `ensureSdkProfile`（创建 `~/.dsh/profiles/dsh-lark` SDK JSON-RPC runtime profile），
`acp` 模式先 `ensureAcpProfile`（`~/.dsh/profiles/dsh-lark-acp`）。

`AgentRunOptions` 新增可选审批回调：

```ts
onApprovalRequest?: (request: ApprovalRequest) => Promise<ApprovalOutcome>;
// ApprovalRequest: { id, sessionId, toolName, reason, options: ApprovalOption[] }
// ApprovalOutcome: 'allowed-once' | 'rejected' | 'cancelled'
```

`src/bot/approvals.ts` 的 `ApprovalRegistry` 负责 pending 审批注册与结算
（run 结束 / dispose 时 `settleAll(scope, 'cancelled')`）。

## 2.5 卡片与展示

- `src/card/run-renderer.ts`：`renderCard(state, density)`，三档 `compact / standard / detailed`；
  detailed 含完整 reasoning、工具输入输出与 token usage。
- `src/card/approval-card.ts`：`renderApprovalCard(input)`（allow-once / reject-once 按钮）。
- `src/card/question-card.ts`：`renderQuestionCard(input)`（单选 / 多选 / 自由文本）与
  `extractQuestionAnswer(kind, value, options)`。
- `src/bot/density-store.ts`：per-scope 卡片密度覆盖；`/density` 命令读写。

## 2.6 安全模块

`src/config/security.ts` 提供：

- `redactSecrets(text)`：Bearer / `sk-` / `api_key=` 正则脱敏。
- `isPathWithin(root, candidate)`：realpath containment（拒绝符号链接逃逸）。
- `truncateUtf8Safe(text, maxBytes)`：UTF-8 安全字节截断。
- `isEventFresh(timestampMs, windowMs, now?)`：过期事件拒绝。
- `isSafeHttpUrl(url)`：SSRF 防护（拒绝环回 / 私网 / 链路本地 / CGNAT / IPv6 ULA）。
- `DEFAULT_DENIED_INTERACTIVE_TOOLS` / `isDeniedTool(name)`：IM 不可回达工具默认拒绝。

详细威胁模型见根目录 `SECURITY.md`。

## 2. 本地状态路径 · Local state paths

`src/config/app-paths.ts` 提供：

```ts
export interface AppPaths {
  root: string;
  configFile: string;
  activeProfileFile: string;
  profileDir(profile: string): string;
  profilePath(profile: string, ...parts: string[]): string;
  sessionsFile(profile: string): string;
  sessionCatalogFile(profile: string): string;
  workspacesFile(profile: string): string;
  mediaDir(profile: string): string;
  logsDir(profile: string): string;
  registryFile: string;
  locksDir: string;
}

export function resolveAppPaths(root?: string): AppPaths;
```

默认根目录为 `~/.dsh-lark`，可通过 `DSH_LARK_HOME` 覆盖。

## 2.1 Profile 配置 · Profile config

`src/config/profile-store.ts` 提供：

```ts
export interface ProfileConfig {
  schemaVersion: 1;
  agentKind: 'dsh';
  tenant: 'feishu' | 'lark';
  accounts: { appId: string; appSecret: string };
  workspaces: { default: string | undefined };
  preferences: {
    model: string | undefined;
    stopGraceMs: number | undefined;
    runTimeoutMs: number | undefined;
  };
  access: {
    allowedUsers: string[];
    allowedChats: string[];
    admins: string[];
  };
}
```

`ConfigStore` 负责读取 `~/.dsh-lark/config.json`，并保存当前 active profile。App Secret 以文件权限 `0600` 写入本机。

`src/bot/run-policy.ts` 提供内存级 `RunPolicyStore`，按 scope 覆盖运行超时：

```ts
export class RunPolicyStore {
  get(scope: string): number | undefined;
  set(scope: string, runTimeoutMs: number): void;
  clear(scope: string): boolean;
}
```

飞书命令 `/timeout [N|off|default]` 会读写该 store，`/timeout` 的覆盖值优先于 profile / 环境变量默认值。

`src/config/access-manager.ts` 提供 `AccessManager`，负责把 `/invite user|admin|group <id>`、`/invite list`、`/invite remove user|group <id>` 的变更持久化到当前 profile 的访问白名单。

`src/session/store.ts` 的 `SessionStore` 现在会保存每个 scope 最近 40 条对话消息，并支持 `fork(scopeId, newScopeId, cwd)` 复制历史到新分支；`runAgentBatch` 会把这些历史拼入下一次 dsh prompt，以弥补 dsh headless 无状态进程的上下文缺失。

## 2.2 扫码绑定 · QR onboarding

`src/onboard/registration.ts` 提供：

```ts
export interface OnboardedApp {
  appId: string;
  appSecret: string;
  tenant: 'feishu' | 'lark';
  operatorOpenId: string | undefined;
}

export async function onboardPersonalAgent(
  deps?: RegistrationDeps,
): Promise<OnboardedApp>;
```

默认使用 `@larksuite/channel` 的 `registerApp`，在终端打印二维码并等待用户扫码创建或选择 PersonalAgent 应用；可通过 `deps` 注入 `register` / `renderQr` / `print` 便于测试。

## 2.3 Git worktree · Git worktree manager

`src/workspace/git-worktree.ts` 提供：

```ts
export interface WorktreeEnsureResult {
  cwd: string;
  created: boolean;
  branch?: string;
}

export class GitWorktreeManager {
  ensure(scope: string, base: string): Promise<WorktreeEnsureResult>;
  isGitRepository(cwd: string): Promise<boolean>;
}
```

当当前工作目录是 Git 仓库时，`runAgentBatch` 会为每个 scope 在 `~/.dsh-lark/profiles/<profile>/worktrees/<scope>/` 创建 `dsh-lark/<slug>-*` 分支的 worktree；非 Git 目录保持原路径。若 base 下有 `.dsh-lark/AGENTS.md` 或 `AGENTS.md` 且目标 worktree 没有，则复制为目标根目录 `AGENTS.md`。

`src/workspace/store.ts` 现在维护命名工作区的 `lastUsed` 索引；`/ws list` 按最近使用排序，优先展示飞书导航卡片。

`/ws list` 会优先通过 `sendCard` 发送工作空间导航卡片；不支持卡片的测试通道回退为 Markdown。

## 3. 结构化日志 · Structured logging

`src/core/logger.ts` 提供：

```ts
export interface Logger {
  info(category: string, event: string, fields?: LogFields): void;
  warn(category: string, event: string, fields?: LogFields): void;
  error(category: string, event: string, fields?: LogFields): void;
  fail(category: string, error: unknown, fields?: LogFields): void;
}
```

日志按 JSON Lines 输出，并自动脱敏 secret/token/password/api_key 等字段。

## 4. Agent 适配器 · Agent adapter

与 lark-coding-agent-bridge 语义兼容的事件契约：

```ts
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
```

dsh 后端只允许在 `src/adapters/` 中依赖 dsh 接口，桥接层和会话层不得直接依赖 dsh。

当前 `DshAdapter` 使用可配置的 headless 子进程：读取 stdout JSONL / 纯文本并翻译为 `AgentEvent`。`stopGraceMs` 控制 SIGTERM → SIGKILL 的宽限期。

`src/media/attachments.ts` 会把飞书消息中的图片下载为本地路径，文本文件读取内容并追加到 prompt；超过 `256000` 字节的文本文件只注入路径，避免撑爆单次请求。

## 5. CLI · Command line

当前命令：

- `dsh-lark-bot start`：前台启动桥接
- `dsh-lark-bot doctor`：运行本地诊断

飞书会话内当前支持：`/new`、`/reset`、`/cd`、`/ws`、`/status`、`/resume`、`/stop`、`/timeout`、`/invite user|admin|group|list|remove`、`/help`。

两个命令均支持 `--profile`、`--workspace`、`--app-id`、`--app-secret`、`--tenant`。后续将补充 `profile`、`ps`、`kill` 等进程与配置管理命令。
