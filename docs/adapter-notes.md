# dsh Adapter 接入说明 · Adapter Notes

> 本文档告诉接手工程师：**在哪里、按什么接口、把 DeepSeek Harness（`dsh`）作为 agent 后端插进桥接层**。所有路径均相对仓库根目录，参考源码见 `reference/`（已 clone，不提交）。
> This document tells the engineer **where and how to plug DeepSeek Harness (`dsh`) into the bridge as the agent backend**. Paths are relative to the repo root; reference sources live under `reference/` (cloned, not committed).

---

## 1. 核心结论 · TL;DR

- 桥接层的 agent 后端是**抽象接口 `AgentAdapter`**，dsh adapter 已落地在 `src/adapters/dsh/`。
- **两条官方接入路线均已实测**（2026-08-20 最后验证）：
  - **SDK client**（`@deepseek-ai/dsh-sdk-client`，默认）：驱动 `dsh-sdk-jsonrpc-server`
    runtime，原生 `session(id)` 续跑；`assistant/chunk` 提供
    **reasoning-delta / text-delta token 级事件**；thinking / tools 实时进入折叠过程卡，聚合后的
    final text 作为独立 Markdown 回答发送；`assistant/message.usage` 提供 input/output/cache usage。
  - **ACP 服务器**（`@deepseek-ai/dsh-acp`）：`session/request_permission` → 飞书审批卡；
    ACP 仅吐 committed 文本块（逐 assistant/message 一次一块），会话为全新会话；rc.8
    `PromptResponse.usage` 与 `usage_update` 分别提供累计 token 和 context used/size。
- 旧的 **headless 子进程 fallback** 保留为 `DSH_LARK_ADAPTER=headless`，不再默认。

---

## 2. 桥接层 adapter 接口 · The AgentAdapter Contract

> 下方是**参考仓库** `lark-coding-agent-bridge` 的契约（摘要），本项目实际契约见
> `src/adapters/types.ts`：`AgentAdapter` 要求 `checkAvailability()`，可带 `dispose?()`；
> `AgentRunOptions` 增加 `onApprovalRequest?`；`AgentEvent` 已加入 `thinking` / `usage` 事件。
> 参考实现见 [`../reference/lark-coding-agent-bridge/src/agent/types.ts`](../reference/lark-coding-agent-bridge/src/agent/types.ts)。

```ts
export interface AgentAdapter {
  readonly id: string;            // e.g. 'dsh'
  readonly displayName: string;   // e.g. 'DeepSeek Harness'
  isAvailable(): Promise<boolean>;
  checkAvailability?(): Promise<AgentAvailability>;
  prepareRun?(opts: AgentRunOptions): Promise<void>;
  run(opts: AgentRunOptions): AgentRun;
  setBotIdentity?(identity: AgentBotIdentity): void;
}

export interface AgentRunOptions {
  runId: string;
  prompt: string;
  cwd?: string;
  sessionId?: string;
  threadId?: string;
  model?: string;
  images?: readonly string[];
  sandbox?: CodexSandboxMode;
  permissionMode?: ClaudePermissionMode;
  stopGraceMs?: number;
}

export interface AgentRun {
  readonly runId: string;
  readonly events: AsyncIterable<AgentEvent>;   // 事件流，飞书层据此渲染卡片
  stop(): Promise<void>;
  waitForExit(timeoutMs: number): Promise<boolean>;
}
```

**`AgentEvent` 是飞书层的渲染契约**（流式卡片靠它），关键类型：

渲染完成后由 `src/card/i18n.ts` 在卡片 seam 组合 `zh_cn` / `en_us` 两套固定 UI chrome；同一份
`AgentEvent` 动态正文原样进入两套 variant，因此 adapter 不负责翻译，也不接触用户 locale。

```ts
type AgentEvent =
  | { type: 'system'; sessionId?; threadId?; cwd?; model? }
  | { type: 'text'; delta: string }                 // 流式文本增量
  | { type: 'final_text'; content: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_use'; id; name; input }           // 工具调用开始
  | { type: 'tool_result'; id; output; isError }
  | { type: 'usage'; inputTokens?; outputTokens?; cacheReadTokens?; cacheWriteTokens?; ... }
  | { type: 'context_usage'; usedTokens; contextWindow }
  | { type: 'done'; sessionId?; threadId?; terminationReason }
  | { type: 'error'; message; terminationReason };
```

