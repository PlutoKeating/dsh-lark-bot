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
  /** Enable explicit DSH session history/live projection in `web` mode. */
  sessionProjectionEnabled: boolean;
  sessionBackfillMessages: number;
  sessionBackfillBytes: number;
  sessionStreamUpdateMs: number;
  provider: string;
  model: string;
  maxTokens: number | undefined;
  runTimeoutMs: number;
  stopGraceMs: number;
  accessDefaultDeny: boolean;
  eventFreshnessMs: number;
  groupNoAt: boolean;
  groupPollMs: number;
  botHandoffMax: number;
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

- `DSH_LARK_ADAPTER`：`sdk`（默认，官方 SDK client + approval answerer）/ `acp`（协议原生审批）/ `headless`（legacy）/
  `web`（本地 dsh web agent，单写者）。
- `DSH_LARK_WEB_URL`：`web` 适配器的本地 dsh web base URL（默认
  `http://127.0.0.1:3080`）。
- `DSH_LARK_SESSION_PROJECTION`：显式 session 历史/实时投影开关，默认开启；它不允许
  WebUI/TUI 活动自动修改飞书 binding。旧 `DSH_LARK_WEB_PUSH` 仅在新开关缺失时作为兼容别名。
- `DSH_LARK_SESSION_BACKFILL_MESSAGES` / `DSH_LARK_SESSION_BACKFILL_BYTES`：确认绑定后
  transcript 的人类消息数与 UTF-8 字节双重上限，默认 `20` / `65536`。
- `DSH_LARK_SESSION_STREAM_UPDATE_MS`：同一 assistant 投影卡的最小更新间隔，默认 `800` ms。
- `DSH_LARK_DSH_COMMAND` / `DSH_LARK_DSH_ARGS`：可选；未设置时自动发现本机 `@deepseek-ai/dsh` 安装路径。
- `DSH_LARK_MAX_TOKENS`：可选，SDK-created agent 的每请求输出 token 上限。
- `DSH_LARK_ACCESS_DEFAULT_DENY`：无白名单时是否拒绝私聊（默认 `false`，兼容 onboarding）。
- `DSH_LARK_EVENT_FRESHNESS_MS`：过期消息拒绝窗口（默认 `600000`，`0` 关闭）。
- `DSH_LARK_GROUP_NO_AT`：是否轮询已登记群聊的未 @ 消息（默认 `false`）；开启时必须配置
  非空 `allowedUsers`，并要求应用具有 `im:message.group_msg` 权限。
- `DSH_LARK_GROUP_POLL_MS`：无 @ 群消息轮询间隔（默认 `3000`，最小 `1000` 毫秒）。
- `DSH_LARK_PROFILE` / `DSH_LARK_DSH_PROFILE`：多实例 service 自动写入的 bridge/dsh profile
  identity；普通单实例无需手工设置。
- `DSH_LARK_BOT_HANDOFF_MAX`：共享 fleet 中连续可信 bot @ 交接上限，默认 `6`、最小 `2`；
  任一通过 freshness 检查的真人消息重置。
- `DSH_LARK_RUN_TIMEOUT_MS`：单次运行空闲超时（持续无活动事件才终止，活跃任务不会被误杀），
  默认 `300000`。
- `DSH_LARK_STOP_GRACE_MS`：SIGTERM 后等待优雅退出再 SIGKILL 的宽限期，默认 `5000`。
- `DSH_LARK_SCOPE_CONCURRENCY`：每个 scope 允许的并行 run 数，默认 `2`（`1` 为严格串行）。
- `DSH_LARK_RETENTION_MSGS`：每个 scope + workspace 保留的对话条数，默认 `40`（`0` 表示不裁剪）。
- `DSH_LARK_ARCHIVE_MAX`：每个 scope + workspace 最多保留的归档数，默认 `50`（`0` 关闭清理）。
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
- `DSH_LARK_UPGRADE_REGISTRY`：`dsh-lark-bot upgrade` 探测最新版本的 npm registry，
  默认官方 registry（可指向镜像，issue #10）。
- `DSH_LARK_UPGRADE_CHECK`：`doctor` 是否探测 npm 最新版本并输出更新提醒（默认开启，
  `0` 关闭；探测为 best-effort，失败不影响 doctor 结果，issue #15）。
- `DSH_LARK_UPGRADE_CHECK_INTERVAL_MS`：桥接引擎周期检查新版本的间隔（默认 6h，`0`
  关闭；发现新版本默认记日志，issue #15）。
- `DSH_LARK_UPGRADE_NOTIFY` / `DSH_LARK_UPGRADE_NOTIFY_CHAT`：`true` 时发现新版本向
  指定 chat 推送飞书通知（默认仅日志；issue #15）。

## 2. 本地状态路径 · Local state paths

`src/config/app-paths.ts` 提供：

