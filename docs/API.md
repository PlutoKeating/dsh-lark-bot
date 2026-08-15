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
  adapterMode: 'sdk' | 'acp' | 'headless' | 'web';
  /** Base URL of the local dsh web agent used by the `web` adapter (default http://127.0.0.1:3080). */
  webBaseUrl: string;
  /** Push web-GUI turn completions to Feishu in `web` adapter mode (default true; DSH_LARK_WEB_PUSH=0 disables). */
  webPush: boolean;
  provider: string;
  model: string;
  maxTokens: number | undefined;
  runTimeoutMs: number;
  stopGraceMs: number;
  accessDefaultDeny: boolean;
  eventFreshnessMs: number;
  heartbeatMs: number;
  guardianDisabled: boolean;
  guardianProfile: string;
  guardianBridgeProfile: string;
  guardianPollMs: number;
  guardianStaleMs: number;
  guardianEngineDeadMs: number;
}

export function loadRuntimeEnv(source?: NodeJS.ProcessEnv): RuntimeEnv;
```

环境变量前缀统一为 `DSH_LARK_*`，敏感值只保留在运行时对象中，不写入日志或提交。完整清单见
`README.md` 与 `.env.example`；本节仅列关键项：

- `DSH_LARK_ADAPTER`：`sdk`（默认，官方 SDK client）/ `acp`（ACP 审批）/ `headless`（legacy）/
  `web`（本地 dsh web agent，单写者）。
- `DSH_LARK_WEB_URL` / `DSH_LARK_WEB_PUSH`：`web` 适配器的本地 dsh web base URL（默认
  `http://127.0.0.1:3080`）与网页端回合推送开关（默认开，`0` 关闭）。
- `DSH_LARK_DSH_COMMAND` / `DSH_LARK_DSH_ARGS`：可选；未设置时自动发现本机 `@deepseek-ai/dsh` 安装路径。
- `DSH_LARK_MAX_TOKENS`：可选，SDK-created agent 的每请求输出 token 上限。
- `DSH_LARK_ACCESS_DEFAULT_DENY`：无白名单时是否拒绝私聊（默认 `false`，兼容 onboarding）。
- `DSH_LARK_EVENT_FRESHNESS_MS`：过期消息拒绝窗口（默认 `600000`，`0` 关闭）。
- `DSH_LARK_RUN_TIMEOUT_MS`：单次运行空闲超时（持续无活动事件才终止，活跃任务不会被误杀），
  默认 `300000`。
- `DSH_LARK_STOP_GRACE_MS`：SIGTERM 后等待优雅退出再 SIGKILL 的宽限期，默认 `5000`。
- `DSH_LARK_SCOPE_CONCURRENCY`：每个 scope 允许的并行 run 数，默认 `2`（`1` 为严格串行）。
- `DSH_LARK_RETENTION_MSGS`：每个 scope 保留的对话条数，默认 `40`（`0` 表示不裁剪）。
- `DSH_LARK_ARCHIVE_MAX`：每个 scope 最多保留的归档数，默认 `50`（`0` 关闭清理）。
- `DSH_LARK_ARCHIVE_MAX_AGE_DAYS`：归档最大保留天数，默认 `90`（`0` 关闭按龄清理）。
- `DSH_LARK_DISABLED`：`1` 时保持桥接引擎停止（插件仍作为标准插件加载）。
- `DSH_LARK_HEARTBEAT_MS`：桥接引擎心跳写入间隔，默认 `5000`（安全网守护的存活信号）。
- `DSH_LARK_GUARDIAN_DISABLED`：`1` 时安全网守护进程保持停止。
- `DSH_LARK_GUARDIAN_PROFILE`：守护监视 / 重启的 dsh profile，默认 `dsh-lark`。
- `DSH_LARK_GUARDIAN_BRIDGE_PROFILE`：提供飞书凭据与白名单的桥接状态 profile，默认 `default`。
- `DSH_LARK_GUARDIAN_POLL_MS`：守护看门狗轮询间隔，默认 `2000`。
- `DSH_LARK_GUARDIAN_STALE_MS`：心跳超时阈值，默认 `15000`。
- `DSH_LARK_GUARDIAN_ENGINE_DEAD_MS`：dsh 进程存活但心跳持续超时该时长即判定桥接引擎已死
  并接管，默认 `120000`。