**dsh adapter 的职责**：把 dsh 的输出翻译成上面的 `AgentEvent` 序列。

---

## 3. 要改 / 新增的文件 · Files to Touch

已落地文件（均为本次接入的实际路径）：

| 路径 | 说明 |
| :--- | :--- |
| `src/adapters/types.ts` | `AgentAdapter` / `AgentRun` / `AgentEvent` / 审批类型契约 |
| `src/adapters/index.ts` | `buildAgentAdapter(env, prefs)` 按 `DSH_LARK_ADAPTER` 构建 |
| `src/adapters/dsh/sdk-adapter.ts` | `SdkDshAdapter`（默认）：`DeepSeekHarness` runtime 池 |
| `src/adapters/dsh/sdk-translate.ts` | SDK `session.event` → `AgentEvent`（chunk 流式翻译） |
| `src/adapters/dsh/sdk-runtime.ts` | `ensureSdkProfile` / `resolveSdkLaunch`（`dsh-lark-sdk` profile） |
| `src/adapters/dsh/acp-adapter.ts` | `AcpDshAdapter`：ACP client + `session/request_permission` |
| `src/adapters/dsh/acp-runtime.ts` | `ensureAcpProfile` / `resolveAcpLaunch`（`dsh-lark-acp` profile） |
| `src/adapters/dsh/event-channel.ts` | 有序事件队列（流式事件中转） |
| `src/adapters/dsh/adapter.ts` | legacy `DshAdapter`（headless 子进程，保留兼容） |

参考实现（**照抄结构**）：[`../reference/lark-coding-agent-bridge/src/agent/codex/adapter.ts`](../reference/lark-coding-agent-bridge/src/agent/codex/adapter.ts)
（spawn 子进程 → JSONL 翻译成事件流）、[`claude/adapter.ts`](../reference/lark-coding-agent-bridge/src/agent/claude/adapter.ts)（同理）。

---

## 4. dsh 接入路线 · Integration Routes

### 路线 A：SDK client（默认）

- 包：`@deepseek-ai/dsh-sdk-client`，源码 [`../reference/deepseek-harness/packages/sdk/client/`](../reference/deepseek-harness/packages/sdk/client/)
- 高层 API `DeepSeekHarness`：
  ```ts
  await using harness = new DeepSeekHarness({
    launch: { command: 'node', args: ['lib/bin.js', 'cordis.yml'] },
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    maxTokens: 49_152,
  })
  const result = await harness.run('say hi')   // RunResult { sessionId, finalResponse, events, notifications }
  ```
- 低层 API `HarnessClient`：显式 `start()/initialize()/prompt()/request()/close()` + 通知订阅。
- 适配思路：dsh adapter 用 `DeepSeekHarness`/`HarnessClient` spawn dsh 子进程，把
  `session.event`（`assistant/chunk` 的 reasoning/text/tool 增量）+ `finalResponse` 映射成
  `AgentEvent`。

**SDK 已知限制**：无 mid-turn cancel（`/stop` 会关闭整个 runtime，重启用时自动拉起）。SDK JSON-RPC
本身没有 server→client approval RPC，但 managed profile 在 runtime 内装配 rc.8 `approval/request`
answerer + `tools/pre-execute` 强制门禁，经 bridge `/approval` 提供逐工具卡片确认，因此默认安装不再要求切换 ACP。

### 路线 B：ACP 服务器（审批）