```ts
export interface AppPaths {
  root: string;
  configFile: string;
  fleetFile: string;
  handoffFile: string;
  botDshHome: (name: string) => string;
  activeProfileFile: string;
  profileDir(profile: string): string;
  profilePath(profile: string, ...parts: string[]): string;
  sessionsFile(profile: string): string;
  sessionProjectionsFile(profile: string): string;
  permissionPoliciesFile(profile: string): string;
  notificationPreferencesFile(profile: string): string;
  replyPoliciesFile(profile: string): string;
  executionModesFile(profile: string): string;
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

`src/bot/isolation-store.ts` 提供持久化 `IsolationStore`（`<profile>/isolation.json`，0600），
按 chat 保存 `group|topic|member`。`src/bridge/scope-isolation.ts` 是消息与 card action 共用的纯
scope resolver：私聊始终用 chat ID；group 共用 chat ID；topic 使用 `chat:thread`；member 使用
`chat:member:open_id`。`/isolation` 只读对所有成员开放，修改仅管理员；切换不触碰已有 store。
运行、审批与问答卡的 action value 固化创建时 scope，避免模式切换后重算而失联；`/stop` 同时
遍历操作者当前可达的 group / topic / member scope。成员模式缺少 sender identity 时拒绝路由，
不会降级为共享群 scope。带 member scope 的 card action 还必须由同一 `open_id` 操作，其他成员
或缺失 operator identity 时失败关闭；group / topic 卡保持共享群既有语义。运行卡的 owner 从
入队时已经固化的 member scope 还原，不重读当前策略。

`src/bot/permission-policy-store.ts` 提供持久化 `PermissionPolicyStore`
（`<profile>/permission-policies.json`，0600），按隔离 scope 保存 `ask|allow|deny`，缺省为
`ask`。`/permission [policy] [scope]` 只读查询对已授权用户开放，修改仅管理员；可指定的目标
必须属于当前 chat（用于 member 隔离下代改），持久写入完成后才回执，失败回滚内存值；`allow`/`deny` 在 SDK/Web
`/approval` 回调和 ACP `onApprovalRequest` 入口于创建卡片前执行。`deny` 返回标准 rejected
outcome 并发送明确双语提示；计划门禁保持独立，不受该 store 影响。

`src/bot/notification-preference-store.ts` 提供默认关闭的 `NotificationPreferenceStore`
（`<profile>/notification-preferences.json`，0600），按 immutable scope 保存目标、
`completed|failed|approval` 事件、mention open_id 与审批提醒延迟。更新为 awaited atomic write，
失败回滚。`NotificationDispatcher` 在 durable job 终态落盘后发送完成/失败提醒；SDK/Web 与 ACP
审批卡创建后启动单次 timer，结算/取消即清除。发送失败只记日志，不改变 job/approval outcome。

`src/bot/reply-policy-store.ts` 提供 `ReplyPolicyStore`（`<profile>/reply-policies.json`，0600），
按 immutable scope 保存 `mergeWindowMs/maxBatchSize/minIntervalMs/dedupeWindowMs`；默认值保持即时逐条
回复且不启用内容近似去重。`/replies` 查询开放，修改允许 profile 管理员或当前群的群主/群管理员；
群角色通过 `im.v1.chat.get` 的 `owner_id/user_manager_id_list` 实时校验且失败关闭，awaited atomic write 失败会回滚。
`JobLedger.enqueueWithDeduplication` 在同一串行 durable transaction 内完成近似判断与入队，返回
`inserted|message-id-duplicate|content-duplicate`，避免并发消息同时越过检查。任务身份要求 sender、
scope、workspace、`rawContentType` 与资源描述均一致，再比较正文：短文本仅规范化精确匹配，长文本
使用高阈值字符 bigram Dice；不同附件不会因相同说明文字被误拦，相似命中会明确回执且不执行。

`src/bot/active-runs.ts` 的 `ActiveRuns` 允许同一 scope 持有多个并发 run
（`Map<scope, Map<runId, handle>>`）：`list(scope)` / `count(scope)` 查询，
`interrupt(scope)` 终止全部并返回数量，`interruptRun(scope, runId)` 定向终止单个。
`src/bot/pending-queue.ts` 的 `PendingQueue` 支持按 scope 的并发上限
（`concurrencyFor(scope)` 构造参数），同一 scope 可并行 flush 多个批次；
`block(scope)` 只阻止新批次启动，不影响已运行的批次；正常 agent dispatch 不额外 block，
使 `/concurrency` 的并行槽能让多个完成结果进入同一回复合并窗口。

`runAgentBatch`（`src/bridge/run-flow.ts`）按 `maxConcurrency` 拒绝超限 run；同一 scope 的
**首个** run 会续跑 dsh 原生 session，并发 run 一律使用全新 session id，避免共享 wire session。

`src/config/access-manager.ts` 的 `AccessManager` 把 `/invite user|admin|group|list|remove` 的
变更持久化到当前 profile 的访问白名单（`list` 为只读；其余写操作仅管理员可执行，见
`src/commands/index.ts` 的 `requireAdmin` 守卫）。

`src/bot/model-store.ts` 提供内存级 `ModelStore`，按 scope 覆盖模型：

```ts
export class ModelStore {
  get(scope: string): string | undefined;
  set(scope: string, model: string): void;
  clear(scope: string): boolean;
}
```

飞书命令 `/model use <provider/model>` 写该 store（也兼容唯一模型 ID，下一轮消息生效），
`/model reset` 清除覆盖。

`src/bot/execution-mode-store.ts` 提供持久 `ExecutionModeStore`：

```ts
type ExecutionMode = 'quick' | 'balanced' | 'deep';
get(scope: string): ExecutionMode; // 默认 balanced
set(scope: string, mode: ExecutionMode): Promise<void>;
flush(): Promise<void>;
```

状态原子写入 `<profile>/execution-modes.json`（0600），失败时回滚内存值并向命令/卡片回调传播失败。`/mode`（别名 `/effort`）无参数时发送双语选择卡，有参数时直接设置当前 immutable scope；卡片动作必须仍属于生成时的 scope 与 operator。`runAgentBatch` 在 run 创建时接收 `executionMode` 快照，并把统一执行指导加入 prompt，所以后续设置不会影响已经运行的 adapter。三档都明确保留安全、工具权限与计划审批边界。

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
  defaultModelSelection(): Promise<{ provider: string; model: string } | undefined>;
  resolveProviderForModel(modelId: string): Promise<DshProviderSummary | undefined>;
  resolveModelRoute(modelId: string): Promise<{ provider: string; model: string } | undefined>;
  linkCredentialRefIfMissing(providerId: string): Promise<boolean>;
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
pi-ai 的 `baseURL` 由 `normalizeBaseUrl()` 归一化：填根域名（如 `https://www.kingapi.xyz`）时
自动补全为 `/v1`；误填 `.../chat/completions`、`.../responses`、`.../messages` 等完整接口地址时
自动去掉末尾操作路径（dsh 的 pi-ai 适配器会自行追加 `/chat/completions` 等路径，保留完整端点
会导致请求 URL 双写路径、网关返回 404）。deepseek-official 的 `baseURL` 走
`normalizeDeepseekBaseUrl()`：同样去掉末尾操作路径，但保留裸根域名（官方 API 在根路径提供
接口，不强制补 `/v1`）。
模型优先级：scope 覆盖（`/model use`）> profile `preferences.model` > dsh
`agent-default-model`（`/model default` 写入）> `DSH_LARK_MODEL` / 环境默认。
`/model default` 按 dsh 官方 schema 写入 `{ provider, model }`（provider 由
`resolveModelRoute()` 从模型自动解析，找不到模型时报错）。每轮运行前
`src/cli/commands/run.ts` 用 `resolveModelRoute()` 解析路由并传给适配器：SDK 适配器
（`src/adapters/dsh/sdk-adapter.ts`）在路由变化时关闭旧 harness 并以新路由重建，
因此 `/model use` 的「下一轮生效」承诺真实落地（issue #47）。
`linkCredentialRefIfMissing()` 在运行前把「凭据名 == provider ID」的老配置自动补齐
`apiKeyEnv` 关联。dsh runtime 启动后异步注册 llm-pi-ai 路由（约几百毫秒），
`SdkDshAdapter` 对 initialize 握手做同进程轮询重试（issue #47 二次修复）。