- `DSH_LARK_GUARDIAN_SAFE_ADAPTER`：安全模式引擎选择，`auto`（默认，SDK 流式优先、失败回退
  headless）/ `sdk`（强制 SDK）/ `headless`（跳过预置）。
- `DSH_LARK_GUARDIAN_SAFE_TIMEOUT_MS`：安全模式单任务空闲超时（持续无活动事件才终止），默认
  `600000`；到时停止运行并渲染超时卡。
- `DSH_LARK_GUARDIAN_CARD_DENSITY`：安全模式任务卡片密度，默认 `detailed`
  （`compact` / `standard` / `detailed`）。

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
  archivesDir(profile: string): string;
  logsDir(profile: string): string;
}

export function resolveAppPaths(root?: string): AppPaths;
```

默认根目录为 `~/.dsh-lark`，可通过 `DSH_LARK_HOME` 覆盖。

桥接引擎日志：以 JSON Lines 输出到 stderr（由 dsh 宿主进程捕获；`logs/bot.log` 是
0.6.0 独立服务时代的遗留路径，0.7.0 起不再写入）。

安全网守护相关本地状态：

- 守护状态：`~/.dsh-lark/guardian.json`（dsh profile / 桥接 profile / 安全 profile /
  `profileSeenUp` / `mode` / `relaunchedPid`，0600）。
- 桥接心跳：`profiles/<bridge-profile>/guardian/heartbeat.json`
  （`{ pid, startedAt, ts }`，桥接引擎每 `DSH_LARK_HEARTBEAT_MS` 原子写入，0600）。
- 仅核心安全 profile：`~/.dsh/profiles/<dsh-profile>-safe`（`dsh-base` + `dsh-headless`，
  无第三方插件）。
- 安全模式 SDK 流式 profile：`~/.dsh/profiles/<dsh-profile>-safe-sdk`（官方 `dsh-base` +
  `dsh-sdk-jsonrpc-server`，无第三方插件，由守护优先预置）。

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

`src/bot/concurrency-store.ts` 提供内存级 `ConcurrencyStore`，按 scope 覆盖并行 run 上限；
`/concurrency [N|default]` 读写，覆盖值优先于 `DSH_LARK_SCOPE_CONCURRENCY`（默认 2）。

`src/bot/active-runs.ts` 的 `ActiveRuns` 允许同一 scope 持有多个并发 run
（`Map<scope, Map<runId, handle>>`）：`list(scope)` / `count(scope)` 查询，
`interrupt(scope)` 终止全部并返回数量，`interruptRun(scope, runId)` 定向终止单个。
`src/bot/pending-queue.ts` 的 `PendingQueue` 支持按 scope 的并发上限
（`concurrencyFor(scope)` 构造参数），同一 scope 可并行 flush 多个批次；
`block(scope)` 只阻止新批次启动，不影响已运行的批次。

`runAgentBatch`（`src/bridge/run-flow.ts`）按 `maxConcurrency` 拒绝超限 run；同一 scope 的
**首个** run 会续跑 dsh 原生 session，并发 run 一律使用全新 session id，避免共享 wire session。

`src/config/access-manager.ts` 的 `AccessManager` 把 `/invite user|admin|group|list|remove` 的
变更持久化到当前 profile 的访问白名单。

`src/bot/model-store.ts` 提供内存级 `ModelStore`，按 scope 覆盖模型：

```ts
export class ModelStore {
  get(scope: string): string | undefined;
  set(scope: string, model: string): void;
  clear(scope: string): boolean;
}
```

飞书命令 `/model use <id>` 写该 store（下一轮消息生效），`/model reset` 清除覆盖。

`src/config/dsh-config.ts` 的 `DshProviderManager` 直接读写 dsh 官方配置文件，与
`dsh` Web **Settings → Models** 页面共用同一存储协议，改动在下一个请求生效、无需重启：

- `~/.dsh/settings.yaml`：`llm-deepseek` / `llm-pi-ai`（`providers` 字典）/ `agent-default-model`
  命名空间；写入使用 dsh-settings-file 同款 `patchNode` 叶子 diff + `<file>.lock` 跨进程写锁 +
  原子替换，保留注释与无关字段。
- `~/.dsh/.credentials.yaml`：凭据映射（0600，目录 0700），settings 只保存 `apiKeyEnv` 引用，
  字面密钥不进入 settings。

```ts
export class DshProviderManager {
  listProviders(): Promise<DshProviderSummary[]>;
  defaultModel(): Promise<string | undefined>;
  setDefaultModel(model: string): Promise<void>;
  upsertDeepseekProvider(input: { baseURL?; apiKeyEnv?; apiKey? }): Promise<void>;
  removeDeepseekProvider(): Promise<void>;
  addDeepseekModel(input: DshModelEntry): Promise<void>;
  removeDeepseekModel(id: string): Promise<boolean>;
  upsertPiAiProvider(input: DshPiAiProviderInput): Promise<void>;
  removePiAiProvider(id: string): Promise<boolean>;
  addPiAiModel(providerId: string, input: DshModelEntry): Promise<void>;
  removePiAiModel(providerId: string, modelId: string): Promise<boolean>;
  setCredential(ref: string, value: string): Promise<void>;
  removeCredential(ref: string): Promise<boolean>;
  listCredentialRefs(): Promise<string[]>;
  hasCredential(ref: string): Promise<boolean>;
}
```

pi-ai 协议白名单对齐官方 `supportedProtocols()`：`openai-completions` / `openai-responses` /
`anthropic-messages`；自定义 provider 按官方 schema 需要 `api` + `baseURL` + 非空 `models`。
模型优先级：scope 覆盖（`/model use`）> profile `preferences.model` > dsh
`agent-default-model`（`/model default` 写入）> `DSH_LARK_MODEL` / 环境默认。

dsh 兼容矩阵的**单一事实来源**为 `src/config/dsh-compat.ts`（`DSH_COMPATIBILITY`），
供 `sdk-runtime.ts` / `acp-runtime.ts` 的版本常量引用；升级流程见
[`COMPATIBILITY.md`](COMPATIBILITY.md)。

`src/session/store.ts` 的 `SessionStore` 保存每个 scope 最近 `retention` 条对话
（默认 40），`recordExchange` 支持传入 `{ retention, onArchive }`：超出保留窗口的消息先交给
`onArchive` 归档，再裁剪；支持 `fork(scopeId, newScopeId, cwd)` 复制历史。SDK 模式以原生
`session(id)` 续跑，headless 模式把历史拼入下一次 prompt 作为近似上下文。

`src/session/archive.ts` 提供 `SessionArchive`：每次归档写 Markdown 转写 + JSONL 原始数据到
`<profile>/archives/<scope-slug>/<timestamp>.jsonl|.md`，归档目录惰性初始化为独立 Git 仓库，
每次归档 / 清理单独 commit；`list(scope)` 列出归档，`prune({ maxArchives, maxAgeMs })` 按
scope 保留策略清理。`src/bot/retention-store.ts` 提供内存级 per-scope 保留条数覆盖，
`/retention [N|default]` 读写。

`src/bot/role-store.ts` 提供持久化 `RoleStore`（`<profile>/roles.json`，0600）：角色定义
（`RoleDefinition`：`id` / `name` / `persona` / 可选 `model` / `tools` / `agentsMd`）与
per-scope 角色绑定。`/role list|show|set|clear|save|remove` 读写；save / remove 仅管理员。
运行期 `runAgentBatch` 接收 `role` 选项：角色 persona / 工具指引 / 规则作为 prompt 前缀注入，
模型优先级为 每会话 `/model use` > 角色 `model` > profile 偏好 > dsh 默认 > 环境默认。

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
  /** True for the SDK adapter: `run()` natively resumes `options.sessionId`.
   *  ACP / headless 每次全新，桥接层会为其把 scope 转写重放进 prompt。 */
  resumeCapable?: boolean;
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
  创建 `~/.dsh/profiles/dsh-lark-sdk`（`dsh-base` + `dsh-sdk-jsonrpc-server`），按 cwd 管理
  `DeepSeekHarness` runtime 池，`session(id)` 原生续跑；`/stop` 关闭对应 runtime。
- `acp`：`AcpDshAdapter`（`src/adapters/dsh/acp-adapter.ts`），先 `ensureAcpProfile` 创建
  `~/.dsh/profiles/dsh-lark-acp`（`dsh-base` + `dsh-acp`），以 `ClientSideConnection` 连接
  ACP server，`session/request_permission` 映射审批卡；会话每次全新。
- `headless`：`DshAdapter`（`src/adapters/dsh/adapter.ts`），legacy 子进程 JSONL 翻译。
- `web`：`WebDshAdapter`（`src/adapters/dsh/web-adapter.ts`），驱动本地 dsh web agent
  （`session.create` / `session.prompt` + `/api/events.mux` WebSocket），网页端成为**唯一写者**，
  从根上消除多写者会话损坏，跨实例续接天然可用；`web-watcher.ts` 在 `web` 模式下把网页端回合
  完成推送到飞书并自动切换会话映射与工作区 cwd。

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

## 7. dsh 插件装载 · Plugin loading

包是标准 dsh profile bundle（`dsh.bundle.patch`）。profile 启动时 dsh 以标准插件方式装载：

- `dsh-lark-bot/plugin`（`src/plugin.ts`）：cordis 插件，启动/停止**进程内**桥接引擎
  （`startBridgeEngine`，见 §3 与 `src/cli/commands/run.ts`），并注册 `ctx.larkBridge`
  服务（`status()` / `stop()`）。首次启动无凭据时引擎执行扫码绑定；`DSH_LARK_DISABLED=1`
  时保持停止。插件卸载时返回的 disposer 会停止引擎。
- `dsh-lark-bot/notify`：`lark_notify` 工具（见 §9），配置缺省时在执行时读取
  `DSH_LARK_NOTIFY_URL` / `DSH_LARK_NOTIFY_TOKEN` 环境变量。
- `dsh-lark-bot/ask`：`lark_ask_user` 工具（见 §9），agent 需要用户拍板 / 补充信息时
  通过问答卡向飞书会话提问并等待答案，配置缺省时读取 `DSH_LARK_ASK_URL` /
  `DSH_LARK_NOTIFY_TOKEN` 环境变量。

常驻 / 守护 / 重启由 dsh 宿主负责；本项目不再包含独立后台服务层。唯一进程级例外是默认安装的
「安全网守护」（见 §10）：它独立于 dsh / Cordis 常驻，仅在 dsh 下线后接管飞书通道。桥接引擎
启动后开始向 `profiles/<bridge-profile>/guardian/heartbeat.json` 写心跳，引擎停止时停止心跳。

## 8. CLI · Command line

当前命令（唯一用户路径 = `setup`）：

- `dsh-lark-bot setup --profile <name>`：唯一安装-部署命令——定位 dsh、预批准 pnpm 构建策略、
  执行标准 `dsh plugin --profile <name> add dsh-lark-bot`，并打印下一步
  （`dsh --profile <name>`）。默认 profile 名 `dsh-lark`。
- `dsh-lark-bot upgrade [--profile <name>] [--check] [--yes] [--no-guardian] [--restart]
  [--rollback] [--force] [--package <spec>]`：一行命令彻底升级（issue #10）——检测已装 /
  运行中 CLI / npm 最新版本 → `dsh plugin add <name>@<latest>` 升级包本体 → 幂等重装并
  重启 guardian 服务 → `doctor` 验证。运行中实例默认只提示重启命令（不中断会话）；
  `--restart` 额外重启 guardian 服务与受管 dsh profile 进程；`--check` 只报告；
  `--rollback` 回滚到上次升级前版本（记录在 `~/.dsh-lark/upgrade-state.json`）；
  `--force` 离线时按当前版本重装；非交互环境不带 `--yes` 会安全中止。
- `dsh-lark-bot doctor`：运行本地诊断（含对应 adapter 的真实可用性探测）。
- `dsh-lark-bot --version` / `-v`：版本号。
- `dsh-lark-bot run`（隐藏）：直接运行桥接引擎（诊断用；插件模式下引擎在 dsh 进程内运行）。
- `dsh-lark-bot setup`：安装 bundle 的同时**默认安装安全网守护**（`--no-guardian` 可跳过；见 §10）。
- `dsh-lark-bot guardian run|install|uninstall|status`：安全网守护常驻 / 系统服务安装 /
  卸载 / 状态查询（见 §10）。

飞书会话内支持：`/new`、`/reset`、`/cd`、`/ws list|save|use|remove`、`/status`、`/resume`、
`/stop`、`/timeout`、`/concurrency`、`/role list|show|set|clear|save|remove`、`/retention`、
`/archive [note|list [N]|clean]`、`/density`、
`/model use|default|reset|add|remove`、`/providers`、
`/provider add|update|remove`、`/key set|remove|list`、`/ask`、
`/invite user|admin|group|list|remove`、`/help`。安全网守护接管期间额外支持
`/safemode`、`/safemode status|plugins|exit|help`。

### 8.1 dsh bundle 导出 · Bundle exports

包同时是 dsh profile bundle（`dsh.bundle.patch` → `./cordis.patch.yml`），额外导出：

- `./plugin`（`src/plugin.ts`）：cordis 插件 `dsh-lark-bot`，提供 `ctx.larkBridge` 服务
  （`status()` / `stop()` / `start()`）；默认在 profile 启动时**进程内**启动桥接引擎，
  配置 `{ profile?, home?, appId?, appSecret?, tenant?, workspace?, adapter?, model?, disabled? }`；
  `DSH_LARK_DISABLED=1` 时保持停止。
- `./invariant`（`src/invariant.ts`）：`dsh-lark-bot-invariant` 伴生模块，向宿主
  `invariants` 注册表登记包归属（与官方 dsh-lark-channel/invariant 同契约）。
- `./notify`（`src/notify/tool.ts`）：`lark-notify` 工具插件（见 §9）。
- `./ask`（`src/notify/ask-tool.ts`）：`lark-ask` 问答卡工具插件（见 §9）。

`dsh plugin --profile <name> add dsh-lark-bot`（或一行 `dsh-lark-bot setup`）后，profile 的
`dsh.profile.bundles` 会追加 `dsh-lark-bot`，启动时应用 `cordis.patch.yml` 层（
`dsh-lark-bot/plugin` + `lark-notify` 两行）。

## 9. 桥接层 · Bridge

- `src/bridge/channel.ts`：`startChannel(deps)` 建立飞书长连接，路由 `message` / `cardAction`
  事件，处理 `stop` / `approve` / `question-submit` 卡片按钮。
- `src/bridge/run-flow.ts`：`runAgentBatch(input)` 单次 agent 运行（worktree 确保、事件消费、
  超时看门狗、审批/问答接线）；`approvalHandlerFor` / `questionHandlerFor` 提供卡片回调。
- `src/bridge/lark-channel.ts`：`adaptLarkChannel` 把 `LarkChannel` 适配为 `StreamingChannel`。

`src/bridge/send-options.ts` 定义出站 `SendOptions { replyTo?, mentions?, threadId? }` 与
`MentionTarget { userId, name? }`：`sendMarkdown` / `sendCard` / `streamCard` 均接受该选项，
`adaptLarkChannel` 把 `mentions` 映射为 `@larksuite/channel` 的 `SendOptions.mentions`
（自动拼接 `<at>` 提及标记），`threadId` 映射为 `replyInThread`。

`src/bridge/scope-directory.ts` 提供持久化 `ScopeDirectory`（`<profile>/scopes.json`）：每个
入站消息注册 scope → `{chatId, threadId}`，`resolve(scope)` / `resolveChat(chatId)` 用于
跨会话出站；`/notify <scope|chatId> <text>` 与 `/notify list` 读写该目录。

`src/notify/server.ts` 提供 `NotifyServer`：127.0.0.1 回环 HTTP 服务，`POST /notify` 以
`token` 鉴权，解析 scope/chat 后调用注入的 `send(destination, {text, mentions})`；token 由
`generateNotifyToken()` 每启动生成，不落盘、不进日志。`src/notify/tool.ts` 是 cordis 插件
（`dsh-lark-bot/notify`，`inject: ['tools']`）：注册 dsh 工具 `lark_notify`
（`text` / `scope` / `chat_id` / `mention_user_ids`），把请求 POST 回 bridge 的
`DSH_LARK_NOTIFY_URL`（token 取 `DSH_LARK_NOTIFY_TOKEN`）。

同一服务器还提供 `POST /ask`（`server.askUrl`，桥接进程写 `DSH_LARK_ASK_URL`）：
`src/notify/ask-handler.ts` 的 `buildAskHandler` 按 `sessionId` 反查 scope（
`SessionStore.scopeForSession`）并解析到 chat/thread，用现有
`QuestionRegistry` + `renderQuestionCard` 发送问答卡，等待卡片提交后把答案返回
给 runtime。`src/notify/ask-tool.ts` 是 cordis 插件（`dsh-lark-bot/ask`，
`inject: ['tools']`）：注册 dsh 工具 `lark_ask_user`（`question` / `kind` /
`options` / `header`，`timeoutMs` 10 分钟），执行时以 `exec.agent.session.id`
定位会话并 POST 到 `DSH_LARK_ASK_URL` 阻塞等待答案；答案作为普通工具结果
回到 agent 循环。问答卡等待期间 run 超时看门狗暂停（`QuestionRegistry.pendingCount`
/ `onSettled`），用户答完卡后重新计时。

SDK / ACP runtime profile（`src/adapters/dsh/sdk-runtime.ts` / `acp-runtime.ts`）会在
`cordis.patch.yml` 插入 `lark-notify` 行，并把当前 bridge 包以 `link:` 依赖加入 profile，
同时插入 `lark-ask` 行，因此 `lark_notify` 与 `lark_ask_user` 在 `sdk` 与 `acp` 两种
adapter 下都自动可用（`headless` 无 runtime profile，不提供这两个工具）。

## 10. 安全网守护 · Safety-net guardian（issue #6）

守护是一个**独立于 dsh / Cordis 的最小 Node 进程**（系统级常驻：Linux systemd user unit /
macOS LaunchAgent / Windows 启动项），由 `dsh-lark-bot guardian run` 启动。它不导入任何 dsh
代码，只依赖 `@larksuite/channel` 与 Node 内置模块。

### 10.1 心跳 · Heartbeat

`src/guardian/heartbeat.ts`：

```ts
export interface HeartbeatPayload { pid: number; startedAt: string; ts: number }
export function startHeartbeat(file: string, pid: number, intervalMs?: number): { stop(): void };
export function readHeartbeat(file: string): Promise<HeartbeatPayload | undefined>;
export function isHeartbeatFresh(payload: HeartbeatPayload | undefined, maxAgeMs: number, now?: number): boolean;
export function heartbeatAgeMs(payload: HeartbeatPayload, now?: number): number;
```

桥接引擎（`startBridgeEngine`，§3）启动后以 `DSH_LARK_HEARTBEAT_MS`（默认 5000）周期写入
`~/.dsh-lark/profiles/<bridge-profile>/guardian/heartbeat.json`（0600 原子写），引擎停止时
停止心跳。

### 10.2 状态 · Guardian state

`src/guardian/state.ts`：`GuardianState`
（`dshProfile` / `bridgeProfile` / `safeProfile` / `profileSeenUp` / `mode` / `relaunchedPid`）
持久化于 `~/.dsh-lark/guardian.json`（0600）。`mode` ∈ `standby`（静默）| `takeover`
（已接管飞书通道）| `safe`（安全模式对话中）。

### 10.3 仅核心安全 profile · Core-only safe profile

`src/guardian/safe-profile.ts`：

- `ensureSafeProfile({ home, dshProfile, env })`：在 `~/.dsh/profiles/<dsh-profile>-safe`
  写入 `package.json`（`dsh.profile.bundles = ['@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-headless']`）、空 `cordis.patch.yml`、空 `cordis.yml` 与
  `pnpm-workspace.yaml`；已存在文件不覆盖。
- `probeSafeProfile({ bin, dshProfile, home, env, run? })`：以 `dsh --profile <safe>
  --dump-config`（boot-free）验证核心 bundle 可解析，失败返回 stderr 尾部供飞书展示。

两个 bundle 均来自 dsh 安装自身的依赖闭包（dsh 启动时 heal `$DSH_HOME/profiles/node_modules`），
无需 pnpm 安装，也不受故障 profile 的 node_modules / 第三方插件影响。安全模式进入时守护优先
通过 `ensureSdkProfile`（`src/adapters/dsh/sdk-runtime.ts`，`bridgeTools: false`，profile
`dsh-lark-safe-sdk`）预置 SDK 流式 runtime；预置失败（如缺 pnpm）或 `DSH_LARK_GUARDIAN_SAFE_ADAPTER`
为 `headless` 时回退到上面的核心 headless profile。

### 10.4 进程观察 · Process watch

`src/guardian/process.ts`：

```ts
export interface ProfileProcess { pid: number; cmdline: string }
export function matchProfileProcess(cmdline: string, dshProfile: string): boolean;
export async function findProfileProcess(dshProfile: string): Promise<ProfileProcess | undefined>;
export function isProcessAlive(pid: number): boolean;
export async function captureOutput(command, args, timeoutMs?): Promise<{ code; stdout; stderr }>;
export function spawnDetached(command, args, env?): { pid?: number };
```

`matchProfileProcess` 匹配 `--profile <name>` 参数且命令行为 dsh launcher（包含
`@deepseek-ai/dsh` 或独立 `dsh` 词元），不会把 `<name>-safe` 误判为完整 profile。

### 10.5 控制信号 · Control signals

`src/guardian/control.ts`：`parseGuardianCommand(text)` 解析 `/safemode`、
`/safemode status|plugins|exit|help`（含大小写与别名）。

### 10.6 接管状态机 · GuardianService

`src/guardian/service.ts`：

```ts
export class GuardianService {
  constructor(options: GuardianServiceOptions);
  async start(): Promise<void>;
  async stop(): Promise<void>;
  snapshot(): GuardianSnapshot;
}
export async function buildGuardianService(env: RuntimeEnv, overrides?): Promise<GuardianService>;
```

状态机（每 `DSH_LARK_GUARDIAN_POLL_MS` 轮询）：

1. **standby**：dsh 在线（心跳新鲜，或存在 `--profile <name>` 进程且心跳未超过
   `DSH_LARK_GUARDIAN_ENGINE_DEAD_MS` 判定引擎已死）→ 不连接飞书；记录 `profileSeenUp`。
2. **takeover**：`profileSeenUp` 且 dsh 持续下线（`DSH_LARK_GUARDIAN_STALE_MS` 心跳过期 +
   无进程，连续 `takeoverGracePolls` 次）→ 用桥接 profile 的凭据 / 白名单创建
   `@larksuite/channel` 长连接；只有 admin（无 admin 时回退 allowedUsers）可触发控制命令。
3. **safe**：`/safemode` 通过安全 profile 探测后，以 `DshAdapter`（`dsh --profile <safe>
   "<prompt>"`，headless 回退）或 `SdkDshAdapter`（`dsh-lark-safe-sdk`，默认优先，实时流式
   思考 / 工具 / 文字）逐条执行对话；SDK 模式以原生 `session(id)` 续跑，headless 模式把历史
   上下文拼接进 prompt（每 scope 上限 30 条）。任务期间守护通过 `streamCard` 渲染实时卡片
   （`renderCard` / `RunState`，含已运行秒数、无响应提示、⏹ 终止按钮），并受
   `DSH_LARK_GUARDIAN_SAFE_TIMEOUT_MS` 空闲看门狗约束（任务持续无活动事件才调用
   `run.stop()` 并渲染超时卡，活跃任务不会被误杀）；
   同一 scope 同时只允许一个安全任务，忙碌时新消息立即回执；“/safemode stop”与卡片按钮均可
   终止当前任务。`/safemode plugins` 执行 `dsh plugin --profile <name> list`；
   `/safemode exit` 以 detached 方式重启完整 profile，短暂延迟后断开飞书连接并回到 standby。

dsh 重新在线时（用户手动启动或退出安全模式后），守护立即断开飞书连接并清空安全模式上下文。
守护进程可随时用 `DSH_LARK_GUARDIAN_DISABLED=1` 停止；`guardian status` 只读输出当前状态。

### 10.7 系统服务安装 · Service install

`src/guardian/install.ts`：

- `installGuardian({ env, dshProfile?, bridgeProfile?, dryRun?, run?, rootOverride? })`：
  写入 `~/.dsh-lark/guardian.json`，并按平台写 systemd user unit / LaunchAgent plist /
  Windows 启动项，尝试激活（`systemctl --user enable --now` / `launchctl bootstrap`），失败时
  打印手动命令。
- `uninstallGuardian({ env, run?, rootOverride? })`：停用并删除服务文件，保留状态文件。
- `systemdUnit` / `launchdPlist` / `windowsStartupCmd`：纯函数生成单元文件内容（可测试）。

CLI：`dsh-lark-bot setup`（默认安装守护，`--no-guardian` 跳过）、
`dsh-lark-bot guardian run|install|uninstall|status`。
