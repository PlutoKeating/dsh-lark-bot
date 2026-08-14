# 路线图 · Roadmap

| 阶段 Phase | 内容 Scope | 状态 Status |
| :--- | :--- | :--- |
| **P0 脚手架** Scaffolding | 仓库结构、文档、CI 骨架、README | ✅ 已完成 Done |
| **P1 MVP** | 飞书 bot + dsh 单会话往返（发消息 → 收流式卡片） | ✅ 已完成 Done |
| **P2 工作区** Workspace | git worktree 隔离、项目级规则注入、多项目导航、SDK 原生 session 续跑 | ✅ 已完成 Done（SDK 接入） |
| **P3 审批/调度** Approval & Scheduling | 访问白名单、卡片审批（ACP）、问答卡、异步任务队列、沙箱隔离 | 🚧 进行中（审批已接入） |
| **P4 发布** Release | npm 一键安装、GitHub Release、自动发布工作流 | ✅ 已完成 Done |
| **P5 后台服务** Background service | systemd / launchd / 计划任务：后台运行、开机自启、崩溃自动重启；CLI `start / status / restart / stop` | ✅ 已完成 Done |
| **P6 模型管理** Model & credentials | `/model` `/providers` `/provider` `/key`：会话热切换、dsh 默认模型、provider / 模型 / 凭据管理 | ✅ 已完成 Done（0.5.0） |
| **P7 兼容自动化** Compatibility automation | 兼容矩阵单一事实来源、上游雷达、CI 真实可用性探测、升级手册 | ✅ 已完成 Done（0.5.1） |
| **P8 会话归档** Session archival | 可配置保留窗口、超窗自动归档、`/archive` 手动导出（Markdown + JSONL + Git commit）、保留策略清理 | ✅ 已完成 Done（0.6.0） |
| **P9 并行协同** Parallel collaboration | 同一 scope 多 run 并行（`ActiveRuns` / `PendingQueue` 并发上限 / `/concurrency`）、并行 run 独立 dsh session | ✅ 已完成 Done（0.6.0） |

## 里程碑 · Milestones

- **P1 done**：`npx dsh-lark-bot start` 启动后飞书扫码绑定，私聊发消息，收到 `dsh` 返回的流式卡片。
- **P2 done**：`/ws save/use` 管理命名项目，每个会话绑定独立 git worktree，注入项目级 AGENTS.md；
  SDK 原生 session 续跑。
- **P3 done（审批部分）**：ACP `session/request_permission` 审批卡 + 问答卡；异步任务队列 / 沙箱调度待办。
- **P4 done**：已发布 `dsh-lark-bot@0.4.1` 与 `dsh-feishu-bot@0.4.1`，第三方可
  `npm i -g dsh-lark-bot` / `dsh-feishu-bot` 一键安装；GitHub Release 自动创建。
- **P5 done**：`dsh-lark-bot start` 安装后台服务并加入开机自启，退出 / 崩溃自动重启；
  `status` / `restart` / `stop` 管理服务；无前台运行。
- **P6 done**（0.5.0）：`/model use|default|reset|add|remove`、`/providers`、`/provider
  add|update|remove`、`/key set|remove|list`；按 dsh 官方存储协议读写 `settings.yaml` +
  `.credentials.yaml`，热切换与默认模型改动下一请求生效。
- **P7 done**（0.5.1）：`src/config/dsh-compat.ts` 单一事实来源、`scripts/check-dsh-upstream.mjs`
  上游雷达（每周 CI）、`scripts/probe-dsh-compat.mjs` 真实探测（CI `compat-probe`）、
  `docs/COMPATIBILITY.md` 升级手册、`/help` 测试覆盖。
- **P8 done**（0.6.0）：可配置保留窗口（`/retention` + `DSH_LARK_RETENTION_MSGS`）、超窗消息
  自动归档、`/archive` 手动导出与 `/archive list|clean`、保留策略清理。
- **P9 done**（0.6.0）：同一 scope 并行 run（默认 2，`/concurrency` / `DSH_LARK_SCOPE_CONCURRENCY`
  调整）；`ActiveRuns` 支持多 run 与定向终止，`PendingQueue` 按 scope 并发上限 flush，并行 run
  使用独立 dsh session；`/status` 展示全部 active runs。

Milestones (English): P1 — scan-to-bind and a streaming card round-trip; P2 — named workspaces with
isolated git worktrees and per-project AGENTS.md injection, native SDK session continuation;
P3 — ACP approval cards and Q&A cards (scheduling pending); P4 — `dsh-lark-bot@0.4.1` /
`dsh-feishu-bot@0.4.1` on npm with automated GitHub Release; P5 — background service with
autostart and restart-on-failure, managed via `start` / `status` / `restart` / `stop`;
P6 — model / provider / credential management in chat via the official dsh config protocol
(0.5.0); P7 — compatibility matrix, upstream radar and real CI probe (0.5.1).
