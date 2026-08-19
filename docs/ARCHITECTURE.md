# 架构 · Architecture

> 本文件描述 dsh-lark-bot 的总体架构与分层设计，仍在演进中。
> This document describes the overall architecture and layering of dsh-lark-bot. Still evolving.

## 分层 · Layering

```
┌──────────────────────────────────────────┐
│  dsh profile · cordis 组合                │
│  · dsh-lark-bot/plugin（桥接引擎，进程内） │
│  · dsh-lark-bot/notify（lark_notify 工具）│
└──────────────────────────────────────────┘
        │  以标准插件方式加载 | loaded as a standard plugin
        ▼
飞书 / Lark（私聊 · 群聊 · 话题；文档评论为规划中）
        │  WebSocket 长连接（出站，免公网服务器 / 域名 / 内网穿透）
        ▼
┌──────────────────────────────────────────┐
│  bridge/   飞书通道接入                    │
│  · 消息事件、流式卡片、卡片交互、媒体下载    │
│  · 出站 @ 提及 + 跨会话通知（lark_notify 工具）│
└──────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────┐
│  session/  会话路由与持久化                │
│  · chat / topic / member → scope key       │
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
│  · dsh-web（本地 dsh web agent，单写者）    │
└──────────────────────────────────────────┘
        │
        ▼
DeepSeek Harness (dsh) ──▶ DeepSeek V4 Pro / Flash
```

```
┌──────────────────────────────────────────┐
│  guardian/（可选 · 独立于 dsh 的进程）      │
│  · 心跳看门狗（读 bridge 心跳 + ps 观察）  │
│  · dsh 下线后接管飞书通道，接收 /safemode  │
│  · 仅核心安全 profile（SDK 流式优先，      │
│    headless 回退，均无第三方插件）         │
│  · 受限对话自愈 + 退出重启完整 profile      │
└──────────────────────────────────────────┘
```

```
┌──────────────────────────────────────────┐
│  dsh profile（cordis 组合）                │
│  · dsh-lark-bot/plugin  桥接引擎（进程内） │
│  · dsh-lark-bot/notify  lark_notify 工具  │
│  · @deepseek-ai/dsh-base …               │
└──────────────────────────────────────────┘
```

本项目以 **dsh 标准 profile bundle** 交付：`dsh plugin add dsh-lark-bot`（或一行
`dsh-lark-bot setup`）把包装进 profile，dsh 启动时以标准插件方式加载
`dsh-lark-bot/plugin` —— 桥接引擎**在 dsh 进程内**运行（飞书 WebSocket 通道、会话/工作区、
卡片、通知回调），并按需拉起官方 dsh SDK runtime 子进程执行 agent 任务。可选 `src/service/`
把这同一个 dsh profile 交给 OS 用户服务常驻，不产生第二套桥接引擎；默认安装的「安全网守护」
是唯一独立于 dsh 的救援进程（见关键决策 8）。
首次启动无凭据时打印二维码完成一次性绑定。

## 关键决策 · Key Decisions

