# 架构 · Architecture

> 本文件描述 dsh-lark-bot 的总体架构与分层设计，仍在演进中。
> This document describes the overall architecture and layering of dsh-lark-bot. Still evolving.

## 分层 · Layering

```
飞书 / Lark（手机 · 群聊 · 话题 · 文档评论）
        │  WebSocket 长连接（出站，免公网服务器 / 域名 / 内网穿透）
        ▼
┌──────────────────────────────────────────┐
│  bridge/   飞书通道接入                    │
│  · 消息事件、流式卡片、卡片交互、媒体上传    │
└──────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────┐
│  session/  会话路由与持久化                │
│  · chat/topic/thread/文档评论 → session key│
│  · 排队合并、中断、访问控制                 │
└──────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────┐
│  workspace/  项目工作区管理（核心差异化）    │
│  · git worktree / 分支隔离                 │
│  · 项目级规则注入（AGENTS.md）               │
│  · 上下文持久化 + 项目索引                  │
└──────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────┐
│  adapters/  agent 后端适配层               │
│  · dsh（headless subprocess fallback，默认）│
│  · claude / codex / opencode（可选）        │
└──────────────────────────────────────────┘
        │
        ▼
DeepSeek Harness (dsh) ──▶ DeepSeek V4 Pro / Flash
```

## 关键决策 · Key Decisions

1. **飞书通道**：采用 `@larksuite/channel`（WebSocket 长连接 + PersonalAgent 应用），并开启 `resolveChatMode` 以区分普通群聊与话题 scope，免公网服务器、免域名、免内网穿透。
2. **agent 后端解耦**：通过 adapter 接口抽象，`dsh` 为默认后端（当前 headless subprocess fallback，ACP 正式接入规划在 P2），未来可切换 claude / codex / opencode。
3. **工作区管理**：会话绑定 git worktree / 分支 + 项目级规则注入 + 上下文持久化，是本项目的核心差异化能力。

## 目录映射 · Directory Mapping

| 目录 Dir | 职责 Responsibility |
| :--- | :--- |
| `src/bridge/` | 飞书通道接入（消息、卡片、媒体） |
| `src/onboard/` | 首次扫码创建 / 绑定 PersonalAgent 应用 |
| `src/session/` | 会话路由、上下文记忆、持久化 |
| `src/workspace/` | 项目工作区管理 |
| `src/adapters/` | agent 后端适配器（dsh 优先） |
| `src/card/` | 流式卡片状态与渲染 |
| `src/bot/` | 运行注册、消息排队 |
| `src/commands/` | 斜杠命令（/cd /ws /new …） |
| `src/config/` | profile / 配置 / 访问白名单管理 |
| `src/core/` | 结构化日志 |
| `src/platform/` | 跨平台原子写入 |
