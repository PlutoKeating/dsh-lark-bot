# API 契约 · API Contract

> 本文记录 dsh-lark-bot 对内部模块和外部调用方暴露的稳定接口。当前处于 P3 演进阶段，接口可能随 dsh SDK/ACP 落版而调整。
> This file records stable interfaces exposed by dsh-lark-bot. They are still evolving during P3 and may change when the dsh ACP/SDK integration is finalized.

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
  /** True when DSH_LARK_DSH_COMMAND / DSH_LARK_DSH_ARGS were set explicitly. */
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

环境变量前缀统一为 `DSH_LARK_*`，敏感值只保留在运行时对象中，不写入日志或提交。完整清单见
`README.md` 与 `.env.example`；本节仅列关键项：

- `DSH_LARK_ADAPTER`：`sdk`（默认，官方 SDK client）/ `acp`（ACP 审批）/ `headless`（legacy）。
- `DSH_LARK_DSH_COMMAND` / `DSH_LARK_DSH_ARGS`：可选；未设置时自动发现本机 `@deepseek-ai/dsh` 安装路径。
- `DSH_LARK_MAX_TOKENS`：可选，SDK-created agent 的每请求输出 token 上限。
- `DSH_LARK_ACCESS_DEFAULT_DENY`：无白名单时是否拒绝私聊（默认 `false`，兼容 onboarding）。
- `DSH_LARK_EVENT_FRESHNESS_MS`：过期消息拒绝窗口（默认 `600000`，`0` 关闭）。
- `DSH_LARK_RUN_TIMEOUT_MS`：单次运行墙钟超时，默认 `300000`。
- `DSH_LARK_STOP_GRACE_MS`：SIGTERM 后等待优雅退出再 SIGKILL 的宽限期，默认 `5000`。

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

### 2.1 Profile 配置 · Profile config

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

`ConfigStore` 负责读写 `~/.dsh-lark/config.json` 与 active profile；App Secret 以文件权限 `0600`
写入。扫码绑定得到的 `operatorOpenId` 会自动加入 `allowedUsers` 与 `admins`。

`src/bot/run-policy.ts` 提供内存级 `RunPolicyStore`，按 scope 覆盖运行超时：

```ts
export class RunPolicyStore {
  get(scope: string): number | undefined;
  set(scope: string, runTimeoutMs: number): void;
  clear(scope: string): boolean;
}
```

飞书命令 `/timeout [N|off|default]` 读写该 store，覆盖值优先于 profile / 环境变量默认值。

`src/config/access-manager.ts` 的 `AccessManager` 把 `/invite user|admin|group|list|remove` 的
变更持久化到当前 profile 的访问白名单。

`src/session/store.ts` 的 `SessionStore` 保存每个 scope 最近 40 条对话，支持
`fork(scopeId, newScopeId, cwd)` 复制历史；SDK 模式以原生 `session(id)` 续跑，headless 模式把
历史拼入下一次 prompt 作为近似上下文。

### 2.2 扫码绑定 · QR onboarding

`src/onboard/registration.ts` 提供：

```ts
export interface OnboardedApp {
  appId: string;
  appSecret: string;
  tenant: 'feishu' | 'lark';
  operatorOpenId: string | undefined;
}

export async function onboardPersonalAgent(deps?: RegistrationDeps): Promise<OnboardedApp>;
```

默认使用 `@larksuite/channel` 的 `registerApp`，终端打印二维码等待扫码；可通过 `deps` 注入
`register` / `renderQr` / `print` 便于测试。

### 2.3 Git worktree · Git worktree manager

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

当前目录是 Git 仓库时，`runAgentBatch` 为每个 scope 在
`~/.dsh-lark/profiles/<profile>/worktrees/<slug>/` 创建 `dsh-lark/<slug>-*` 分支的 worktree
（slug 经过净化并做 realpath containment 校验）；非 Git 目录保持原路径。若 base 下有
`.dsh-lark/AGENTS.md` 或 `AGENTS.md` 且目标 worktree 没有，则复制为目标根目录 `AGENTS.md`。

`src/workspace/store.ts` 维护命名工作区 `lastUsed` 索引；`/ws list` 优先通过 `sendCard` 发送
导航卡片，不支持卡片的通道回退 Markdown。

## 3. Agent 适配器 · Agent adapter

契约定义在 `src/adapters/types.ts`，与 lark-coding-agent-bridge 语义兼容：

```ts
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
  /** ACP 审批通道：agent 请求一次性权限时回调。 */
  onApprovalRequest?: (request: ApprovalRequest) => Promise<ApprovalOutcome>;
}

export interface AgentRun {
  readonly runId: string;
  readonly events: AsyncIterable<AgentEvent>;
  stop(): Promise<void>;
  waitForExit(timeoutMs: number): Promise<boolean>;
}

export interface AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  isAvailable(): Promise<boolean>;
  checkAvailability(): Promise<AgentAvailability>;
  run(options: AgentRunOptions): AgentRun;
  dispose?(): Promise<void>;
}
```

审批类型：

```ts
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled';
export interface ApprovalRequest {
  id: string;
  sessionId: string | undefined;
  toolName: string;
  reason: string | undefined;
  options: readonly { optionId: string; name: string; kind: ApprovalOptionKind }[];
}
```

`src/adapters/index.ts` 提供工厂，按 `env.adapterMode` 构建默认后端：

