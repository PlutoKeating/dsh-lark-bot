# 路线图 · Roadmap

| 阶段 Phase | 内容 Scope | 状态 Status |
| :--- | :--- | :--- |
| **P0 脚手架** Scaffolding | 仓库结构、文档、CI 骨架、README | ✅ 已完成 Done |
| **P1 MVP** | 飞书 bot + dsh 单会话往返（发消息 → 收流式卡片） | ✅ 已完成 Done |
| **P2 工作区** Workspace | git worktree 隔离、项目级规则注入、多项目导航、SDK 原生 session 续跑 | ✅ 已完成 Done（SDK 接入） |
| **P3 审批/调度** Approval & Scheduling | 访问白名单、卡片审批（ACP）、问答卡、异步任务队列、沙箱隔离 | 🚧 进行中（审批已接入） |
| **P4 发布** Release | npm 一键安装、GitHub Release、自动发布工作流 | ✅ 已完成 Done |
| **P5 后台服务** Background service | ~~systemd / launchd / 计划任务后台服务~~ → 0.7.0 移除：唯一路径收敛为 dsh profile bundle 内嵌运行 | ⛔ 已移除 Removed (0.7.0) |
| **P6 模型管理** Model & credentials | `/model` `/providers` `/provider` `/key`：会话热切换、dsh 默认模型、provider / 模型 / 凭据管理 | ✅ 已完成 Done（0.5.0） |
| **P7 兼容自动化** Compatibility automation | 兼容矩阵单一事实来源、上游雷达、CI 真实可用性探测、升级手册 | ✅ 已完成 Done（0.5.1） |
| **P8 会话归档** Session archival | 可配置保留窗口、超窗自动归档、`/archive` 手动导出（Markdown + JSONL + Git commit）、保留策略清理 | ✅ 已完成 Done（0.6.0） |
| **P9 并行协同** Parallel collaboration | 同一 scope 多 run 并行（`ActiveRuns` / `PendingQueue` 并发上限 / `/concurrency`）、并行 run 独立 dsh session | ✅ 已完成 Done（0.6.0） |
| **P10 多角色 Agent** Multi-role agents | 持久化角色定义（persona / 模型 / 工具指引 / 规则）+ 按 scope 绑定 + prompt 注入 | ✅ 已完成 Done（0.6.0） |
| **P11 出站通知** Outbound notify | `SendOptions.mentions`、跨会话 `/notify`、`lark_notify` dsh 工具（127.0.0.1 回环回调 + token 鉴权） | ✅ 已完成 Done（0.6.0） |
| **P12 dsh bundle** DSH plugin bundle | `dsh.bundle.patch` + `cordis.patch.yml`、`./plugin` / `./invariant` / `./notify` 导出、`dsh plugin add` 实测 | ✅ 已完成 Done（0.6.0） |
| **P13 唯一路径** Single install path | `dsh-lark-bot setup`（唯一安装命令）→ dsh profile bundle 内嵌运行桥接引擎 → 首次扫码；移除独立后台服务层 | ✅ 已完成 Done（0.7.0） |
| **P14 安全网守护** Safety-net guardian | 独立于 dsh 进程的系统级最小守护：dsh 下线后接管飞书通道、`/safemode` 仅核心（dsh-base + headless）重启与受限对话自愈、`/safemode exit` 恢复完整 profile | ✅ 已完成 Done（0.8.0） |
| **P15 安全模式实时可见性** Safe-mode live visibility | 安全模式优先预置官方 SDK 流式 runtime（`dsh-lark-safe-sdk`）、headless 活动卡回退、单任务空闲超时看门狗、`/safemode stop` 与卡片 ⏹、忙碌回执、正常模式排队回执与卡住提示 | ✅ 已完成 Done（0.10.0） |
| **P16 Web 单写者适配器** Web single-writer adapter | `DSH_LARK_ADAPTER=web` 驱动本地 dsh web agent（`session.prompt` + `/api/events.mux`），网页端成为**唯一写者**，从根上消除多写者会话损坏；配套 web watcher（issue #8 补丁包 / PR #9） | ✅ 已完成 Done（0.11.0） |
| **P17 一键彻底升级** One-command upgrade | `dsh-lark-bot upgrade`：包本体 + guardian 幂等重装重启 + runtime profile 链接修复 + doctor 验证；`--check` / `--restart` / `--rollback` / `--force` / `--no-guardian`；运行中实例安全；旧版本经 `npx dsh-lark-bot@latest upgrade` 引导（issue #10） | ✅ 已完成 Done（0.12.0） |

## 里程碑 · Milestones

- **P1 done**：安装 bundle 后 `dsh --profile <name>` 启动，首次扫码绑定，私聊发消息，收到
  `dsh` 返回的流式卡片。
- **P2 done**：`/ws save/use` 管理命名项目，每个会话绑定独立 git worktree，注入项目级 AGENTS.md；
  SDK 原生 session 续跑。
- **P3 done（审批部分）**：ACP `session/request_permission` 审批卡 + 问答卡；异步任务队列 / 沙箱调度待办。
- **P4 done**：已发布 `dsh-lark-bot@0.4.1` 与 `dsh-feishu-bot@0.4.1`，第三方可
  `npm i -g dsh-lark-bot` / `dsh-feishu-bot` 一键安装；GitHub Release 自动创建。
