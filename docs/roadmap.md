# 路线图 · Roadmap

| 阶段 Phase | 内容 Scope | 状态 Status |
| :--- | :--- | :--- |
| **P0 脚手架** Scaffolding | 仓库结构、文档、CI 骨架、README | ✅ 已完成 Done |
| **P1 MVP** | 飞书 bot + dsh 单会话往返（发消息 → 收流式卡片） | ✅ 已完成 Done |
| **P2 工作区** Workspace | git worktree 隔离、项目级规则注入、多项目导航、SDK 原生 session 续跑 | ✅ 已完成 Done（SDK 接入） |
| **P3 审批/调度** Approval & Scheduling | 访问白名单、卡片审批（ACP）、问答卡、异步任务队列、沙箱隔离 | 🚧 进行中（审批已接入） |
| **P4 发布** Release | npm 一键安装、GitHub Release、自动发布工作流 | ✅ 已完成 Done |
| **P5 后台托管** Background supervision | 同一 dsh profile 的 systemd user / launchd / Windows / portable 托管，登录自启、异常重启、状态/日志/生命周期，与 guardian/upgrade 闭环（#23） | ✅ 已完成 Done |
| **P6 模型管理** Model & credentials | `/model` `/providers` `/provider` `/key`：会话热切换、dsh 默认模型、provider / 模型 / 凭据管理 | ✅ 已完成 Done（0.5.0） |
| **P7 兼容自动化** Compatibility automation | 兼容矩阵单一事实来源、上游雷达、CI 真实可用性探测、升级手册 | ✅ 已完成 Done（0.5.1） |
| **P8 会话归档** Session archival | 可配置保留窗口、超窗自动归档、`/archive` 手动导出（Markdown + JSONL + Git commit）、保留策略清理 | ✅ 已完成 Done（0.6.0） |
| **P9 并行协同** Parallel collaboration | 同一 scope 多 run 并行（`ActiveRuns` / `PendingQueue` 并发上限 / `/concurrency`）、并行 run 独立 dsh session | ✅ 已完成 Done（0.6.0） |
| **P10 多角色 Agent** Multi-role agents | 持久化角色定义（persona / 模型 / 工具指引 / 规则）+ 按 scope 绑定 + prompt 注入 | ✅ 已完成 Done（0.6.0） |
| **P11 出站通知** Outbound notify | `SendOptions.mentions`、跨会话 `/notify`、`lark_notify` dsh 工具（127.0.0.1 回环回调 + token 鉴权） | ✅ 已完成 Done（0.6.0） |
| **P12 dsh bundle** DSH plugin bundle | `dsh.bundle.patch` + `cordis.patch.yml`、`./plugin` / `./invariant` / `./notify` 导出、`dsh plugin add` 实测 | ✅ 已完成 Done（0.6.0） |
| **P13 唯一路径** Single install path | `setup`（唯一安装命令）→ dsh profile bundle 内嵌运行桥接引擎 → 首次扫码；不允许第二套 bridge runtime（P5 可选托管同一 profile） | ✅ 已完成 Done（0.7.0） |
| **P14 安全网守护** Safety-net guardian | 独立于 dsh 进程的系统级最小守护：dsh 下线后接管飞书通道、`/safemode` 仅核心（dsh-base + headless）重启与受限对话自愈、`/safemode exit` 恢复完整 profile | ✅ 已完成 Done（0.8.0） |
| **P15 安全模式实时可见性** Safe-mode live visibility | 安全模式优先预置官方 SDK 流式 runtime（`dsh-lark-safe-sdk`）、headless 活动卡回退、单任务空闲超时看门狗、`/safemode stop` 与卡片 ⏹、忙碌回执、正常模式排队回执与卡住提示 | ✅ 已完成 Done（0.10.0） |
| **P16 Web 单写者适配器** Web single-writer adapter | `DSH_LARK_ADAPTER=web` 驱动本地 dsh web agent（`session.prompt` + `/api/events.mux`），网页端成为**唯一写者**，从根上消除多写者会话损坏；配套 web watcher（issue #8 补丁包 / PR #9） | ✅ 已完成 Done（0.11.0） |
| **P17 一键彻底升级** One-command upgrade | `dsh-lark-bot upgrade`：包本体 + guardian 幂等重装重启 + runtime profile 链接修复及陈旧 SDK/ACP 依赖即时重装 + doctor 验证；`--check` / `--restart` / `--rollback` / `--force` / `--no-guardian`；运行中实例安全；旧版本经 `npx dsh-lark-bot@latest upgrade` 引导（issue #10） | ✅ 已完成 Done（0.12.0；runtime 版本迁移于 #51 补强） |
| **P18 更新体验与热管理** Update experience & hot management | 更新链路架构审查（docs/UPGRADE.md）；doctor 更新提醒（`DSH_LARK_UPGRADE_CHECK`）；guardian 单元稳定路径（避免 npx 缓存）；运行中实例排队重启 / 热重载 / 版本 pin 漂移自愈（issue #15） | 🚧 进行中 In progress |
| **P19 群聊会话隔离** Group session isolation | `/isolation group|topic|member` 持久化选择；消息与卡片动作共用 scope 路由；成员轮次在群卡中明确标记，既有各级会话数据保持可恢复（issue #17） | ✅ 已完成 Done |
| **P20 计划门禁** Plan approval gate | 关键任务先发完整计划，再以 approve/revise + feedback 决策卡暂停并续接原 agent turn；等待期间暂停 idle watchdog（issue #18） | ✅ 已完成 Done |
| **P21 原生折叠过程** Native collapsible process | schema 2.0 原生折叠面板实时承载 reasoning / tools，最终回答单独发送并保留 reply/thread 路由（issue #19） | ✅ 已完成 Done |
| **P22 会话状态指标** Session status metrics | `/status` 可刷新卡：工作区 / 模型 / session / runs / 版本、真实 context 占用、累计 input/output/cache token、待审批/提问/计划；不可得字段不估算（issue #20） | ✅ 已完成 Done |

