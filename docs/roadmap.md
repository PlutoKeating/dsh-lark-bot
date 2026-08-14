# 路线图 · Roadmap

| 阶段 Phase | 内容 Scope | 状态 Status |
| :--- | :--- | :--- |
| **P0 脚手架** Scaffolding | 仓库结构、文档、CI 骨架、README | ✅ 已完成 Done |
| **P1 MVP** | 飞书 bot + dsh 单会话往返（发消息 → 收流式卡片） | ✅ 已完成 Done |
| **P2 工作区** Workspace | git worktree 隔离、项目级规则注入、多项目导航、SDK 原生 session 续跑 | ✅ 已完成 Done（SDK 接入） |
| **P3 审批/调度** Approval & Scheduling | 访问白名单、卡片审批（ACP）、问答卡、异步任务队列、沙箱隔离 | 🚧 进行中（审批已接入） |
| **P4 发布** Release | npm 一键安装、GitHub Release、自动发布工作流 | ✅ 已完成 Done |

## 里程碑 · Milestones

- **P1 完成标志**：`npx dsh-lark-bot start` 启动后，飞书扫码绑定，私聊发消息，能收到 `dsh` 返回的流式卡片。
- **P2 完成标志**：`/ws save/use` 管理命名项目，每个会话绑定独立 git worktree，注入项目级 AGENTS.md。
- **P4 完成标志**：已发布 `dsh-lark-bot@0.1.0` 与 `dsh-feishu-bot@0.1.0`，第三方可 `npm i -g dsh-lark-bot` / `dsh-feishu-bot` 一键安装。

## Milestones

- **P1 done**: `npx dsh-lark-bot start`, scan-to-bind in Feishu, DM a message, receive a streaming card from `dsh`.
- **P2 done**: `/ws save/use` manages named projects; each session binds an isolated git worktree with per-project AGENTS.md injected.
- **P4 done**: published `dsh-lark-bot@0.1.0` and `dsh-feishu-bot@0.1.0` to npm with automated GitHub Release.