交互式管理：`/providers`（或裸 `/provider`、`/model`、`/key`）打开管理卡片
（`src/card/config-cards.ts`），BotFather 式多轮向导由 `src/commands/config-wizard.ts` 驱动，
主卡将全部可用模型渲染为直接操作按钮，以 ✅ 标记按 scope / role / profile / dsh / env
优先级解析出的实际当前模型，并始终提供“恢复默认”；按钮携带明确的 `provider/model` 路由，
直接切换只写 per-scope `ModelStore`，下一轮生效且不清空会话上下文。文字命令同样接受
`/model use <provider/model>`，并继续兼容无歧义的裸模型 ID。
per-scope 向导状态由 `src/bot/wizard-store.ts` 持有（30 分钟无操作过期）；卡片 action
`value.cmd === 'wizard'`（携带 `submit` / `choose` / `confirm` / `cancel` 标记）与 `cfg` 系列
在 `src/bridge/channel.ts` 的 `cardAction` 路由中接线（provider、凭据和全局默认等持久化写操作
仅管理员；per-scope 模型热切换与 `/model use` 一致，对普通会话成员开放）。
所有卡片均为 schema 2.0：按钮直接放 `body.elements`（横向成组用 `column_set`
自动宽列，飞书 2.0 已废弃 `action` 容器，旧容器会被 Open Platform 以 sub-code 200861
拒绝）；需要收集输入/选择的步骤把 `input` / `select_static` 与 `form_action_type: "submit"`
按钮一起包进 `form` 容器，回调经 `action.form_value` 返回，否则输入值不会随按钮回调送达。

dsh 兼容矩阵的**单一事实来源**为 `src/config/dsh-compat.ts`（`DSH_COMPATIBILITY`），
供 `sdk-runtime.ts` / `acp-runtime.ts` 的版本常量引用；升级流程见
[`COMPATIBILITY.md`](COMPATIBILITY.md)。
当前 rc.8 runtime profile 会校验物理安装包的精确版本，不能仅凭目录存在判定 ready；
`lark_notify` / `lark_ask_user` / `lark_request_plan_approval` 直接向宿主 registry 注册 raw JSON Schema tool definition；
`dsh-lark-bot/approval` 以 structural listener 接入宿主 `approval/request` waterfall；两者都不携带
第二份 `dsh-tools`。完整审计见 [`DSH_RC8_AUDIT.md`](DSH_RC8_AUDIT.md)。

`src/session/store.ts` 的 `SessionStore`（schema 2）按 canonical `scope + workspace cwd` 保存各自最近 `retention` 条对话
（默认 40），`recordExchange` 支持传入 `{ retention, onArchive }`：超出保留窗口的消息先交给
`onArchive` 归档，再裁剪；支持 `fork(scopeId, newScopeId, cwd)` 复制历史。SDK 模式以原生
`session(id)` 续跑，headless 模式把历史拼入下一次 prompt 作为近似上下文。
同一 `sessions.json` 在对应 workspace state 中保存该 session 的累计
`inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens`，以及最近 32 个按 `sessionId` / canonical
`provider/model` 区分的协议 `contexts` 快照。`recordUsage` 只累加实际出现的非负字段；`recordContextUsage`
仅在 run 已知 native session 与有效模型时更新对应身份的快照；`metricsFor(scope, cwd, currentIdentity)` 只在 workspace 与身份完全一致时返回
`contextUsedTokens/contextWindow`，否则仅返回累计 token，避免模型切换、会话自愈或并行 run 交错后
误报旧占用。`clear(scope,cwd)`（由 `/new`、`/reset` 使用）只清当前 workspace 的会话与指标，
`/cd` / `/ws use` 会中断原 workspace active run，但不清理其数据，切回可续接；`clearSession(scope,cwd)` 的原生绑定自愈保留该 workspace 的
指标和 transcript。schema 1 的单 scope record 会在启动时按 `WorkspaceStore` 当前选择迁移，旧版无 metrics 也兼容。

`src/bot/job-ledger.ts` 的 `JobLedger` 使用独立 `jobs.json` schema 1。`enqueue(message)` 仅在原子
0600 snapshot 成功后返回，并按平台 `messageId` 幂等；`markRunning`、`checkpoint`、`finish` 记录
状态机 `queued → running → completed|failed|interrupted`。checkpoint 只允许阶段、工具名、runId 与
nativeSessionId，不保存 reasoning 或 tool input。`recoverInterrupted()` 只在 outbound channel ready 后将
启动前冻结的 running 转为 interrupted，并持久化待通知标记；通知失败或进程再次退出会在下次启动继续投递。
启动恢复只自动重放 queued。`retry(messageId,scope,cwd)` 仅允许当前 scope + workspace
的 failed/interrupted，并增加 attempts。`list/get/counts` 同样强制该隔离边界，终态裁剪为最近 500 条。
`/jobs [list|show <messageId>|retry <messageId>]` 提供对账；`/status` 显示 queued/running/interrupted/
failed 数。账本损坏会原名旁移为 `.corrupt-<timestamp>`；普通读取权限错误 fail closed，不被误判损坏。
启动在 channel connect 前只读冻结 recovery plan，连接后的新事件只走 live enqueue，避免恢复扫描重复回灌；
running 的状态转换延迟到 outbound ready，避免启动中途失败吞掉对账通知。
首次 enqueue 落盘失败会向原消息明确回复“未接收/未执行”；terminal `finish` 失败写结构化日志并发送
对账提示，保留 running receipt 供下次启动转 interrupted，不阻塞 scope 队列解锁。

`src/session/heal.ts` 提供会话自愈分类与归档：`classifySessionError(message)` 以锚定正则将
会话错误分为 `broken`（持久化日志与 live session 不一致 → 重置 scope 绑定、保留历史）与
`corrupt`（日志损坏 / seq gap → 归档后重置）两类，普通文本（模型输出 / 工具结果）不会误触发；
`archiveSessionDir(sessionId)` 先把会话目录**复制**到
`~/.dsh-lark/_archived-sessions/<id>-<ts>` 再删除原目录，并返回归档路径供用户可见与恢复
（复制失败不删原目录）。

`src/session/archive.ts` 提供 `SessionArchive`：每次归档写 Markdown 转写 + JSONL 原始数据到
`<profile>/archives/<scope-slug>/<timestamp>.jsonl|.md`，归档目录惰性初始化为独立 Git 仓库，
每次归档 / 清理单独 commit；`list(scope,cwd)` 列出当前 workspace 归档，
`prune({ scope, cwd, maxArchives, maxAgeMs })` 只按该 scope + workspace 的保留策略清理。
`src/bot/retention-store.ts` 提供内存级 per-scope 保留条数覆盖，
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