- 包：`@deepseek-ai/dsh-acp`，源码 [`../reference/deepseek-harness/packages/acp/acp/`](../reference/deepseek-harness/packages/acp/acp/)
- 本质：**"Automation-only Agent Client Protocol server over JSON-RPC stdio"**。`apply(ctx, config)` 在 stdin/stdout 上开一个 `AgentSideConnection`，驱动 `ctx.agents`。
- 协议方法：`initialize` / `authenticate` / `session/new` / `session/prompt` / `session/cancel` / `session/update`（发 `agent_message_chunk`）/ `session/request_permission`（一次性 allow/reject）。
- 运行：`pnpm --dir <deepseek-harness> run demo:acp`（需要 `DEEPSEEK_API_KEY`）。
- 适配思路：dsh adapter spawn `dsh`（ACP composition），通过 stdio JSON-RPC 对话，把 `session/update` 的 `agent_message_chunk` 和 `session/request_permission` 翻译成 `AgentEvent`。

**ACP 已知限制（来自其 README）**：
- **仅全新会话**——load / list / resume / delete / fork 均不支持。
- **仅 committed 答案**——回答文本没有 token 级 delta；但 rc.8 的 PromptResponse 可返回
  累计 token usage，`usage_update` 可返回 context used/size，bridge 会如实转为指标事件。
- **单一工作区**——images / audio / 多目录 / MCP 会被拒绝。

### 路线 C：headless（legacy）

- 现有 `DshAdapter`（`src/adapters/dsh/adapter.ts`）保留，`DSH_LARK_ADAPTER=headless` 使用。

### 路线 D：web（本地 dsh web agent，单写者）

- `WebDshAdapter`（`src/adapters/dsh/web-adapter.ts`），`DSH_LARK_ADAPTER=web` 使用。
- 输入走 `POST /api/session.create` / `session.prompt`（本地 dsh web，默认
  `http://127.0.0.1:3080`，`DSH_LARK_WEB_URL` 可改），输出走 `/api/events.mux` WebSocket
  （SSE 会 426），翻译为既有 `AgentEvent` 词汇。
- **网页端 agent 成为唯一写者**：不再 spawn 自己的 agent runtime，多写者（bridge 子进程、
  守护重启、陈旧 live session 双写）导致的 `corrupt session log: seq gap` 从根上消失，
  旧会话天然可续接。
- `SessionProjectionBridge` 只为飞书 `/session` 明确确认的 binding 消费 `session.history` 与
  `session/event`；按持久 seq cursor 重连补齐，流式 assistant 原位更新，失败追加。WebUI/TUI
  的 open/resume/activity 不自动切换任何 scope，也不向所有 scope 广播。
- 回退：`DSH_LARK_ADAPTER=sdk`（默认）一行切回。

## 4.1 Runtime profile（自动维护）

SDK / ACP 模式需要对应 runtime profile：

| 模式 | profile | 组合 |
| --- | --- | --- |
| sdk | `~/.dsh/profiles/dsh-lark-sdk` | bundle `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-sdk-jsonrpc-server` overlay |
| acp | `~/.dsh/profiles/dsh-lark-acp` | bundle `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-acp` overlay |

`ensureSdkProfile` / `ensureAcpProfile`（`src/adapters/dsh/sdk-runtime.ts` /
`src/adapters/dsh/acp-runtime.ts`）在首次启动时创建 profile 并 `pnpm install` 插件，幂等且可自愈
（部分创建状态也会补齐）。stdout 保留给 JSON-RPC 协议；overlay 禁用了 `user-questions`
（IM 无法回达的原生 `ask_user_question` 默认拒绝）与 HMR；agent 提问改走桥接自建
`lark_ask_user` 工具（`dsh-lark-bot/ask` + bridge `POST /ask` 问答卡）与
`lark_request_plan_approval`（`dsh-lark-bot/plan` + bridge `POST /plan` 计划消息/决策卡），
SDK / ACP runtime 均自动装配；SDK 还装配 `dsh-lark-bot/approval`，ACP 则保留原生 permission bridge。
问答卡提交与直接回复卡片的自由文本共用同一 pending promise；
回复按 card messageId 定向，bridge 负责 topic/member 授权，adapter 契约无需新增事件。

---

## 5. 关键差异与坑 · Key Differences & Pitfalls

1. **流式差异**：SDK 有 token 级流式（`assistant/chunk` 的 `reasoning-delta` / `text-delta`）；
   ACP 按 committed 文本块发 `agent_message_chunk`。两种都走 `AgentEvent` 事件流渲染卡片。
