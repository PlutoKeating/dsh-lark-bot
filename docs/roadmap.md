# 路线图 · Roadmap

| 阶段 Phase | 内容 Scope | 状态 Status |
| :--- | :--- | :--- |
| **P0 脚手架** Scaffolding | 仓库结构、文档、CI 骨架、README | ✅ 已完成 Done |
| **P1 MVP** | 飞书 bot + dsh 单会话往返（发消息 → 收流式卡片） | ✅ 已完成 Done |
| **P2 工作区** Workspace | git worktree 隔离、项目级规则注入、多项目导航、SDK 原生 session 续跑 | ✅ 已完成 Done（SDK 接入） |
| **P3 审批/调度** Approval & Scheduling | 访问白名单、卡片审批（ACP）、问答卡、异步任务队列、沙箱隔离 | 🚧 进行中（审批已接入） |
| **P4 发布** Release | npm 一键安装、GitHub Release、自动发布工作流 | ✅ 已完成 Done |

## 里程碑 · Milestones

- **P1 done**：`npx dsh-lark-bot start` 启动后飞书扫码绑定，私聊发消息，收到 `dsh` 返回的流式卡片。
- **P2 done**：`/ws save/use` 管理命名项目，每个会话绑定独立 git worktree，注入项目级 AGENTS.md；
  SDK 原生 session 续跑。
- **P3 done（审批部分）**：ACP `session/request_permission` 审批卡 + 问答卡；异步任务队列 / 沙箱调度待办。
- **P4 done**：已发布 `dsh-lark-bot@0.3.0` 与 `dsh-feishu-bot@0.3.0`，第三方可
  `npm i -g dsh-lark-bot` / `dsh-feishu-bot` 一键安装；GitHub Release 自动创建。

Milestones (English): P1 — scan-to-bind and a streaming card round-trip; P2 — named workspaces with
isolated git worktrees and per-project AGENTS.md injection, native SDK session continuation;
P3 — ACP approval cards and Q&A cards (scheduling pending); P4 — `dsh-lark-bot@0.3.0` /
`dsh-feishu-bot@0.3.0` on npm with automated GitHub Release.