当前目录是 Git 仓库时，`runAgentBatch` 为每个 scope + canonical base path 在
`~/.dsh-lark/profiles/<profile>/worktrees/<scope-slug>-<path-hash>/` 创建 `dsh-lark/<slug>-*` 分支的 worktree
（slug 经过净化并做 realpath containment 校验）；非 Git 目录保持原路径。若 base 下有
`.dsh-lark/AGENTS.md` 或 `AGENTS.md` 且目标 worktree 没有，则复制为目标根目录 `AGENTS.md`。
若升级时发现旧版 `<scope-slug>` worktree，manager 先用 `git worktree list --porcelain` 解析 owning
main worktree；`SessionArchive.rebindWorkspaceCwd` 先以逐文件原子替换、可识别双文件半完成状态的
幂等流程重写旧 execution-cwd JSONL header 与 Markdown 顶部 metadata（不扫描或改写 transcript
正文），并提交归档仓库；全部成功后 `SessionStore` 才
提交 schema 2 并将 session 绑定到真实项目。失败时 schema 1 保留供下次启动重试，使旧 retention
归档始终可恢复为 list/clean。请求 base 与 owner 匹配时才用
`git worktree move` 搬到 path-hash 目标并保留 branch/dirty state；不匹配或 owner 不可验证时保留旧树，
为当前 base 新建独立 hashed worktree，避免从错误仓库移动或覆盖旧数据。

`src/workspace/store.ts` 维护命名工作区 `lastUsed` 索引；`/ws list` 优先通过 `sendCard` 发送
导航卡片，不支持卡片的通道回退 Markdown。消息进入 pending queue 时固化 workspace cwd；即使等待期间
切换工作台，该消息仍在原项目执行。pending queue 只合并同一固化 workspace 的连续消息，其他
workspace 的消息按原快照重新排队，不会串入同一次 run，也不会因 debounce batch 丢失。

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
  | { type: 'usage'; inputTokens?: number; outputTokens?: number;
      cacheReadTokens?: number; cacheWriteTokens?: number; costUsd?: number }
  | { type: 'context_usage'; usedTokens: number; contextWindow: number }
  | { type: 'done'; sessionId: string | undefined; terminationReason: 'normal' | 'interrupted' | 'timeout' }
  | { type: 'error'; message: string; terminationReason: 'failed' | 'interrupted' | 'timeout' };