1. **飞书通道与 scope 隔离**：采用 `@larksuite/channel`（WebSocket 长连接 + PersonalAgent 应用），并开启 `resolveChatMode`。`IsolationStore`（`<profile>/isolation.json`）按 chat 持久化 `group|topic|member` 策略，默认 `topic` 保持原有普通群/话题行为；成员模式生成 `<chat>:member:<open_id>`。消息入队时即固化 scope，owner 从该 scope 还原；运行 / 审批 / 问答 card action 携带创建时 scope，member action 还要求 operator `open_id` 与 owner 一致，`/stop` 遍历当前操作者可达的 group / topic / member scopes，因此切换策略不会孤立旧运行或越权操作其他成员会话。任务卡显示 owner。问答卡发送后，`QuestionRegistry` 在内存中绑定 card messageId 与创建时 scope/question id；runtime 问题再绑定 native session，使并发 run 只清理/暂停自己的问题。输入消息回复该卡时优先作为自由文本答案；topic 卡以 `ScopeDirectory` 最近入站 messageId 作为 reply anchor。群聊 mention gate 在 bridge 匹配回复后执行：普通消息仍须 @（或显式 no-at 模式），只有 pending 问答卡 reply 可免 @；topic 必须匹配原 thread，member 必须匹配 owner。切换只影响后续路由，不迁移或删除旧 scope 数据。PersonalAgent 群事件默认只处理 @ 消息和 pending 问答卡回复；可通过 `DSH_LARK_GROUP_NO_AT=true` 显式启用历史 API 增量轮询及实时无 @ 消息；两条 no-at 路径都校验当前 `allowedUsers` / `allowedChats`。轮询仅面向 `ScopeDirectory` 已登记的 group/topic，以 per-chat 水位和跨实时/轮询 message ID claim 去重，经过与实时事件相同的白名单、freshness、bot/system/deleted 过滤及消息处理管线；进程启动时间作为初始水位，不回放历史积压。该模式要求非空显式用户白名单与 `im:message.group_msg` 权限，并由 `doctor` 做 best-effort 实际权限探测。
2. **agent 后端解耦**：通过 adapter 接口抽象，`dsh` 为默认后端。默认走官方
   `@deepseek-ai/dsh-sdk-client`（`dsh-sdk-jsonrpc-server` runtime，原生 session + 流式事件）；
   `DSH_LARK_ADAPTER=acp` 走官方 `@deepseek-ai/dsh-acp`（审批卡）；`headless` 保留 legacy fallback；
   `DSH_LARK_ADAPTER=web` 走本地 dsh web agent（`session.prompt` + `/api/events.mux`，单写者，根治双写）。
   桥接核心只依赖 `AgentAdapter` / `AgentEvent` 契约；dsh 协议漂移集中在
   `src/adapters/dsh/`，宿主工具 registry 漂移集中在 `src/notify/` 的 raw-schema 注册边界。
   当前兼容基线为 rc.7；托管 SDK/ACP profile 的 ready 判定读取实际 package manifest 并
   核对精确版本，旧 profile 进入幂等重装。ACP 图片输入使用 capability-gated 原生 image
   block；出站图片在 channel 增加二进制能力前输出明确降级提示。
3. **工作区管理**：会话绑定 git worktree / 分支 + 项目级规则注入 + 上下文持久化，是本项目的核心差异化能力。
   `SessionStore` schema 2 在同一 `sessions.json` 中按 scope + canonical workspace cwd 分别保存
   transcript、native binding 与 metrics；schema 1 在启动时按 `WorkspaceStore` 当前选择迁移。消息入队
   时固化 workspace，切换期间不会把旧任务重路由。`/cd` / `/ws use` 中断原 workspace 的 active run，
   但保留其 session / transcript / metrics / archive，A → B → A 恢复 A；`/new` / `/reset` 只清当前
   workspace。Git worktree 由 scope + base path hash 派生，同 scope 的不同项目不共用目录；schema 1
   迁移先从旧 scope-only worktree 的 Git registry 解析 owning repo，把 session 与旧 retention archive
   header 归回真实项目（逐文件原子、半完成可识别并在下次启动幂等重试，归档仓库留下 migration
   commit）；全部成功后才持久化 session schema 2。请求项目
   匹配 owner 时才 `git worktree move` 原位迁移；不匹配则保留旧树并为当前项目建新树。run-flow 只接收 adapter 翻译出的真实 `usage` /
   `context_usage` 事件并累计，不从文本长度推算。累计 token 归属 workspace，最近 context 快照按
   workspace、native session 与 canonical provider/model 分别保存；`/status` 的 run / pending 和
   `/archive list|clean` 都只展示或操作当前 workspace，并发 run 不互相覆盖。
   `/status` 的纯 renderer 从 stores/registries 组装可刷新卡；refresh action
   固化 scope，并复用 member owner 授权后通过消息 `messageId` 原位更新。