2. **会话续跑**：SDK 用 `session(id?)` 在同一 runtime 内原生 resume；关闭重开后 rc.8 JSON-RPC
   server 会对同名 JSONL 日志返回 `id collision`，bridge 清除失效 binding 并用自身 transcript
   新建 session。ACP 仅全新会话。
3. **审批**：ACP 的 `session/request_permission` 与默认 SDK/Web 的 rc.8 `approval/request` answerer
   都映射一次性 allow/reject 飞书卡；registry 按 scope + owner session + request id 精确结算，
   并发 run、单卡失败与 callback abort 不会取消其他任务。
4. **dsh 是 developer preview**：接口会破坏性变更；协议 adapter 隔离在
   `src/adapters/dsh/`，宿主工具 registry 兼容 seam 隔离在 `src/notify/` 的 raw-schema 边界。
   锁定版本、升级政策与自动化探测见 [`COMPATIBILITY.md`](COMPATIBILITY.md)；
   版本常量统一取自 `src/config/dsh-compat.ts`。
5. **Node 版本**：dsh 要求 `node ^22.19 || >=24`；桥接层 `package.json` engines 为 `>=22.19`。统一用 ≥22.19。
6. **rc.8 精确锁定**：SDK client/server 与 ACP 顶层包精确 pin，本仓库 lockfile peer 图由
   pnpm override 固定为 rc.8；npm 包族的 `latest` / `next` 不同步，不能用裸 dist-tag 代替矩阵。
   托管 profile 核对顶层实际 manifest 并自动修复旧 rc.7 安装；override 不向下游传播，因此新上游
   出现后仍需重跑全新 consumer 与真实 probe。
7. **宿主注册单实例边界**：`lark_notify` / `lark_ask_user` / `lark_request_plan_approval` 使用宿主接受的 raw JSON Schema，approval answerer 使用 structural event listener；
   definition，本包不直接 import `dsh-tools`，避免 scheduler Symbol 双实例。
8. **rc.8 图片边界**：入站文件按 magic bytes 识别 PNG/JPEG/GIF/WebP；ACP 只有在 runtime 宣告
   image capability 后才发送原生 base64 block，否则显式失败。真实 rc.8 ACP 当前未宣告该能力；
   SDK wire 也没有本地原始图片 upload API，因此 SDK 明确走本地文件工具 fallback。当前 channel 尚无
   图片出站契约，ACP assistant 图片显示降级文本。详见 `DSH_RC8_AUDIT.md`。
9. **多机器人交接**：adapter 契约不增加 bot 专用事件；bridge 先验证飞书 bot sender、真实 @ 与
   fleet peer 身份，再把带来源标记的文本交给普通 run。运行 prompt 只注入登记 peer 的 name/open_id，
   agent 通过既有 `lark_notify` + `mention_user_ids` 交接；跨进程回合限制位于 bridge/bot seam，
   不污染 SDK/ACP/Web 协议层。附加实例只允许可独立装配的 SDK/ACP/headless；共享 Web mux 无法
   提供实例级 session 隔离，因此启动时 fail closed。

---

## 6. 参考源码速查 · Source Map

| 内容 | 路径 |
| :--- | :--- |
| adapter 接口定义 | `reference/lark-coding-agent-bridge/src/agent/types.ts` |
| adapter 注册 | `reference/lark-coding-agent-bridge/src/agent/index.ts` |
| codex adapter 范例 | `reference/lark-coding-agent-bridge/src/agent/codex/adapter.ts` |
| claude adapter 范例 | `reference/lark-coding-agent-bridge/src/agent/claude/adapter.ts` |
| dsh ACP 服务器 | `reference/deepseek-harness/packages/acp/acp/`（README + `src/index.ts`） |
| dsh SDK client | `reference/deepseek-harness/packages/sdk/client/`（README + `src/client.ts`） |
| dsh 架构/仓库总览 | `reference/deepseek-harness/AGENTS.md`、`docs/ARCHITECTURE.md` |
