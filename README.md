<h1 align="center">dsh-lark-bot</h1>

<p align="center">
  <strong>把 DeepSeek Harness 接入飞书 · Bridge DeepSeek Harness into Feishu / Lark</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Feishu%20%2F%20Lark-3370FF" alt="Platform">
  <img src="https://img.shields.io/badge/agent-DeepSeek%20Harness-4D6BFE" alt="Agent">
  <img src="https://img.shields.io/badge/runtime-Node.js%20%E2%89%A5%2022-339933" alt="Node">
  <img src="https://img.shields.io/badge/License-AGPLv3-blue" alt="License">
  <img src="https://img.shields.io/badge/status-scaffolding-orange" alt="Status">
</p>

<br>

<div align="center">

让 **DeepSeek Harness（`dsh`）** 成为你飞书里的一员：在手机、群聊、话题里指挥本机 coding agent，把对话、任务、卡片和**项目工作区**都收进同一个协作流。

<br>

*Turn **DeepSeek Harness (`dsh`)** into a member of your Feishu / Lark workspace — drive your local coding agent from mobile, group chats and topics, and fold conversations, tasks, cards and **project workspaces** into one collaborative flow.*

</div>

---

## 关键词 · Keywords

`dsh` · `deepseek` · `deepseek harness` · `feishu` · `lark` · `bridge` · `bot`

## 这是什么 · What it is

**dsh-lark-bot** 是一个轻量桥接工具，把本机的 DeepSeek Harness（`dsh`）接入飞书 / Lark，复刻当年 OpenCode Telegram Bot / MiMoCode Telegram Bot 的体验——在 IM 里与 coding agent 对话、收流式卡片、审阅 diff，并在此基础上叠加**完整的项目工作区管理**。

**dsh-lark-bot** is a lightweight bridge that connects your local DeepSeek Harness (`dsh`) into Feishu / Lark, recreating the beloved OpenCode / MiMoCode Telegram-bot experience — chat with your coding agent, receive streaming cards, review diffs — and adds **full project workspace management** on top.

## 目标 · Goals

- **一条命令启动**：clone 后一键安装运行，最终发布到 npm，`npx dsh-lark-bot` 即可拉起。
- **飞书原生体验**：流式卡片、交互按钮、图片 / 文件、文档评论，全程双语。
- **完整工作区管理**：多项目隔离、git worktree、项目级规则注入、上下文持久化。

- **One-command start**: clone and run in one step, eventually published to npm as `npx dsh-lark-bot`.
- **Native Feishu experience**: streaming cards, interactive buttons, images / files, doc comments.
- **Full workspace management**: multi-project isolation, git worktrees, per-project rules, persistent context.

## 文档 · Documentation

> 接手本项目的工程师：**先读 [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) 和 [`docs/RESEARCH.md`](docs/RESEARCH.md)**，即可完整理解项目诉求与来龙去脉，无需线下沟通。
> Engineers taking over this project: **read [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) and [`docs/RESEARCH.md`](docs/RESEARCH.md) first**.

| 文档 Doc | 内容 Content |
| :--- | :--- |
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | 完整项目诉求、产出预期、规范与约束<br>Complete requirements, outputs & specifications |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | 调研报告：官方现状、参考项目、可行性、技术差异<br>Research: official status, references, feasibility |
| [`docs/architecture.md`](docs/architecture.md) | 架构分层与目录映射<br>Architecture layering & directory mapping |
| [`docs/adapter-notes.md`](docs/adapter-notes.md) | dsh adapter 接入说明（接口 / 落点 / 路线）<br>How to plug the dsh adapter |
| [`docs/roadmap.md`](docs/roadmap.md) | 路线图与里程碑<br>Roadmap & milestones |
| [`AGENTS.md`](AGENTS.md) | AI Agent 开发工作流规范<br>AI agent workflow spec |

## 架构 · Architecture

> 详见 [`docs/architecture.md`](docs/architecture.md) · See [`docs/architecture.md`](docs/architecture.md) for details.

```
飞书 / Lark ──WebSocket 长连接──▶ bridge/ ──▶ session/ ──▶ workspace/ ──▶ adapters/ ──▶ dsh ──▶ DeepSeek V4
```

核心思路：**飞书通道与 agent 后端解耦**。桥接层复刻 `lark-channel-bridge` 的成熟做法（WebSocket 长连接 + 流式卡片 + 会话路由），agent 后端通过 adapter 抽象，默认挂接 DeepSeek Harness（走 ACP），可切换 claude / codex / opencode。

The core idea: **decouple the Feishu channel from the agent backend**. The bridge layer follows the battle-tested `lark-channel-bridge` approach (WebSocket long-connection + streaming cards + session routing); the agent backend is abstracted behind an adapter, defaulting to DeepSeek Harness (via ACP) and swappable to claude / codex / opencode.

## 目录结构 · Directory Structure

| 目录 Dir | 职责 Responsibility |
| :--- | :--- |
| `src/bridge/` | 飞书通道接入（消息、卡片、媒体）<br>Feishu channel integration |
| `src/session/` | 会话路由、排队、访问控制<br>Session routing, queueing, access control |
| `src/workspace/` | 项目工作区管理<br>Project workspace management |
| `src/adapters/` | agent 后端适配器（dsh 优先）<br>Agent backend adapters (dsh first) |
| `src/commands/` | 斜杠命令（/cd /ws /new …）<br>Slash commands |
| `src/config/` | profile / 配置管理<br>Profile & config |
| `docs/` | 架构、路线图等文档<br>Architecture, roadmap & docs |
| `reference/` | 参考研究用的克隆仓库（不提交）<br>Cloned reference repos (not committed) |

## 路线图 · Roadmap

见 [`docs/roadmap.md`](docs/roadmap.md) · See [`docs/roadmap.md`](docs/roadmap.md).

## 参考项目 · References

| 项目 Project | 说明 About |
| :--- | :--- |
| [`zarazhangrui/lark-coding-agent-bridge`](https://github.com/zarazhangrui/lark-coding-agent-bridge) | 飞书 ↔ Claude Code / Codex 桥接，本项目的直接参照 |
| [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) | DeepSeek Harness（`dsh`），agent 后端 |
| [`grinev/opencode-telegram-bot`](https://github.com/grinev/opencode-telegram-bot) | OpenCode 的 Telegram 手机端，另一参照 |

## 免责声明 · Disclaimer

> [!NOTE]
> 本项目为非官方社区工具，与 DeepSeek、字节跳动 / 飞书（Lark）无关联，亦未获得其背书。DeepSeek Harness、Feishu / Lark 及相关商标归各自权利人所有。
>
> This is an unofficial community tool, not affiliated with or endorsed by DeepSeek or ByteDance / Feishu (Lark). DeepSeek Harness, Feishu / Lark and related trademarks belong to their respective owners.