4. **模型 / provider / 凭据管理**：`/model` `/providers` `/provider` `/key` 命令直接读写
   dsh 官方配置存储（`~/.dsh/settings.yaml` + `~/.dsh/.credentials.yaml`），与 dsh Web
   Settings→Models 同一协议（`patchNode` 叶子 diff、`<file>.lock` 写锁、原子替换、0600 凭据文件），
   因此不重复造配置管理 API，也不绕过官方热发布；ACP / SDK 协议本身不含配置管理方法，
   模型切换通过每轮请求的 provider/model 路由与 dsh 热发布生效：桥接在每轮运行前调用
   `DshProviderManager.resolveModelRoute()` 把模型解析为「provider + model」，SDK 适配器在
   路由变化时关闭旧 runtime 并以新路由重建（`/model use` 下一轮真正生效）；`agent-default-model`
   按 dsh 官方 schema 写入 `{ provider, model }` 双字段。管理入口的主卡直接列出模型并以
   `provider/model` 路由执行 per-scope 热切换、标记按「scope > role > profile > dsh > env」
   解析出的实际当前模型，且始终提供“恢复默认”；增删 provider / 模型 / 凭据等写操作继续使用
   BotFather 式交互卡片多轮向导（`src/commands/config-wizard.ts` + `src/card/config-cards.ts`，
   `src/bot/wizard-store.ts` 持有 per-scope 向导状态）。卡片全部使用 schema 2.0：
   按钮直接放 `body.elements`（横排用 `column_set` 自动宽列，兼容飞书 2.0 对旧
   `action` 容器的拒绝），需要文本/选择输入时以 `form` 容器包住组件与提交按钮，
   回调经 `action.form_value` 取输入值。
   计划、审批与问答 action 先结算 registry 中的业务结果，再以“原生 toast + 终态确认消息 + 撤回原内联卡片”
   完成 UI 收尾；toast 立即返回，确认消息保持原话题上下文，确认/撤回均为 best-effort 异步任务，
   失败只记录结构化日志，不能阻塞 agent 继续运行。
5. **bot UI 国际化 seam**：`src/card/i18n.ts` 把中文与英文 variant 组合为同一 Card JSON 2.0
   payload（`config.locales/use_custom_translation` + 每个文本组件的 `i18n_content.zh_cn/en_us`），并在出站前校验两种语言的 button
   callback value 完全一致。运行、状态、工作区、配置、审批、计划与问答卡只本地化固定 chrome，
   动态 agent / 用户 / 工具内容在两种 variant 中原样复用。标准化入站事件不含每位读者 locale，
   因此 Markdown、toast 与兼容降级使用中英并列，不保存或推断个人语言。
6. **多角色 Agent**：`RoleStore`（`<profile>/roles.json`）定义命名角色（persona / 模型 /
   工具指引 / 角色规则）并按 scope 绑定；运行期角色指令作为 prompt 前缀注入，角色模型参与
   模型优先级（每会话 `/model use` > 角色 > profile > dsh 默认 > 环境），因此角色切换无需
   重启 runtime，也能与 scope 内并行 run 共存。
7. **多机器人实例与可信交接（issue #25）**：每个实例拥有独立 bridge profile、dsh profile、
   `~/.dsh-lark/bots/<name>/dsh` DSH_HOME、
   PersonalAgent 身份、用户服务与凭据快照，因此模型、session、scope、worktree 和 archive 不共享。
   `BotFleetStore` 只在全局 `fleet.json` 保存实例元数据与已验证 bot `open_id`，不保存密钥；
   `BotHandoffGuard` 以跨进程锁维护 `handoffs.json`，对同一 chat 的可信 bot 连续交接精确计数并按
   messageId 去重，真人新消息会重置计数。只有飞书事件确认为 bot、真实 @ 当前 bot 且 sender
   `open_id` 匹配已登记启用实例时才进入交接；未知 bot、系统消息和匿名事件 fail closed。
   运行 prompt 只注入已登记 peer 的精确名称/open_id，交接复用 `lark_notify`。机器人在 member
   隔离群中的交接降级到 group/topic scope，避免创建无人可操作的 bot-owned 决策卡。
   附加实例的 adapter 限定为 `sdk` / `acp` / legacy `headless`；`web` 的共享广播流无法按实例
   隔离 session，因此创建和运行时均 fail closed。
