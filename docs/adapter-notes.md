# dsh Adapter 接入说明 · Adapter Notes

> 本文档告诉接手工程师：**在哪里、按什么接口、把 DeepSeek Harness（`dsh`）作为 agent 后端插进桥接层**。所有路径均相对仓库根目录，参考源码见 `reference/`（已 clone，不提交）。
> This document tells the engineer **where and how to plug DeepSeek Harness (`dsh`) into the bridge as the agent backend**. Paths are relative to the repo root; reference sources live under `reference/` (cloned, not committed).

---

## 1. 核心结论 · TL;DR

- 桥接层的 agent 后端是**抽象接口 `AgentAdapter`**，新增一个 `dsh` adapter 即可，飞书层完全不用动。
- 落点：新建 `src/agent/dsh/`，并在 `src/agent/index.ts` 注册导出。
- **两条接入路线**：dsh 的 **ACP 服务器**（推荐）或 **SDK client**（`@deepseek-ai/dsh-sdk-client`）。
- **关键差异**：dsh 走 ACP/SDK 只吐「已提交的最终文本」（committed answers），**不是** claude/codex 那种 token 级流式 stdout——所以「流式卡片」体验要重新设计（卡片最后一次性更新，或用事件流分段）。

---

## 2. 桥接层 adapter 接口 · The AgentAdapter Contract

定义在 [`../reference/lark-coding-agent-bridge/src/agent/types.ts`](../reference/lark-coding-agent-bridge/src/agent/types.ts)，摘要如下：

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

| 操作 | 路径 | 说明 |
| :--- | :--- | :--- |
| 新增 | `src/agent/dsh/adapter.ts` | `DshAdapter` 实现（核心） |
| 新增 | `src/agent/dsh/*.ts` | dsh 输出 → AgentEvent 的翻译器、argv 等 |
| 修改 | `src/agent/index.ts` | `export { DshAdapter } from './dsh/adapter'` |
| 修改 | 注册处 | 把 `agentKind: 'dsh'` 接入 CLI `--agent dsh`、profile、availability 检查 |

参考实现（**照抄结构**）：[`../reference/lark-coding-agent-bridge/src/agent/codex/adapter.ts`](../reference/lark-coding-agent-bridge/src/agent/codex/adapter.ts)（spawn 子进程 → JSONL 翻译成事件流），[`claude/adapter.ts`](../reference/lark-coding-agent-bridge/src/agent/claude/adapter.ts)（同理）。

---

## 4. dsh 接入路线 · Integration Routes

### 路线 A：ACP 服务器（推荐）

- 包：`@deepseek-ai/dsh-acp`，源码 [`../reference/deepseek-harness/packages/acp/acp/`](../reference/deepseek-harness/packages/acp/acp/)
- 本质：**"Automation-only Agent Client Protocol server over JSON-RPC stdio"**。`apply(ctx, config)` 在 stdin/stdout 上开一个 `AgentSideConnection`，驱动 `ctx.agents`。
- 协议方法：`initialize` / `authenticate` / `session/new` / `session/prompt` / `session/cancel` / `session/update`（发 `agent_message_chunk`）/ `session/request_permission`（一次性 allow/reject）。
- 运行：`pnpm --dir <deepseek-harness> run demo:acp`（需要 `DEEPSEEK_API_KEY`）。
- 适配思路：dsh adapter spawn `dsh`（ACP composition），通过 stdio JSON-RPC 对话，把 `session/update` 的 `agent_message_chunk` 和 `session/request_permission` 翻译成 `AgentEvent`。

**ACP 已知限制（来自其 README）**：
- **仅全新会话**——load / list / resume / delete / fork 均不支持。
- **仅 committed 答案**——实时进度、reasoning、工具活动、usage 不上线。
- **单一工作区**——images / audio / 多目录 / MCP 会被拒绝。

### 路线 B：SDK client

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
- 适配思路：dsh adapter 用 `DeepSeekHarness`/`HarnessClient` spawn dsh 子进程，把 `finalResponse` + `events`/`notifications` 映射成 `AgentEvent`。

**SDK 已知限制**：无 mid-turn cancel；`prompt()` 只返回入队回执；弃用一次 turn 需关闭整个 runtime。

---

## 5. 关键差异与坑 · Key Differences & Pitfalls

1. **无 token 级流式**：claude/codex 的 stdout 是 stream-json 逐 token 吐 `text` delta；dsh（ACP/SDK）只给「已提交的最终文本」。因此 `text` 增量事件会变成「最终一次性」或按 `agent_message_chunk` 分段，流式卡片的视觉效果要相应降级。
2. **会话续跑**：dsh 的 ACP 不支持 resume（仅全新会话）；要续跑得走 SDK 的 `session(id?)` 或 harness 的 session log（fork/resume 在 dsh 内部支持，但 ACP 未暴露）。这直接影响桥接层的 `/resume` 命令。
3. **审批**：ACP 有 `session/request_permission`（一次性 allow/reject），可映射到飞书卡片审批；SDK 的 client→server 通知/审批流「未实现」。
4. **dsh 是 developer preview**：接口会破坏性变更，务必把 `DshAdapter` 与桥接核心隔离（改 dsh 只动 `src/agent/dsh/`）。
5. **Node 版本**：dsh 要求 `node ^22.19 || >=24`；桥接层要求 `>=20.12`。统一用 ≥22.19。

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