export interface AgentRunOptions {
  runId: string;
  prompt: string;
  cwd: string | undefined;
  sessionId: string | undefined;
  /** Provider route for this run; adapters that bind a runtime route at
   *  construction time (SDK/ACP) rebind when it differs from the default. */
  provider?: string;
  model: string | undefined;
  images: readonly string[] | undefined;
  stopGraceMs: number | undefined;
  /** 一次性审批通道：ACP permission 或默认 runtime approval answerer 回调。 */
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
  /** True for the SDK adapter: a live runtime natively resumes `options.sessionId`.
   *  A persisted-log collision after restart is cleared and retried by run-flow;
   *  ACP / headless 每次全新，桥接层会为其把 scope transcript 重放进 prompt。 */
  resumeCapable?: boolean;
  isAvailable(): Promise<boolean>;
  checkAvailability(): Promise<AgentAvailability>;
  run(options: AgentRunOptions): AgentRun;
  dispose?(): Promise<void>;
}
```

审批类型：

```ts
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';
export interface ApprovalRequest {
  id: string;
  /** 上游 tool call 标识；卡片/registry id 会为并发请求单独生成。 */
  callId?: string;
  sessionId: string | undefined;
  toolName: string;
  reason: string | undefined;
  toolInput?: unknown;
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
  从根上消除多写者会话损坏，跨实例续接天然可用。`SessionProjectionBridge` 只消费用户在飞书
  显式确认的 binding；WebUI/TUI 的 open/resume/activity 不会自动切换或广播。

翻译与 runtime 管理模块：`src/adapters/dsh/sdk-translate.ts`（SDK `session.event` →
`AgentEvent`）、`sdk-runtime.ts` / `acp-runtime.ts`（profile 自动创建与自愈）、
`event-channel.ts`（有序事件队列）。

### 3.1 显式 session 投影契约

- `src/session/projection-protocol.ts`：rc.8 `session.list` / `session.history` / `session.prompt` 与
  `/api/events.mux` 的窄类型 facade；prompt 接受 bridge 生成的 `rpcId` 作为可信回环关联。
- `src/session/projection-store.ts`：以 `scope + canonical workspace` 为 key 原子持久化独占 binding、
  历史待确认水位/`lastProjectedSeq`、当前 turn 来源、近期 DSH↔飞书 message mapping（含未终态卡的
  恢复正文）和 prompt correlation；文件为 0600，写失败回滚。
- `src/session/projection-bridge.ts`：初始 history、live mux 和重连 catch-up 共用按 session/seq 串行的
  投影管线。独占 claim 可先落盘，但初始 history 确认前保持 pending cursor 并阻塞 live，发送失败由
  启动/重连按持久水位重试（期间的新事件留给后续 catch-up）；所有新投影卡使用由 session/event
  和持久 binding generation/目标派生的稳定 Feishu `uuid`；raw API 非零业务码或缺 message ID 一律
  fail closed，覆盖远端成功与本地
  cursor 落盘之间的崩溃窗口。低序号幂等跳过，未知必需事件 fail closed；cursor 只在飞书交付成功后前移。
- `src/commands/session-projection.ts`：`/session`、`/session bind <id>`、`/session current`。选择器仅列
  当前 canonical workspace 的非 subagent 元数据；确认 nonce 固化 operator/scope/workspace、一次性且超时失效。

历史确认卡在发出正文前显示标题、session ID、workspace、更新时间、回填数量、当前 scope 与替换/
迁移信息。私聊授权用户可绑定；member 只能绑定自己的 scope；共享 group/topic 与跨 scope 独占迁移
仅 profile 管理员。确认时 store 在同一串行事务中比较卡片披露的 owner 并复核迁移授权；迁移成功后
清除旧 scope 的 `SessionStore` 兼容 binding，启动恢复也会清除重复旧映射。历史只投影
user/assistant，tool/thinking 默认不展开。实时 assistant chunk 节流更新
同一 bot-owned 卡，未终态正文/卡 ID 持久化以便重启后继续原位完成；更新失败追加新卡。飞书原消息不编辑，飞书 prompt 依靠 `rpcId` /
message identity 抑制回显；没有可信 provenance 时只标记“其他 DSH 客户端”，不猜测 WebUI/TUI。

usage 可用性：SDK `assistant/message.usage` 是每次模型调用的 disjoint input/output/cache 计数；
ACP `PromptResponse.usage` 提供该 ACP session 的累计 input/output/cache，`session/update` 的
`usage_update` 提供 context `used/size`。ACP bridge runtime 当前每次 run 创建新 ACP session，
因此该累计值作为一次真实 usage 样本归入 scope + workspace session。headless/web 未提供的字段不产生事件。

## 4. 卡片与展示 · Cards & rendering

- `src/card/i18n.ts`：`localizedCard({ zhCn, enUs, config? })` 生成 schema 2.0 默认中文 body/header，
  设置 `config.locales/use_custom_translation`，并把 `zh_cn`、`en_us` 写入各文本组件的 `i18n_content`；`config.summary.i18n_content` 同步双语
  消息预览。模块递归提取 button callback value 并要求两种语言严格相同，否则 fail closed。
  `bilingualMarkdown(zhCn,enUs)` 用于服务端无法获得每位读者 locale 的 Markdown/toast/旧客户端降级。
  variant 只翻译 bot 固定文案，agent 回答、推理、工具参数/结果、用户问题与 option 原文不改写。

- `src/card/run-renderer.ts`：`renderCard(state, density)`，三档 `compact / standard / detailed`；
  reasoning、工具调用与结果位于 schema 2.0 `collapsible_panel`，运行时展开、结束后默认收起；
  detailed 含工具输入输出与 token usage。面板外的 notation 过程快照持续保留最新推理尾部、最近
  工具与结果；若平台拒绝 `collapsible_panel`，run-flow / guardian 会重试无该组件的 legacy 流式卡。
  `config.summary` 另同步截断轨迹供消息预览使用；正常卡片正文不承载最终回答。
- `src/card/run-state.ts`：`reduce(state, event)` 状态机；`usage` 字段由 `usage` 事件更新；
  `finalDeliveryError` 记录独立最终消息的发送失败并在过程卡显式展示。
- `src/card/status-card.ts`：纯 `renderStatusCard(input)` / `statusCardMarkdown(input)`；展示
  workspace/cwd、有效模型、session、当前 workspace runs、版本、context used/limit/percentage、累计四类 token
  与工具权限策略、待审批/提问/计划数、持久任务账本统计。refresh value 固化 scope/isolation；`src/bridge/channel.ts` 复用 member
  owner 授权后调用 `LarkChannel.updateCard(messageId, card)` 原位更新；启用 store 时还显示通知偏好与
  回复合并/间隔/批量/近似去重策略。Card JSON 2.0 发送被拒绝时
  `/status` 回退等价 Markdown；未知值显示“暂无”。
- `src/card/approval-card.ts`：`renderApprovalCard(input)`（allow-once / reject-once 按钮）。
- `src/card/question-card.ts`：`renderQuestionCard(input)`（单选 / 多选 / 自由文本）与
  `extractQuestionAnswer(kind, value, options)`。
- `src/card/plan-approval-card.ts`：`renderPlanApprovalCard(input)`（可选 feedback + approve / revise）。
- `src/card/density.ts`：`CardDensity` 与 `parseCardDensity`。
- `src/bot/density-store.ts`：per-scope 卡片密度覆盖；`/density` 命令读写。
- `src/bot/approvals.ts`：`ApprovalRegistry`，pending 审批按 immutable scope + owner session +
  request id 注册；单卡失败、run 结束与 callback abort 只取消对应 id/session。
- `src/bot/questions.ts`：`QuestionRegistry`，`/ask` / `lark_ask_user` 问答卡注册、card messageId 反向索引与答案结算；runtime 问题携带 sessionId，完成/失败只清理所属 session 或单个 id。
- `src/bot/plan-approvals.ts`：`PlanApprovalRegistry`，计划门禁按 immutable scope + session 注册、决策与精确取消。

计划、审批与问答卡均为内联 schema 2.0 卡片，不依赖 `card_id` 更新。`cardAction` 成功结算
对应 registry 后返回原生 toast、发送终态 Markdown 确认，并通过
`LarkChannel.recallMessage(messageId)` 撤回原卡；确认消息回复原 `messageId` 并保留话题上下文。
toast 在网络收尾前立即返回，发送与撤回则是独立的 best-effort 异步收尾，失败只写
`plan-confirm-failed` / `plan-recall-failed` / `approval-confirm-failed` / `approval-recall-failed` / `question-confirm-failed` /
`question-recall-failed` 日志，不改变已结算的审批结果或答案（issue #48）。

问答卡 `sendCard` 返回 messageId 后调用 `QuestionRegistry.bindMessage(scope,id,messageId)`；普通消息的
`replyToMessageId` 命中 pending 卡时，bridge 在命令/任务队列之前把非空 text/post 正文作为字符串答案。
该路径不把单选/多选文字强制映射回选项，因而可表达补充说明；未明确回复 pending 卡的消息绝不被吞。
群聊 channel 底层允许事件进入 bridge 后再执行 mention gate：普通消息仍要求 @（`groupNoAt` 除外），
只有 pending-card reply 免 @；topic scope 必须匹配 thread，member scope 必须匹配 sender open_id，拒绝路径不结算也不入队。

`src/notify/plan-tool.ts` 注册 `lark_request_plan_approval` raw-schema dsh 工具，并通过
`tools/pre-execute` 强制拒绝当前 turn 尚未批准的写入、删除、移动、命令执行与 `run_code`；通过 token 鉴权的
`POST /plan` 回调，以 session id 反查 scope。`buildPlanHandler` 先发送完整 Markdown 计划，再注册并
发送决策卡；返回 `{decision:'approved'|'revise', feedback?}` 后原 tool call 结束，agent 自动续跑。
SDK / ACP managed runtime 与宿主 bundle 均装配 `./plan` export；等待期间与问答卡一样暂停 idle watchdog。

`src/bridge/run-flow.ts` 将事件持续归约到上述过程卡；单次卡片 update 失败不会中断事件消费或最终
回答，原生折叠卡初始发送失败则重试 `renderLegacyCard`。正常结束且回答非空时，再通过
`sendMarkdown(chatId, assistantOutput, replyOptions)` 发送独立最终回答，继承原消息的 reply/thread
路由。发送失败不会丢失已记录的 exchange，过程卡会写明失败原因并回填完整回答正文；中断、超时和
agent 错误不会发送不完整的最终回答。

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
- `dsh-lark-bot/file`：`lark_send_file` 工具（见 §9），配置缺省时读取
  `DSH_LARK_FILE_URL` / `DSH_LARK_NOTIFY_TOKEN`；目标由 native session 固定到原会话。
- `dsh-lark-bot/ask`：`lark_ask_user` 工具（见 §9），agent 需要用户拍板 / 补充信息时
  通过问答卡向飞书会话提问并等待答案，配置缺省时读取 `DSH_LARK_ASK_URL` /
  `DSH_LARK_NOTIFY_TOKEN` 环境变量。
- `dsh-lark-bot/plan`：`lark_request_plan_approval` 工具（见 §9），完整计划消息 + 决策卡，
  配置缺省时读取 `DSH_LARK_PLAN_URL` / `DSH_LARK_NOTIFY_TOKEN`。
- `dsh-lark-bot/approval`：高风险 `tools/pre-execute` 强制门禁 + dsh rc.8 `approval/request` terminal answerer，配置缺省时读取
  `DSH_LARK_APPROVAL_URL` / `DSH_LARK_NOTIFY_TOKEN`；默认 SDK 与 host bundle 装配，ACP 不重复装配。

桥接引擎始终由 dsh 宿主进程内的插件运行，不存在第二套 bridge runtime。可选 `service` 命令只把
标准 dsh profile 交给 OS 用户服务托管；默认安装的「安全网守护」（见 §10）则独立于 dsh / Cordis
常驻，仅在 dsh 下线后接管飞书通道。桥接引擎
启动后开始向 `profiles/<bridge-profile>/guardian/heartbeat.json` 写心跳，引擎停止时停止心跳。

## 8. CLI · Command line

当前命令（唯一用户路径 = `setup`）：

- `dsh-lark-bot setup --profile <name>`：唯一安装-部署命令——定位 dsh、预批准 pnpm 构建策略、
  执行标准 `dsh plugin --profile <name> add dsh-lark-bot`，并打印下一步
  （`dsh --profile <name>`）。默认 profile 名 `dsh-lark`。
- `dsh-lark-bot upgrade [--profile <name>] [--check] [--yes] [--no-guardian] [--restart]
  [--rollback] [--force] [--package <spec>]`：一行命令彻底升级（issue #10）——检测已装 /
  运行中 CLI / npm 最新版本 → `dsh plugin add <name>@<latest>` 升级包本体 → **修复
  `dsh-lark-sdk` / `dsh-lark-acp` runtime profile 的 own-package 链接并重装陈旧的
  SDK server / ACP 依赖** → 幂等重装并
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
- `dsh-lark-bot service install|start|status|restart|stop|uninstall [--profile <name>]`：管理正常
  dsh profile 的用户级后台服务。Linux 为 systemd user unit（不可用时 XDG supervisor），macOS
  为 LaunchAgent，Windows 为登录计划任务；异常退出自动重启，stop 不删除开机入口，uninstall
  删除入口与私有 env 快照，但保留 profile 数据和日志。
- `service/<profile>.intent.json`（0600）保存 `running|stopped` 运维意图；guardian 尊重 stopped，
  uninstall 后也不会 detached 回拉。mutation 使用 profile 级原子目录锁；install/start 在 OS
  service 未运行但发现同 profile 前台进程时 fail closed，要求先停止前台实例。
- `dsh-lark-bot service logs [--profile <name>] [-n <count>] [-f]`：读取 / 跟随
  `profiles/<profile>/logs/service.log`。服务元数据与环境分别为 `service/<profile>.json`、`.env`
  （POSIX 0600；Windows 以 owner-only ACL 收紧）；环境仅快照 `DSH_LARK_*`、PATH/HOME/DSH_HOME、DeepSeek key 与 provider 实际引用键。
- `dsh-lark-bot bot add <name> [--app-id/--app-secret] [--tenant] [--workspace] [--model]`：
  安装独立 `dsh-lark-<name>` bundle profile、创建/保存同名 bridge profile、写 fleet row，并只启动
  该实例的 OS 用户服务；任一步启动失败会卸载部分 service、删除 fleet row 与配置凭据。附加实例
  支持 `sdk` / `acp` / `headless`，但 fail closed 拒绝共享广播流、无法隔离 session 的 `web` adapter。
- `dsh-lark-bot bot list|status <name>|remove <name>`：查看 fleet/service/model 或移除单个实例；
  remove 先卸载 service/env snapshot，再删除该 profile 的配置凭据/fleet row，保留
  `profiles/<name>/` 会话、worktree、archive 与日志；`default` 主机器人不可由 fleet remove，
  必须使用标准 service/plugin 生命周期，避免附加实例管理误伤既有机器人。

飞书会话内支持：`/new`、`/reset`、`/cd`、`/ws list|save|use|remove`、`/status`（可刷新状态卡）、`/doctor`（管理员脱敏诊断文件）、`/resume`、
`/stop`、`/timeout`、`/concurrency`、`/permission [ask|allow|deny] [scope]`、`/notifications [show|off|on …]`、`/replies [show|default|set …]`、`/isolation [group|topic|member]`、`/role list|show|set|clear|save|remove`、`/retention`、
`/archive [note|send <archiveId> [scope|chatId]|list [N]|clean]`、`/density`、
`/mode [quick|balanced|deep]`（兼容 `/effort`）、
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
- `./file`（`src/notify/file-tool.ts`）：`lark-file` 结果文件工具插件（见 §9）。
- `./ask`（`src/notify/ask-tool.ts`）：`lark-ask` 问答卡工具插件（见 §9）。
- `./plan`（`src/notify/plan-tool.ts`）：`lark-plan-approval` 计划门禁工具插件（见 §9）。
- `./approval`（`src/notify/approval-answerer.ts`）：`lark-approval-answerer` 一次性审批应答器（见 §9）。

`dsh plugin --profile <name> add dsh-lark-bot`（或一行 `dsh-lark-bot setup`）后，profile 的
`dsh.profile.bundles` 会追加 `dsh-lark-bot`，启动时应用 `cordis.patch.yml` 层（
`dsh-lark-bot/plugin` + `lark-notify` + `lark-file` + `lark-plan-approval` + `lark-approval-answerer`）。

## 9. 桥接层 · Bridge

- `src/bridge/channel.ts`：`startChannel(deps)` 建立飞书长连接，路由 `message` / `cardAction`
  事件，处理 `stop` / `approve` / `question-submit` 卡片按钮；bot sender 只有在 fleet identity
  唯一、enabled、真实 @ 当前 bot 时进入任务管线，且跳过 slash-command dispatch。
- `src/bridge/run-flow.ts`：`runAgentBatch(input)` 单次 agent 运行（worktree 确保、事件消费、
  超时看门狗、审批/问答接线）；`approvalHandlerFor` / `questionHandlerFor` 提供卡片回调。
- `src/bridge/lark-channel.ts`：`adaptLarkChannel` 把 `LarkChannel` 适配为 `StreamingChannel`。

`src/bridge/send-options.ts` 定义出站 `SendOptions { replyTo?, mentions?, threadId? }` 与
`MentionTarget { userId, name? }`：`sendMarkdown` / `sendCard` / `streamCard` 均接受该选项，
`adaptLarkChannel` 把 `mentions` 映射为 `@larksuite/channel` 的 `SendOptions.mentions`
（自动拼接 `<at>` 提及标记），`threadId` 映射为 `replyInThread`。
`CommandChannel.sendFile(chatId,fileName,Buffer,options)` 只接受调用方已经构造的内存内容；Lark adapter
以 `{ file: { source: Buffer, fileName } }` 上传，因此 `/doctor` 不需要开放 channel 的
`allowedFileDirs`，也不会让消息参数变成本地文件读取路径。
`src/media/outbound-files.ts` 的 `prepareOutboundFile` 负责 agent 结果文件的 realpath、普通文件、
basename 与默认 20 MiB 上限校验。`src/notify/file-handler.ts` 以 native session 反查 immutable
scope/workspace 与 chat/thread，允许根由 bridge 计算为当前 workspace、该 scope 的实际执行
worktree、该 scope 归档目录和实例日志；runtime 提交的 cwd 只用于解析相对路径，不能扩大允许根。

`src/diagnostics/bundle.ts` 的 `createDiagnosticBundle(input)` 生成下载文件：环境/版本、非敏感配置
计数、当前 scope+workspace 的 model/session/run/pending/job 摘要、managed service 状态，以及
当前 bridge 进程内可识别的结构化事件（最多 64 KiB；不读取共享 dsh 宿主 stdout）；
日志投影仅保留代码内固定枚举的 category/event 与固定数值字段，并规范化时间；其他字段名和值
全部丢弃。生成等待为 15 秒；上传等待为 30 秒。channel SDK 不提供上传取消，因此上传等待超时
返回“结果未知、文件可能迟到”，不会错误建议立即重试。
它不接收消息正文或 transcript；输出前应用
`redactSecrets`、当前进程敏感环境值精确替换、home path 缩写和代码围栏中和。`/doctor` 在读取日志
之前先执行管理员鉴权，上传/生成失败时只返回通用错误，不回显底层异常。

`src/bridge/scope-directory.ts` 提供持久化 `ScopeDirectory`（`<profile>/scopes.json`）：每个
入站消息注册 scope → `{chatId, threadId, chatMode, messageId}`，其中最近的入站 messageId 是
topic 出站卡片调用 reply API 的 anchor；`resolve(scope)` / `resolveChat(chatId)` 用于跨会话出站；
`/notify <scope|chatId> <text>` 与 `/notify list` 读写该目录。
`/notifications on [current|scope|chatId] [events=…] [mentions=…] [remind=N]` 为当前 scope
显式开启提醒；当前目标允许普通用户设置，跨会话目标仅管理员；`show` / `off` 查看或关闭。
`/replies set merge=N batch=N interval=N dedupe=N` 由 profile 管理员或当前群的群主/群管理员配置当前 scope 的最终回答合并、每批任务
上限、批次最小发送间隔与同发送者近似去重窗口；`show` 对所有成员开放，`default` 恢复兼容默认。

`src/bridge/reply-dispatcher.ts` 的 `ReplyDispatcher.deliver(scope,chatId,markdown,options)` 是最终回答
交付 seam。默认直接透传；启用策略后按 scope 等待合并窗口，每条取至多 `maxBatchSize`，超出项留在
内存队列并按 `minIntervalMs` 继续发送。单项保留原 reply/thread；多项保留 thread、移除单一 reply
anchor，并在正文标出每个原 messageId。发送失败 reject 对应批次，使 run-flow 继续使用既有过程卡
失败回填；其他批次不丢失。

`src/bridge/group-message-poller.ts` 提供 opt-in `GroupMessagePoller`（issue #50）：通过飞书
`im.message.list` 对 `ScopeDirectory` 中已知的 group/topic 做增量轮询，再使用
`LarkChannel.fetchMessage` 归一化并复用实时消息处理管线。每个 chat 维护内存水位，实时事件与
轮询路径共享 message ID claim；分页按创建时间升序处理。轮询只接受进程启动后的、fresh、
未删除、非 system、非 bot 且位于显式 `allowedUsers`（以及可选 `allowedChats`）中的消息；单群
失败不阻塞其他群，处理失败不会推进该消息水位。`doctor` 在功能开启且已有登记群时真实探测
历史 API 权限。

`src/bot/fleet-store.ts` 持久化 `fleet.json`：实例名 → bridge profile / dsh profile / 独立 DSH_HOME /
enabled / 官方 bot open_id/name。启动连接后通过 `LarkChannel.getBotIdentity()` 登记；`bot add`
等待该 identity ready 后才成功，重复 open_id 会记录启动错误、断开并回滚第二实例。
读 peer 时每次 reload；写入用原子 owner 目录与唯一 token 子文件串行化，心跳续租，dead-owner / 遗弃
lease 可回收。释放与回收只删除精确 token 后对空目录执行 `rmdir`，不会误删替代 owner；JSON 仍以
0600 atomic rename 提交。
`src/bot/handoff-guard.ts` 持久化 `handoffs.json`，对 chat 的可信 bot messageId 去重并精确统计全
fleet 连续交接；真人消息在 mention gate 前清零。到上限后只发送一次终态提示并 fail closed。
`run-flow` 将 peer name/displayName/open_id 作为独立协作 preamble 注入（因此这些标识会随每轮
任务上下文发送给模型 provider），要求 agent 仅按明确请求
使用 `lark_notify` + 精确 `mention_user_ids` 交接。member isolation 下的 bot handoff 降为该实例的
topic/group scope，避免无人能操作 bot-owned 审批/问答卡。

`src/notify/server.ts` 提供 `NotifyServer`：127.0.0.1 回环 HTTP 服务，`POST /notify` 以
`token` 鉴权，解析 scope/chat 后调用注入的 `send(destination, {text, mentions})`；token 由
`generateNotifyToken()` 每启动生成，不落盘、不进日志。`src/notify/tool.ts` 是 cordis 插件
（`dsh-lark-bot/notify`，`inject: ['tools']`）：注册 dsh 工具 `lark_notify`
（`text` / `scope` / `chat_id` / `mention_user_ids`），把请求 POST 回 bridge 的
`DSH_LARK_NOTIFY_URL`（token 取 `DSH_LARK_NOTIFY_TOKEN`）。

同一服务器还提供 `POST /file`（`server.fileUrl` / `DSH_LARK_FILE_URL`）：请求携带
`sessionId`、`path`、可选 `runtimeCwd` / `fileName`；`buildFileHandler` 完成 session 归属、路径与
大小校验后，通过 `sendFile` 上传到原 chat/thread。`src/notify/file-tool.ts` 注册 raw-schema
`lark_send_file`，从 `exec.agent.session.id` 获取当前 session，不能由模型指定目标会话。

同一服务器还提供 `POST /ask`（`server.askUrl`，桥接进程写 `DSH_LARK_ASK_URL`）：
`src/notify/ask-handler.ts` 的 `buildAskHandler` 按 `sessionId` 反查 scope（
`SessionStore.scopeForSession`）并解析到 chat/thread，用现有
`QuestionRegistry` + `renderQuestionCard` 发送问答卡，绑定发送后的 messageId，等待卡片提交或
用户直接回复该卡输入文字后把答案返回；topic 卡使用 scope directory 保存的最近入站 messageId
作为 `replyTo` anchor，确保卡片实际创建在原 thread 内
给 runtime。`src/notify/ask-tool.ts` 是 cordis 插件（`dsh-lark-bot/ask`，
`inject: ['tools']`）：注册 dsh 工具 `lark_ask_user`（`question` / `kind` /
`options` / `header`，`timeoutMs` 10 分钟），执行时以 `exec.agent.session.id`
定位会话并 POST 到 `DSH_LARK_ASK_URL` 阻塞等待答案；答案作为普通工具结果
回到 agent 循环。问答卡按 native session 归属；等待期间仅暂停所属 run 的超时看门狗，run 结束
调用 `settleSession`，单卡发送失败调用 `cancel(scope,id)`，不会取消同 scope 的并发问题；用户答完卡后重新计时。

同一服务器还提供 `POST /plan`（`server.planUrl` / `DSH_LARK_PLAN_URL`）。
`buildPlanHandler` 以 session id 定位当前 scope，先发完整 Markdown 计划，再以
`PlanApprovalRegistry` + `renderPlanApprovalCard` 等待批准 / 继续规划和可选 feedback。
`src/notify/plan-tool.ts` 注册 `lark_request_plan_approval`（无固定 tool timeout，生命周期服从当前
run 的 AbortSignal）；决策作为工具结果返回同一 agent turn。pending plan 与 question 都会暂停 run
idle watchdog；plan 按 session 计数/结算，callback 断开或 run 结束只取消对应 session，并终态提示、撤回失效卡。

同一服务器的 `POST /approval`（`server.approvalUrl` / `DSH_LARK_APPROVAL_URL`）接受
`sessionId`、`toolName`、可选 `callId` / `reason` / `toolInput`；`buildApprovalHandler` 反查 scope 与 topic anchor，
注册固定 allow-once/reject-once 选项并等待按钮。answerer 返回官方 outcome；`rejected` 不抛异常，
agent 可把它作为工具结果继续。可取得的 `tool_use` input 按 session+callId 关联进卡片；官方 request
未重复参数时仍显示 call id 并指向运行卡。HTTP 断连返回 cancelled，不遗留 pending；允许不写入规则或 grant store。

SDK / ACP runtime profile（`src/adapters/dsh/sdk-runtime.ts` / `acp-runtime.ts`）会在
`cordis.patch.yml` 插入 `lark-notify` 行，并把当前 bridge 包以 `link:` 依赖加入 profile，
同时插入 `lark-file`、`lark-ask` 与 `lark-plan-approval` 行，因此四个 bridge 工具在 `sdk` 与 `acp` 两种
adapter 下都自动可用；SDK 另插入 approval answerer，宿主 bundle 也插入 plan + approval 供 Web agent
使用。ACP 继续由原生 permission bridge 应答，避免重复 answerer（`headless` 无工具回调）。

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
   无进程，连续 `takeoverGracePolls` 次）→ 守护先**自动重启完整 profile**
   （已安装正常引擎 service 时通过对应 controller restart；显式 stop/uninstall intent 会抑制
   自动拉起；从未安装 service 时才 `node <dsh-bin> --profile <name>` detached，spawn 前二次
   进程探测防双实例；`relaunchCooldownMs` 冷却默认 60s），并在
   `relaunchReadyTimeoutMs` 就绪窗口（默认 15s）内等待桥接心跳 /
   进程恢复：就绪则回到 standby，超时则记录失败并**接管**飞书长连接（用桥接 profile 的
   凭据 / 白名单创建 `@larksuite/channel`）；只有 admin（无 admin 时回退 allowedUsers）
   可触发控制命令。
3. **safe**：`/safemode` 通过安全 profile 探测后，以 `DshAdapter`（`dsh --profile <safe>
   "<prompt>"`，headless 回退）或 `SdkDshAdapter`（`dsh-lark-safe-sdk`，默认优先）逐条执行对话；
   SDK 模式以原生 `session(id)` 续跑，headless 模式把历史上下文拼接进 prompt（每 scope 上限
   30 条）。任务期间守护通过 `streamCard` + `renderCard` / `RunState` 在原生折叠面板实时展示
   思考 / 工具，正常完成后另发最终 Markdown（含已运行秒数、无响应提示、⏹ 终止按钮），并受
   `DSH_LARK_GUARDIAN_SAFE_TIMEOUT_MS` 空闲看门狗约束（任务持续无活动事件才调用
   `run.stop()` 并渲染超时卡，活跃任务不会被误杀）；
   同一 scope 同时只允许一个安全任务，忙碌时新消息立即回执；“/safemode stop”与卡片按钮均可
   终止当前任务。`/safemode plugins` 执行 `dsh plugin --profile <name> list`；
   `/safemode exit` 复用同一“受管 service 优先、否则 detached”恢复入口（同样纳入就绪窗口与冷却）；
   若 stopped intent 抑制或重启失败则明确提示并保持 safe，成功时才短暂延迟、断开飞书连接并回到 standby。

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