8. **通知与人机决策回调**：bridge 出站契约支持 `mentions` 与跨 chat/thread 发送；`ScopeDirectory`
   持久化 scope → chat/thread/最近入站 messageId 映射（messageId 用于 topic reply anchor）；`NotifyServer` 在 127.0.0.1 提供带 token 鉴权的回调，
   SDK / ACP runtime 装配 `lark_notify` 工具（`dsh-lark-bot/notify`），agent 可主动 @ 提及
   并向其他会话推送汇报；本地回环 + 每启动随机 token，不暴露公网。
   `lark_notify` / `lark_ask_user` / `lark_request_plan_approval` 以宿主支持的 raw JSON Schema
   definition 注册，不运行时导入 `dsh-tools`，避免插件与宿主各自持有 scheduler Symbol 的双实例故障。
   计划工具通过同一 server 的 `/plan` 端点以 session 反查 immutable scope：完整计划先作为普通
   Markdown 消息发送，再由 `PlanApprovalRegistry` + schema 2.0 form card 等待 approve/revise 与
   可选 feedback；工具返回后原 agent turn 自动续跑，等待期间 idle watchdog 仅为所属 session 暂停。
   `tools/pre-execute` 会拒绝当前 turn 尚未批准的 mutating/execute/`run_code` 调用；run 或 HTTP request
   取消时精确撤销并终态化该 session 的卡，因此 SDK、ACP、Web 宿主路径都不是仅靠提示词约束。
   默认 SDK 与 host bundle 还装配 `dsh-lark-bot/approval`：它先以 `tools/pre-execute` 强制拦截
   高风险工具，再以 structural listener 接入 rc.7
   `approval/request` waterfall，经 `/approval` 路由到 scope/session 精确的 `ApprovalRegistry`；
   ACP 保留协议原生 `session/request_permission`，避免双 answerer；若底层工具在 pre-execute 放行后
   继续询问官方 seam，同一 in-flight grant 被复用，不重复弹卡。逐工具等待同样只暂停所属 run。
9. **唯一运行时、可选 OS 托管（issue #23）**：不做「独立 bridge 服务 vs dsh 插件」双路径。产品形态收敛为
   dsh profile bundle：`dsh-lark-bot setup --profile <name>`（内部自动处理 pnpm 构建策略并
   执行标准 `dsh plugin add`）→ `dsh --profile <name>` → 首次扫码。CLI 仅保留 `setup` /
   `doctor` / `upgrade` / 隐藏 `run`，并提供 `service install|start|status|logs|restart|stop|uninstall`
   把标准 `dsh --profile` 交给 systemd user / LaunchAgent / Windows 计划任务（Linux 无 user systemd
   时用 XDG supervisor）。原生入口启动 profile 内稳定 CLI runner，由其读取 0600 环境快照，避免
   plist / 计划任务泄露密钥（Windows 另以 owner-only ACL 收紧 env）。guardian 自动重启和 `upgrade --restart` 优先操作该受管服务，避免双实例。
   `service/<profile>.intent.json` 持久化 running/stopped 意图，stop/uninstall 后 guardian 不回拉；
   生命周期目录锁串行化 mutation，install/start 还会拒绝已存在的未受管同 profile 进程。
   WebSocket 在机器睡眠 / 断网期间无法收消息；恢复后仅向最近活跃 destination 发恢复通知。
10. **一键彻底升级（issue #10）**：`dsh-lark-bot upgrade` 从任意旧版本（含 0.7.0 前遗留形态）
   一条命令完成 包本体（`dsh plugin add <name>@<latest>`）→ guardian 幂等重装并重启 →
   runtime profile（dsh-lark-sdk / dsh-lark-acp）own-package 链接修复与陈旧上游依赖幂等重装
   → `doctor` 升级后验证；
   运行中实例默认只提示重启命令（不中断会话 / 配置 / 凭据），`--restart` 可选自动重启，
   `--rollback` 按 `~/.dsh-lark/upgrade-state.json` 记录精确回滚。旧版本（无 upgrade 命令）
   通过 `npx dsh-lark-bot@latest upgrade` 引导：npx 拉取最新版执行升级。