- **P5 removed**（0.7.0）：独立后台服务层（`start/status/restart/stop`、systemd /
  launchd / 计划任务 / supervisor）已移除；桥接引擎作为 dsh profile bundle 插件在 dsh
  进程内运行，守护由 dsh 宿主负责。
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
- **P10 done**（0.6.0）：`RoleStore` 持久化角色（`<profile>/roles.json`），`/role save|set|
  clear|list|show|remove` 管理；角色 persona / 工具指引 / 规则随 prompt 注入，角色模型参与
  模型优先级，可与并行 run 共存。
- **P11 done**（0.6.0）：出站契约支持 `mentions` 与跨 chat/thread 发送；`ScopeDirectory`
  持久化会话映射；`/notify` 命令；SDK / ACP runtime 自动装配 `lark_notify` 工具，经
  127.0.0.1 回环 + 每启动随机 token 回调 bridge。
- **P12 done**（0.6.0）：`package.json` 声明 `dsh.bundle.patch` → `cordis.patch.yml`；
  `./plugin`（`ctx.larkBridge` 服务）、`./invariant`（invariants 伴生）、`./notify`
  （lark_notify 工具）导出；`dsh plugin --profile demo add` 实测通过（含 dump-config 层验证
  与真实 SDK runtime 握手）。
- **0.6.0 released**：`dsh-lark-bot@0.6.0` / `dsh-feishu-bot@0.6.0`（npm + GitHub Packages +
  GitHub Release），双包均带 dsh bundle 清单。
- **0.7.0 released**：唯一路径定稿——`dsh-lark-bot setup` 安装 dsh profile bundle，桥接引擎
  在 dsh 进程内作为标准插件运行；移除独立后台服务层；npm / GitHub Packages / GitHub Release
  双包同步发布。
- **P14 done（安全网守护）**：新增 `src/guardian/`（心跳 / 状态 / 安全 profile / 进程观察 /
  控制信号 / 接管状态机 / 系统服务安装）；桥接引擎周期写心跳；dsh 下线后守护接管飞书通道，
  `/safemode` 以仅核心 profile（`dsh-base` + `dsh-headless`，无第三方插件）逐条对话自愈，
  `/safemode exit` 重启完整 profile 并交还通道；`setup` 默认安装守护（`--no-guardian` 跳过）
  / `guardian install|uninstall|status|run`。
- **P15 done（安全模式实时可见性，0.10.0）**：安全模式优先预置官方 SDK 流式 runtime
  （`dsh-lark-safe-sdk`，无第三方插件、不挂载 bridge 回调工具），复用正常模式的
  `RunState` / `renderCard` / `streamCard` 实时展示思考 / 工具 / web search / 打字机文字；
  SDK 预置失败自动回退 headless 活动卡；新增单任务空闲超时看门狗（真正 stop 子进程）、
  `/safemode stop`、卡片 ⏹ 按钮、同 scope 忙碌回执与 `guardian-safe` 结构化日志；正常模式
  补充排队回执与“已运行 Ns / 无响应 Ns”卡片提示。
- **0.9.0 released**：agent 主动发起问答卡（`lark_ask_user` 工具 + `/ask` 问答卡），任务等待
  用户回答期间超时看门狗暂停。
- **0.9.1 released**：发布产物完整性门禁——整目录同步 `dist/`，发布前校验全部 `exports`
  子路径与 CLI 入口，杜绝 v0.9.0 的 `ask` 入口漏拷类问题；GitHub Release 显式标记 Latest。
- **0.9.2 released**：`setup` 固定安装当前包的精确版本（`dsh plugin add
  dsh-lark-bot@<版本>`），安装可复现。
- **0.10.0 released**：P15 安全模式实时可见性发布；npm / GitHub Packages / GitHub Release
  双包同步。
- **0.10.1 released（稳定性修复）**：运行看门狗从“墙钟超时”改为“空闲超时”——只在任务持续
  无活动事件时才终止，活跃的流式任务不再被 5 分钟总时长上限误杀；SDK 原生 session 续跑时
  不再重放历史（避免与 dsh 持久化日志漂移），恢复失败自动清 session 并以新会话重试一次
  （id collision 自愈）；发布脚本直接引用仓库 `cordis.patch.yml`，消除发布版与仓库文件的
  注释 / 内容漂移。
- **0.10.2 released（恢复自愈补全）**：SDK 适配器把被拒绝的 session 恢复（如 dsh 持久化层
  的 `id collision`）以 **error 事件**送达而不是抛异常，0.10.1 的降级路径因此没有触发。
  现在恢复中的 run 若**零活动即以 error 终止**，同样判定为会话级失败：清 session 绑定并以
  新会话重试一次（转写重放）；有实际活动后的运行中错误仍正常展示、不重试。安全模式任务在
  同类零活动错误后也会丢弃存储的 session 绑定，下一次安全任务从新会话开始。
- **0.8.0 released**：P14 安全网守护随 0.8.0 发布；npm / GitHub Packages / GitHub Release
  双包同步，社区收录更新请求（awesome-dsh-plugins / dshfind / omdsh）已提交。

Milestones (English): P1 — scan-to-bind and a streaming card round-trip; P2 — named workspaces with
isolated git worktrees and per-project AGENTS.md injection, native SDK session continuation;
P3 — ACP approval cards and Q&A cards (scheduling pending); P4 — `dsh-lark-bot@0.4.1` /
`dsh-feishu-bot@0.4.1` on npm with automated GitHub Release; P5 — background service (removed
in 0.7.0, superseded by in-process bundle loading);
P6 — model / provider / credential management in chat via the official dsh config protocol
(0.5.0); P7 — compatibility matrix, upstream radar and real CI probe (0.5.1).
