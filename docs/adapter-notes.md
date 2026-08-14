# dsh Adapter 接入说明 · Adapter Notes

> 本文档告诉接手工程师：**在哪里、按什么接口、把 DeepSeek Harness（`dsh`）作为 agent 后端插进桥接层**。所有路径均相对仓库根目录，参考源码见 `reference/`（已 clone，不提交）。
> This document tells the engineer **where and how to plug DeepSeek Harness (`dsh`) into the bridge as the agent backend**. Paths are relative to the repo root; reference sources live under `reference/` (cloned, not committed).

---

## 1. 核心结论 · TL;DR

- 桥接层的 agent 后端是**抽象接口 `AgentAdapter`**，dsh adapter 已落地在 `src/adapters/dsh/`。
- **两条官方接入路线均已实测**（2026-08-14）：
  - **SDK client**（`@deepseek-ai/dsh-sdk-client`，默认）：驱动 `dsh-sdk-jsonrpc-server`
    runtime，原生 `session(id)` 续跑；`assistant/chunk` 提供
    **reasoning-delta / text-delta token 级流式**，支持 thinking 展示与 typewriter 卡片。
  - **ACP 服务器**（`@deepseek-ai/dsh-acp`）：`session/request_permission` → 飞书审批卡；
    ACP 仅吐 committed 文本块（逐 assistant/message 一次一块），会话为全新会话。
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

```ts
type AgentEvent =
  | { type: 'system'; sessionId?; threadId?; cwd?; model? }
  | { type: 'text'; delta: string }                 // 流式文本增量
  | { type: 'final_text'; content: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_use'; id; name; input }           // 工具调用开始
  | { type: 'tool_result'; id; output; isError }
  | { type: 'usage'; inputTokens?; outputTokens?; ... }
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
| `src/adapters/dsh/sdk-runtime.ts` | `ensureSdkProfile` / `resolveSdkLaunch`（`dsh-lark` profile） |
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

**SDK 已知限制**：无 mid-turn cancel（`/stop` 会关闭整个 runtime，重启用时自动拉起）；
approval 流未实现（需 ACP 模式）。

### 路线 B：ACP 服务器（审批）

- 包：`@deepseek-ai/dsh-acp`，源码 [`../reference/deepseek-harness/packages/acp/acp/`](../reference/deepseek-harness/packages/acp/acp/)
- 本质：**"Automation-only Agent Client Protocol server over JSON-RPC stdio"**。`apply(ctx, config)` 在 stdin/stdout 上开一个 `AgentSideConnection`，驱动 `ctx.agents`。
- 协议方法：`initialize` / `authenticate` / `session/new` / `session/prompt` / `session/cancel` / `session/update`（发 `agent_message_chunk`）/ `session/request_permission`（一次性 allow/reject）。
- 运行：`pnpm --dir <deepseek-harness> run demo:acp`（需要 `DEEPSEEK_API_KEY`）。
- 适配思路：dsh adapter spawn `dsh`（ACP composition），通过 stdio JSON-RPC 对话，把 `session/update` 的 `agent_message_chunk` 和 `session/request_permission` 翻译成 `AgentEvent`。

**ACP 已知限制（来自其 README）**：
- **仅全新会话**——load / list / resume / delete / fork 均不支持。
- **仅 committed 答案**——实时进度、reasoning、工具活动、usage 不上线。
- **单一工作区**——images / audio / 多目录 / MCP 会被拒绝。

### 路线 C：headless（legacy）

- 现有 `DshAdapter`（`src/adapters/dsh/adapter.ts`）保留，`DSH_LARK_ADAPTER=headless` 使用。

## 4.1 Runtime profile（自动维护）

SDK / ACP 模式需要对应 runtime profile：

| 模式 | profile | 组合 |
| --- | --- | --- |
| sdk | `~/.dsh/profiles/dsh-lark` | bundle `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-sdk-jsonrpc-server` overlay |
| acp | `~/.dsh/profiles/dsh-lark-acp` | bundle `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-acp` overlay |

`ensureSdkProfile` / `ensureAcpProfile`（`src/adapters/dsh/sdk-runtime.ts` /
`src/adapters/dsh/acp-runtime.ts`）在首次启动时创建 profile 并 `pnpm install` 插件，幂等且可自愈
（部分创建状态也会补齐）。stdout 保留给 JSON-RPC 协议；overlay 禁用了 `user-questions`
（IM 无法回达的交互工具默认拒绝）与 HMR。

---

## 5. 关键差异与坑 · Key Differences & Pitfalls

1. **流式差异**：SDK 有 token 级流式（`assistant/chunk` 的 `reasoning-delta` / `text-delta`）；
   ACP 按 committed 文本块发 `agent_message_chunk`。两种都走 `AgentEvent` 事件流渲染卡片。
2. **会话续跑**：SDK 用 `session(id?)` + JSONL 持久化实现原生 resume；ACP 仅全新会话。
3. **审批**：ACP 的 `session/request_permission`（一次性 allow/reject）映射飞书审批卡
   （`src/card/approval-card.ts` + `src/bot/approvals.ts`，run 结束时结算所有挂起审批）；
   SDK 协议未实现审批流。
4. **dsh 是 developer preview**：接口会破坏性变更，dsh 相关代码全部隔离在 `src/adapters/dsh/`。
5. **Node 版本**：dsh 要求 `node ^22.19 || >=24`；桥接层 `package.json` engines 为 `>=22.19`。统一用 ≥22.19。
6. **dsh-type-meta 404 已解除**：rc.1/rc.6 依赖链全部发布，官方 SDK/ACP 现可直接安装。

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