11. **安全网守护（issue #6）**：dsh 采用「一切皆插件」架构，任一第三方插件都可能让整个组合
   boot 失败，导致桥接引擎与 dsh 一起下线。因此在插件托管架构之外，额外提供**独立于 dsh
   进程的最小「安全网守护」**：桥接引擎周期写入心跳文件（`<bridge-profile>/guardian/
   heartbeat.json`），守护仅在「曾观察 dsh 在线 且 心跳过期 / 无 dsh 进程」时接管飞书长连接
   （同 app 单长连接约束：dsh 在线时守护必须静默，绝不抢占通道）。`/safemode` 进入仅核心
   安全模式：优先预置 `~/.dsh/profiles/<profile>-safe-sdk`（官方 `dsh-base` +
   `dsh-sdk-jsonrpc-server`，无第三方插件）以获得与正常模式一致的原生折叠过程卡（思考 / 工具 /
   web search）和独立最终回答，SDK runtime 不可用时回退 `~/.dsh/profiles/<profile>-safe`
   （`dsh-base` + `dsh-headless`）并以活动状态卡兜底；单任务空闲超时（默认 10 分钟，
   持续无活动事件才终止，活跃的流式任务不会被误杀）、
   `/safemode stop` 与卡片 ⏹ 按钮可随时终止；`/safemode exit` 重启完整 profile 并交还通道。
   守护检测到 dsh 下线时会先自动重启完整 profile：spawn 前二次进程探测防双实例，就绪窗口
   （默认 15s）内等待桥接恢复（心跳新鲜或进程存活），失败才转交接管；重启冷却默认 60s。
   守护以 systemd user unit / LaunchAgent / Windows 启动项注册，进程本身不依赖任何 dsh /
   Cordis 代码。

## 目录映射 · Directory Mapping

| 目录 Dir | 职责 Responsibility |
| :--- | :--- |
| `src/bridge/` | 飞书通道接入（消息、卡片、媒体） |
| `src/onboard/` | 首次扫码创建 / 绑定 PersonalAgent 应用 |
| `src/session/` | 会话路由、上下文记忆、持久化 |
| `src/workspace/` | 项目工作区管理 |
| `src/adapters/` | agent 后端适配器（sdk 默认 / acp 审批 / headless legacy / web 单写者） |
| `src/card/` | 流式过程卡（schema 2.0 原生折叠面板 + 顶层兼容快照 + legacy renderer）、审批 / 问答 / 计划决策卡状态与渲染；最终回答由正常 run-flow / guardian 分别单独发送 |
| `src/bot/` | 运行注册、消息排队、审批 / 问答 / 计划 registry、群聊隔离策略，以及多机器人 fleet / 跨进程交接计数 |
| `src/commands/` | 斜杠命令（/cd /ws /new …） |
| `src/cli/` | CLI 入口：`setup` / `bot add|list|status|remove` / `service` / `doctor` / `upgrade` / 隐藏 `run` |
| `src/upgrade/` | 一键升级（issue #10/#51）：版本/状态检测、guardian / profile 重启、runtime profile 链接及依赖迁移 |
| `src/config/` | profile / 配置 / 访问白名单管理 |
| `src/core/` | 结构化日志 |
| `src/media/` | 附件下载与文本注入 |
| `src/notify/` | 进程内 `/notify` `/ask` `/plan` `/approval` 回调、raw-schema dsh 工具与 approval answerer |
| `src/platform/` | 跨平台原子写入 |
| `src/guardian/` | 安全网守护（默认随 setup 安装）：心跳、状态持久化、仅核心安全 profile、进程观察、控制信号、接管状态机、系统服务安装 |
| `src/service/` | 正常 dsh profile 的 systemd / launchd / Windows / portable 生命周期、0600 环境快照、状态与日志 |