## 里程碑 · Milestones

- **P1 done**：安装 bundle 后 `dsh --profile <name>` 启动，首次扫码绑定，私聊发消息，收到
  `dsh` 返回的流式卡片。
- **P2 done**：`/ws save/use` 管理命名项目，每个会话绑定独立 git worktree，注入项目级 AGENTS.md；
  SDK 原生 session 续跑。
- **P3 done（审批部分）**：ACP `session/request_permission` 审批卡 + 问答卡；异步任务队列 / 沙箱调度待办。
- **P4 done**：已发布 `dsh-lark-bot@0.4.1` 与 `dsh-feishu-bot@0.4.1`，第三方可
  `npm i -g dsh-lark-bot` / `dsh-feishu-bot` 一键安装；GitHub Release 自动创建。
- **P5 done（#23）**：没有恢复 0.6.x 的独立 bridge engine；`service` 只托管唯一标准 dsh
  profile，提供 systemd user / LaunchAgent / Windows 计划任务 / XDG supervisor 的登录自启、
  异常重启、状态、日志与生命周期；按 profile 加锁、拒绝与现有前台实例并存，且持久化 stop /
  uninstall 意图供 guardian 遵守。guardian / upgrade 优先复用该入口防止双实例。
- **P6 done**（0.5.0）：`/model use|default|reset|add|remove`、`/providers`、`/provider
  add|update|remove`、`/key set|remove|list`；按 dsh 官方存储协议读写 `settings.yaml` +
  `.credentials.yaml`，热切换与默认模型改动下一请求生效。**P6 强化（issue #47）**：每轮运行前
  解析 model → provider 路由并传给 dsh runtime（SDK 适配器路由变化自动重建，`/model use`
  下一轮真实生效）；`agent-default-model` 写入 `{ provider, model }`；`/providers` 与裸
  `/provider` `/model` `/key` 提供 BotFather 式交互卡片多轮向导。
- **P7 done**（0.5.1）：`src/config/dsh-compat.ts` 单一事实来源、`scripts/check-dsh-upstream.mjs`
  上游雷达（每周 CI）、`scripts/probe-dsh-compat.mjs` 真实探测（CI `compat-probe`）、
  `docs/COMPATIBILITY.md` 升级手册、`/help` 测试覆盖。
