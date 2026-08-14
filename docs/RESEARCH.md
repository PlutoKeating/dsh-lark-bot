# 调研报告 · Research Report

> 本报告记录项目立项前的完整调研结论，供接手工程师理解「为什么这样设计」。调研时间：2026-08-14。

---

## 1. DeepSeek 官方现状 · DeepSeek Official Status

| 时间 | 事件 |
| :--- | :--- |
| 2026-07-31 | **DeepSeek-V4-Flash** 推入 public beta（模型名 `deepseek-v4-flash`） |
| 2026-08-13 | **DeepSeek-V4-Pro** 正式版发布，agent 能力大幅增强，**原生支持 Responses API + Codex 集成** |
| 2026-08-13 | **DeepSeek Harness（`dsh`）** 官方开源（developer preview，MIT） |
| 2026-06 | DeepSeek 官方 Agent 桌面端上线 |

关键结论：DeepSeek **不单独出 "DeepSeek Code" CLI**，官方策略是让 V4 模型驱动现有 agent（Claude Code / GitHub Copilot / OpenCode），并发布了自己的 agent harness（`dsh`）。模型 ID：`deepseek-v4-pro[1m]`（1M 上下文）、`deepseek-v4-flash`。

## 2. DeepSeek Harness（`dsh`）· 目标后端

- **仓库**：`deepseek-ai/deepseek-harness`，MIT 协议，源码全开放。
- **核心理念**：**"Everything is a plugin"**——模型、工具、技能、会话、沙箱、存储、agent loop、调度、**连 UI 本身**都是可插拔插件。
- **底层框架**：Cordis（`cordiverse/cordis`，时空可组合插件框架）。
- **状态**：**developer preview**，README 明示 "THERE WILL BE COMPATIBILITY-BREAKING CHANGES"（兼容性破坏性变更）。
- **运行模式**：
  - `npx @deepseek-ai/dsh web` → Web UI（`http://127.0.0.1:3080`）
  - `dsh --profile headless "task"` → 一次性 runner（无服务）
  - `demo:acp` → **ACP（Agent Client Protocol）自动化服务器**（程序化驱动接口）
  - JSON-RPC SDK（`packages/sdk`）
- **关键包**（`packages/`）：`acp/`（自动化 ACP 服务器）、`sdk/`（JSON-RPC + TS client）、`api/`（Typert RPC gateway）、`interaction/`（审批 / 权限 / ask-user）、`session/`（append-only session log，可 fork/resume/回放）、`subagent/`、`sandbox/`、`workflow/`、`plan/`、`skill/`。
- **官方扩展指南**：*"Add UI or editor integration → drive `ctx.agents` and render from `session/event`"*——官方把「新接一个前端/IM 界面」当作一等公民扩展点。

## 3. lark-channel-bridge · 直接参照实现

- **仓库**：`zarazhangrui/lark-coding-agent-bridge`（npm 包 `lark-channel-bridge`），MIT，Node ≥ 20.12。
- **本质**：把飞书消息桥接到本机 Claude Code / Codex CLI 的轻量 bot。

### 3.1 三大核心机制

1. **免公网 WebSocket 长连接**——全靠 `@larksuite/channel`（封装官方 `@larksuiteoapi/node-sdk`）：出站长连接收事件、消息归一化、**流式卡片回复**、媒体上传、卡片交互。配合 **PersonalAgent 应用**（终端渲染二维码 → 飞书扫码绑定），**不需要公网服务器 / 域名 / 内网穿透**。
2. **子进程中继（`cross-spawn`）**——不调 agent 官方 SDK，而是直接 spawn `claude` / `codex` 进程、抓 stdout 流式输出（文本 + tool call）转发成飞书流式卡片。因为 claude/codex 都是「常驻交互式 REPL CLI」，可以一直开着双向流。
3. **会话 / 工作区 = 本地状态映射**——每个 chat / topic / thread / 文档评论 → 独立 session key → 独立 agent 子进程 + 独立 cwd；`/cd` 切目录、`/ws save/use` 命名工作区、`/new` 清会话、`/resume` 恢复历史；profile = 每 agent 独立凭据 / 会话 / cwd / 日志。

