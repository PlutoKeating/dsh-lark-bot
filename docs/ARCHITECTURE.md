# 架构 · Architecture

> 本文件描述 dsh-lark-bot 的总体架构与分层设计，仍在演进中。
> This document describes the overall architecture and layering of dsh-lark-bot. Still evolving.

## 分层 · Layering

```
飞书 / Lark（私聊 · 群聊 · 话题；文档评论为规划中）
        │  WebSocket 长连接（出站，免公网服务器 / 域名 / 内网穿透）
        ▼
┌──────────────────────────────────────────┐
│  bridge/   飞书通道接入                    │
│  · 消息事件、流式卡片、卡片交互、媒体下载    │
└──────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────┐
│  session/  会话路由与持久化                │
│  · chat / topic(thread) → scope key        │
│  · 排队合并、scope 内并行 run、中断、访问控制 │
│  · 保留窗口 + 归档（文件 / Git 仓库）        │
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
│  · dsh-sdk（官方 SDK client，默认）         │
│  · dsh-acp（ACP 审批通道，可选）            │
│  · dsh-headless（legacy fallback）          │
└──────────────────────────────────────────┘
        │
        ▼
DeepSeek Harness (dsh) ──▶ DeepSeek V4 Pro / Flash
```

整条流水线由 `service/` 层以**后台服务**方式守护（CLI `start` / `status` / `restart` / `stop`）：
systemd user service（`Restart=always`）、macOS LaunchAgent（`KeepAlive`）、Windows 计划任务
（失败自动重启），以及无 systemd 时的便携 supervisor 降级；服务进程环境由 `service.env` 快照注入。

## 关键决策 · Key Decisions

1. **飞书通道**：采用 `@larksuite/channel`（WebSocket 长连接 + PersonalAgent 应用），并开启 `resolveChatMode` 以区分普通群聊与话题 scope，免公网服务器、免域名、免内网穿透。
2. **agent 后端解耦**：通过 adapter 接口抽象，`dsh` 为默认后端。默认走官方
   `@deepseek-ai/dsh-sdk-client`（`dsh-sdk-jsonrpc-server` runtime，原生 session + 流式事件）；
   `DSH_LARK_ADAPTER=acp` 走官方 `@deepseek-ai/dsh-acp`（审批卡）；`headless` 保留 legacy fallback。
   桥接核心只依赖 `AgentAdapter` / `AgentEvent` 契约，dsh 漂移只影响 `src/adapters/dsh/`。
3. **工作区管理**：会话绑定 git worktree / 分支 + 项目级规则注入 + 上下文持久化，是本项目的核心差异化能力。
4. **模型 / provider / 凭据管理**：`/model` `/providers` `/provider` `/key` 命令直接读写
   dsh 官方配置存储（`~/.dsh/settings.yaml` + `~/.dsh/.credentials.yaml`），与 dsh Web
   Settings→Models 同一协议（`patchNode` 叶子 diff、`<file>.lock` 写锁、原子替换、0600 凭据文件），
   因此不重复造配置管理 API，也不绕过官方热发布；ACP / SDK 协议本身不含配置管理方法，
   模型切换通过每轮请求的 model 参数与 dsh 热发布生效。

## 目录映射 · Directory Mapping

| 目录 Dir | 职责 Responsibility |
| :--- | :--- |
| `src/bridge/` | 飞书通道接入（消息、卡片、媒体） |
| `src/onboard/` | 首次扫码创建 / 绑定 PersonalAgent 应用 |
| `src/session/` | 会话路由、上下文记忆、持久化 |
| `src/workspace/` | 项目工作区管理 |
| `src/adapters/` | agent 后端适配器（sdk 默认 / acp 审批 / headless legacy） |
| `src/card/` | 流式卡片状态与渲染 |
| `src/bot/` | 运行注册、消息排队 |
| `src/commands/` | 斜杠命令（/cd /ws /new …） |
| `src/cli/` | CLI 入口与 start / status / restart / stop / doctor 命令 |
| `src/config/` | profile / 配置 / 访问白名单管理 |
| `src/core/` | 结构化日志 |
| `src/media/` | 附件下载与文本注入 |
| `src/platform/` | 跨平台原子写入 |
| `src/service/` | 后台服务管理：systemd / launchd / Windows 计划任务 / 便携 supervisor |