- **P8 done**（0.6.0）：可配置保留窗口（`/retention` + `DSH_LARK_RETENTION_MSGS`）、超窗消息
  自动归档、`/archive` 手动导出与 `/archive list|clean`、保留策略清理。
- **P9 done**（0.6.0）：同一 scope 并行 run（默认 2，`/concurrency` / `DSH_LARK_SCOPE_CONCURRENCY`
  调整）；`ActiveRuns` 支持多 run 与定向终止，`PendingQueue` 按 scope 并发上限 flush，并行 run
  使用独立 dsh session；`/status` 展示全部 active runs。
- **P22 done**：`/status` 改为可原位刷新卡片；`SessionStore` 随 scope session 持久累计
  input/output/cache token，并按 native session/canonical provider-model 身份分别保存最近真实 context
  快照；并行 run 不互相覆盖，状态卡不复用与当前身份不匹配的旧值。SDK/ACP adapter 只翻译协议明确提供的数据，
  模型目录可补充已知 contextWindow；未知 used/limit/percentage 显示“暂无”。
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
- **P12 后续强化（issue #18）**：新增 `./plan` 导出与宿主 `lark-plan-approval` 工具行；SDK /
  ACP managed overlay 同步装配计划门禁。
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
  `RunState` / `renderCard` / `streamCard` 以折叠面板实时展示思考 / 工具 / web search，最终回答单独发送；
  SDK 预置失败自动回退 headless 活动卡；新增单任务空闲超时看门狗（真正 stop 子进程）、
  `/safemode stop`、卡片 ⏹ 按钮、同 scope 忙碌回执与 `guardian-safe` 结构化日志；正常模式
  补充排队回执与“已运行 Ns / 无响应 Ns”卡片提示。
- **P19 done（issue #17）**：群聊管理员可用 `/isolation group|topic|member` 选择共享群、话题或
  成员级会话；切换仅改变后续消息的 scope 路由，不删除既有 session / worktree / archive；成员
  模式在共享群运行卡中显示 owner。该能力只隔离 agent 上下文，不改变群消息对群成员的可见性。
- **P20 done（issue #18）**：`lark_request_plan_approval` 在较大或高风险动作前把完整计划作为普通
  Markdown 消息发送，再用 schema 2.0 form card 收集批准 / 继续规划与可选反馈；工具阻塞等待并在
  决策后续接同一 agent turn；pre-execute 强制阻断未批准的 mutating/execute 调用，run/callback
  结束按 session 精确取消并撤回卡片，等待期间只暂停所属 run 的 idle watchdog。
- **P21 done（issue #19）**：运行卡使用飞书 Card JSON 2.0 `collapsible_panel` 实时展示推理、工具
  调用与结果，运行中展开、完成后默认收起；最终回答作为独立 Markdown 消息发送并继承原 reply/thread
  路由。面板外的兼容快照保留最新推理与最近工具结果，平台拒绝折叠组件时自动重试 legacy 流式卡；
  最终消息发送失败会把完整回答回填过程卡，同时 exchange 仍持久化。
- **0.9.0 released**：agent 主动发起问答卡（`lark_ask_user` 工具 + `/ask` 问答卡），任务等待
  用户回答期间超时看门狗暂停。
- **P23 done**：问答卡绑定发送后的 messageId；用户可直接回复卡片输入自由文本，单选/多选也接受
  选项外补充。并发问题按卡定向并按 native session 独立清理/暂停看门狗；topic 卡使用最近入站
  messageId 锚定原 thread，member 授权与隔离切换连续性保持不变（issue #22）。
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
`dsh-feishu-bot@0.4.1` on npm with automated GitHub Release; P5 — optional OS supervision of
the same in-process dsh profile (the separate bridge runtime was removed in 0.7.0 and remains removed);
P6 — model / provider / credential management in chat via the official dsh config protocol
(0.5.0); P7 — compatibility matrix, upstream radar and real CI probe (0.5.1);
P19 — persistent group/topic/member session isolation with visible run ownership (issue #17).