### 3.2 命令体系（供参考）

`/new`、`/reset`、`/cd <path>`、`/ws list/save/use/remove`、`/resume`、`/status`、`/config`、`/invite user/admin/group`、`/stop`、`/timeout [N|off|default]`、`/reconnect`、`/ps`、`/doctor`。

### 3.3 目录结构（adapter 落点）

`src/` 下含：`agent/`（agent adapter 抽象，**dsh adapter 的落点**）、`workspace/`、`session/`、`card/`、`commands/`、`config/`、`daemon/`、`lark-cli/`、`media/`、`policy/`、`runtime/` 等。

## 4. 参考项目对比 · Reference Projects

| 项目 | 定位 | star（2026-08） |
| :--- | :--- | :--- |
| **OpenCode** `opencode-ai/opencode` | 终端 agent，model-agnostic，自带 headless server（`opencode serve` :4096，OpenAPI 3.1） | ~160K |
| **cc-switch** `farion1231/cc-switch` | 跨平台多 agent/provider 一键切换（8 工具，含 Hermes） | ~112K |
| **Claude Code** `anthropics/claude-code` | Anthropic 官方 agent CLI | v2.1.x，极高 |
| **MiMo-Code** `XiaomiMiMo/MiMo-Code` | 小米终端 agent，MIT | ~11.6K |
| **lark-channel-bridge** | 飞书 ↔ Claude Code / Codex 桥接 | 参考实现 |
| **opencode-telegram-bot** `grinev/...` | OpenCode 的 Telegram 手机端 | ~1K |

## 5. 可行性结论 · Feasibility

**高可行**，且分层隔离是关键：

```
飞书 ──▶ bridge/ ──▶ session/ ──▶ workspace/ ──▶ adapters/ ──▶ dsh ──▶ DeepSeek V4
```

- **飞书层 90% 直接照搬** lark-channel-bridge 思路（长连接 + 流式卡片 + 会话路由 + 访问控制），与 agent 无关。
- **工作区管理的积木 dsh 已原生提供**（session log、subagent、sandbox、workflow、plan、skill provider），只需在飞书侧做映射和编排。
- **真正要重写的是 agent adapter 层**（见下）。

## 6. 关键差异：为什么「换 dsh」不是 1:1 替换

| | claude / codex | dsh |
| :--- | :--- | :--- |
| 形态 | 常驻交互式 REPL CLI | `web`(常驻服务) / `headless`(一次性) / `acp`(自动化服务器) / JSON-RPC |
| 会话续跑 | 子进程一直开着 | headless 无状态一次性，续跑需传 session 并 fork/resume |
| 流式输出 | stdout stream-json | append-only session event log（可回放） |

**三条 dsh adapter 路线（2026-08-14 复核后已落地）：**
- **路线 A（默认，已实现）**：官方 **SDK client**（`@deepseek-ai/dsh-sdk-client`）驱动
  `dsh-sdk-jsonrpc-server` runtime——原生 `session(id)` 续跑、`assistant/chunk` 流式
  reasoning/text 增量、工具事件、usage。
- **路线 B（审批，已实现）**：官方 **ACP server**（`@deepseek-ai/dsh-acp`），飞书 bot 当
  ACP client，`session/request_permission` 映射飞书审批卡；ACP 会话为全新会话（不支持 resume）。
- **路线 C（legacy，保留）**：headless 子进程 fallback（`DSH_LARK_ADAPTER=headless`）。

## 7. 落地建议 · Implementation Plan

1. fork `lark-coding-agent-bridge`（MIT），复用其飞书层与 adapter 抽象。
2. 新增 `agentKind: dsh` adapter，走路线 A（ACP）。
3. 工作区管理做增量：先 git worktree 隔离 + 项目级规则注入，再逐步加调度、沙箱。
4. dsh 是 day-1 preview，ACP 接口会变——**dsh adapter 与 bridge 核心保持隔离**，dsh 一变只动 adapter 一个文件。