```ts
export async function buildAgentAdapter(
  env: RuntimeEnv,
  preferences: { stopGraceMs: number | undefined; model: string | undefined },
): Promise<AgentAdapter>;
```

- `sdk`（默认）：`SdkDshAdapter`（`src/adapters/dsh/sdk-adapter.ts`），先 `ensureSdkProfile`
  创建 `~/.dsh/profiles/dsh-lark`（`dsh-base` + `dsh-sdk-jsonrpc-server`），按 cwd 管理
  `DeepSeekHarness` runtime 池，`session(id)` 原生续跑；`/stop` 关闭对应 runtime。
- `acp`：`AcpDshAdapter`（`src/adapters/dsh/acp-adapter.ts`），先 `ensureAcpProfile` 创建
  `~/.dsh/profiles/dsh-lark-acp`（`dsh-base` + `dsh-acp`），以 `ClientSideConnection` 连接
  ACP server，`session/request_permission` 映射审批卡；会话每次全新。
- `headless`：`DshAdapter`（`src/adapters/dsh/adapter.ts`），legacy 子进程 JSONL 翻译。

翻译与 runtime 管理模块：`src/adapters/dsh/sdk-translate.ts`（SDK `session.event` →
`AgentEvent`）、`sdk-runtime.ts` / `acp-runtime.ts`（profile 自动创建与自愈）、
`event-channel.ts`（有序事件队列）。

## 4. 卡片与展示 · Cards & rendering

- `src/card/run-renderer.ts`：`renderCard(state, density)`，三档 `compact / standard / detailed`；
  detailed 含完整 reasoning、工具输入输出与 token usage。
- `src/card/run-state.ts`：`reduce(state, event)` 状态机；`usage` 字段由 `usage` 事件更新。
- `src/card/approval-card.ts`：`renderApprovalCard(input)`（allow-once / reject-once 按钮）。
- `src/card/question-card.ts`：`renderQuestionCard(input)`（单选 / 多选 / 自由文本）与
  `extractQuestionAnswer(kind, value, options)`。
- `src/card/density.ts`：`CardDensity` 与 `parseCardDensity`。
- `src/bot/density-store.ts`：per-scope 卡片密度覆盖；`/density` 命令读写。
- `src/bot/approvals.ts`：`ApprovalRegistry`，pending 审批注册与结算（run 结束 / dispose 时
  `settleAll(scope, 'cancelled')`）。
- `src/bot/questions.ts`：`QuestionRegistry`，`/ask` 问答卡注册与答案回写会话。

## 5. 安全模块 · Security

`src/config/security.ts` 提供：

- `redactSecrets(text)`：Bearer / `sk-` / `api_key=` 正则脱敏。
- `isPathWithin(root, candidate)`：realpath containment（拒绝符号链接逃逸）。
- `truncateUtf8Safe(text, maxBytes)`：UTF-8 安全字节截断。
- `isEventFresh(timestampMs, windowMs, now?)`：过期事件拒绝。
- `isSafeHttpUrl(url)`：SSRF 防护（拒绝环回 / 私网 / 链路本地 / CGNAT / IPv6 ULA）。
- `DEFAULT_DENIED_INTERACTIVE_TOOLS` / `isDeniedTool(name)`：IM 不可回达工具默认拒绝。

已接入：`src/core/logger.ts`（字段名 + 字符串正则双重脱敏）、`src/media/attachments.ts`
（containment + UTF-8 安全读取）、`src/workspace/git-worktree.ts`（containment）、
`src/bridge/channel.ts`（默认拒绝 dmMode + 过期消息）。详细威胁模型见根目录 `SECURITY.md`。

## 6. 结构化日志 · Structured logging

`src/core/logger.ts` 提供：

```ts
export interface Logger {
  info(category: string, event: string, fields?: LogFields): void;
  warn(category: string, event: string, fields?: LogFields): void;
  error(category: string, event: string, fields?: LogFields): void;
  fail(category: string, error: unknown, fields?: LogFields): void;
}
```

日志按 JSON Lines 输出到 stderr，并自动脱敏 secret/token/password/api_key 等字段与
`Bearer …` / `sk-…` / `api_key=…` 文本。

## 7. CLI · Command line

当前命令：

- `dsh-lark-bot start`：前台启动桥接
- `dsh-lark-bot doctor`：运行本地诊断（含对应 adapter 的真实可用性探测）
- `dsh-lark-bot --version` / `-v`：版本号

两个启动类命令均支持 `--profile`、`--workspace`、`--app-id`、`--app-secret`、`--tenant`。

飞书会话内支持：`/new`、`/reset`、`/cd`、`/ws list|save|use|remove`、`/status`、`/resume`、
`/stop`、`/timeout`、`/density`、`/ask`、`/invite user|admin|group|list|remove`、`/help`。

## 8. 桥接层 · Bridge

- `src/bridge/channel.ts`：`startChannel(deps)` 建立飞书长连接，路由 `message` / `cardAction`
  事件，处理 `stop` / `approve` / `question-submit` 卡片按钮。
- `src/bridge/run-flow.ts`：`runAgentBatch(input)` 单次 agent 运行（worktree 确保、事件消费、
  超时看门狗、审批/问答接线）；`approvalHandlerFor` / `questionHandlerFor` 提供卡片回调。
- `src/bridge/lark-channel.ts`：`adaptLarkChannel` 把 `LarkChannel` 适配为 `StreamingChannel`。
