<h1 align="center">dsh-lark-bot</h1>

<p align="center">🌏 英文版：[README_EN.md](README_EN.md)</p>

<p align="center">
  <strong>把 DeepSeek Harness 接入飞书</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Feishu%20%2F%20Lark-3370FF" alt="Platform">
  <img src="https://img.shields.io/badge/agent-DeepSeek%20Harness-4D6BFE" alt="Agent">
  <img src="https://img.shields.io/badge/runtime-Node.js%20%E2%89%A5%2022-339933" alt="Node">
  <img src="https://img.shields.io/badge/License-AGPLv3-blue" alt="License">
  <img src="https://img.shields.io/badge/status-released-blue" alt="Status">
  <a href="https://dshfind.com/zh/plugins/PlutoKeating/dsh-lark-bot?ref=badge"><img src="https://dshfind.com/api/badge/PlutoKeating/dsh-lark-bot?lang=zh" alt="dshfind"></a>
  <a href="https://dshbase.com/zh/plugins/dsh-lark-bot"><img src="https://dshbase.com/badges/dsh-lark-bot.svg" alt="dshbase 实测可装"></a>
  <a href="https://dsh-plugin.org/plugins/plutokeating/dsh-lark-bot"><img src="https://dsh-plugin.org/badges/listed.svg" alt="Listed on dsh-plugin.org"></a>
  <a href="https://github.com/PlutoKeating/dsh-lark-bot/releases"><img src="https://img.shields.io/github/v/release/PlutoKeating/dsh-lark-bot?sort=semver&label=latest%20release" alt="Latest release"></a>
  <a href="https://github.com/PlutoKeating/dsh-lark-bot/commits/main"><img src="https://img.shields.io/github/commits-since/PlutoKeating/dsh-lark-bot/v0.7.0?label=commits%20since%20v0.7.0" alt="Commits since v0.7.0"></a>
</p>

<br>

<div align="center">

让 **DeepSeek Harness（`dsh`）** 成为你飞书里的一员：在手机、群聊、话题里指挥本机 coding agent，把对话、任务、卡片和**项目工作区**都收进同一个协作流。

</div>

<p align="center">
  🌐 官网落地页 <a href="https://dsh-lark-bot.arr2018.dpdns.org">dsh-lark-bot.arr2018.dpdns.org</a>
  · 备用 <a href="https://plutokeating.github.io/dsh-lark-bot/">GitHub Pages</a>
</p>

> **⚠️ 仅认准官方渠道：** 唯一官方仓库 [PlutoKeating/dsh-lark-bot](https://github.com/PlutoKeating/dsh-lark-bot)，唯一官方 npm 包 `dsh-lark-bot`（同源双包 `dsh-feishu-bot`，维护者 `plutokeating`）。**本项目从不提供 Windows 可执行文件（.exe），也没有任何“下载即运行”的安装包**——任何以本项目名义提供 exe / “下载后双击运行”的页面、仓库或第三方分发渠道均为**假冒 / 恶意来源**，请勿下载或运行。官方安装唯一命令：`npx dsh-lark-bot@latest setup --profile dsh-lark`。仿冒仓库取证与完整声明见文末「假冒仓库警告」及 [docs/security/2026-08-17-impostor-repo-evidence/](docs/security/2026-08-17-impostor-repo-evidence/README.md)。

---

## 场景

**你的 DeepSeek Harness 只能“贴身”用？** dsh 跑在本机，每次看进度、改任务都得回到电脑前；离开工位后任务卡住、跑偏甚至 dsh 崩了，你都收不到任何消息——回来才发现白等半天。

**dsh-lark-bot 把遥控器装进你的飞书**：在私聊、群聊、话题里直接指挥本机 dsh coding agent，流式卡片的飞书原生折叠面板实时展示阶段、耗时以及工具名称与状态，最终回答单独成消息；任务完成还能主动推送到你所在的任何群并 @ 你；即使 dsh 崩溃下线，飞书里依然叫得应——发 `/safemode` 进入仅核心安全模式，直接在聊天里定位问题、重启引擎。**这是唯一“dsh 挂了你不会失联”的桥接方案。**

**适合谁**：在飞书 / Lark（私聊、群聊、话题）里指挥本机 dsh coding agent 的开发者与团队，尤其是需要多项目隔离、角色分工、并行任务与会话归档的协作场景。

## 能做什么

**基础能力**：

- 私聊、群聊、话题（thread）里指挥本机 dsh coding agent，图片 / 文本文件直接发给 bot 即可；
- 流式过程卡以飞书原生折叠面板实时展示阶段、耗时以及工具名称与状态，完成后最终回答单独发送，支持交互按钮（停止 / 计划门禁 / 审批 / 问答卡）；原始推理、工具输入输出与底层错误不会进入卡片；卡片更新失败会有限重试并降级为普通提示，Agent 与最终回答继续，不会拖垮 bridge 进程；
- Git 仓库内为每个会话自动创建隔离 worktree 项目工作区，多项目互不干扰。

**十一项全网独有组合**：

- 🆘 **Guardian 安全网守护——“永远叫得应”**：DSH 崩溃后飞书仍会回复你，`/safemode` 进入仅核心安全模式直接重启。
- 👥 **多角色 Agent——“一个机器人，一整个团队”**：`/role` 切换或指派 PM / 开发 / 文档等角色，每个角色独立人设、模型偏好与规则。
- 🤝 **多机器人交接——“一个群，多个独立 Agent”**：`bot add` 增加独立身份/服务/凭据/上下文的实例，可信机器人可在同群通过真实 @ 交接，连续协作有硬上限。
- ⚡ **并行多任务——“不用排队”**：同一群聊同时跑多个任务、会话隔离；其他方案只能串行排队。
- 🧾 **崩溃后可对账——“发出去了不是石沉大海”**：消息先写持久任务账本再入队；重启恢复排队项，中断任务保留 checkpoint 并由 `/jobs` 显式重试。
- 🗂 **会话归档与清理——“会话列表不会烂掉”**：`/archive` 归档旧任务、`/retention` 配置自动保留策略。
- 📣 **跨会话主动通知 + @人——“活干完了它会来找你”**：A 群跑完任务主动推送到 B 群 / 私聊并 @ 你。
- ⚙️ **dsh Web 可视化设置——“不用背环境变量”**：在官方 Settings → Plugins 页面点选应用、工作目录、模型、并行数与提醒，并可直达诊断。
- 🔑 **对话内管理模型和密钥——“不用离开飞书”**：`/providers` `/provider` `/key` 直接查看、切换供应商、热更新密钥。
- 🎚️ **快速 / 平衡 / 深度模式——“任务强度一键选”**：`/mode` 按 scope 持久选择，下一轮生效且不打断当前任务。
- 🧭 **关键任务先拍板——“计划看清再动手”**：完整计划先单独发出，再用卡片批准执行或附意见继续规划，原任务自动续跑。

## 30 秒上手

**前置条件（先装好本体，再装遥控器）**：

1. **DeepSeek Harness（`dsh`）已安装并配置好 `DEEPSEEK_API_KEY`** —— dsh-lark-bot 是 dsh 的插件，dsh 才是 agent 本体，缺一不可；
2. **Node.js ≥ 22.19**（见 `package.json` engines）与一个飞书 / Lark 账号。

**三步上线**：

```bash
# ① 一键安装（无需先全局安装任何东西；自动装进 dsh profile，并默认同时安装「安全网守护」）
npx dsh-lark-bot@latest setup --profile dsh-lark

# ② 启动
dsh --profile dsh-lark
```

③ 首次启动终端打印二维码 → 飞书 / Lark App 扫码创建或选择 PersonalAgent 应用 → 绑定后私聊直接发消息；群聊 / 话题默认 `@bot`，也可显式开启受白名单保护的无 @ 模式。

卡片按钮按 Card JSON 2.0 的 `behaviors.callback` 协议发送；扫码向导会显式申请
`card.action.trigger` 回调能力。这两项都是计划、审批、问答等交互卡片按钮正常工作的
必要条件。已有应用若是在旧版本向导中创建，请在飞书开放平台的“事件与回调 → 回调配置”中启用
卡片回调后重新发布应用，否则消息收发正常但按钮点击不会送达 bot。

`setup` 自动完成：定位本机 dsh → 预批准 pnpm 构建策略 → 标准 `dsh plugin add` → 默认安装「安全网守护」系统服务，一条命令完成全部安装。

> **无需公网 IP / 域名 / 服务器 / 内网穿透**（飞书 WebSocket 出站长连接），Linux / macOS / Windows 通用。
> 已有 PersonalAgent 应用时可跳过扫码（见「配置」）：`DSH_LARK_APP_ID=cli_xxx DSH_LARK_APP_SECRET=<secret> DSH_LARK_TENANT=feishu dsh --profile dsh-lark`
> 升级同样一条命令：`npx dsh-lark-bot@latest upgrade --profile dsh-lark --yes`

## 完整使用方式

### 常用命令

在飞书里向 bot 发送普通消息即可开始工作，常用命令：

bot 自带的命令帮助、状态、错误提示与交互卡片均提供中文 / English。Card JSON 2.0 在各文本组件使用飞书原生
`i18n_content`，同一张群卡会按每位读者的客户端语言显示；无法取得读者语言的普通
Markdown、toast 与旧客户端降级路径同时显示中英文。agent 最终回答和用户原文保持原样，不自动翻译；
原始推理、工具输入输出和底层错误只保留在本机运行边界内，不进入飞书过程卡。

| 命令 | 作用 |
| --- | --- |
| `/new` `/reset` | 开始新会话|
| `/newg <群名>` | 自动新建群聊（拉你入群）并开新会话，当前会话保留|
| `/cd <path>` | 切换到该工作目录的独立会话（切回可继续）|
| `/ws list` | 查看命名工作空间|
| `/ws save <name>` | 保存当前工作空间|
| `/ws use <name>` | 切换到命名工作空间|
| `/ws remove <name>` | 删除命名工作空间|
| `/status` | 查看可刷新状态卡（工作区 / 模型 / session / run / context / token / pending / 任务账本）|
| `/doctor` | 生成脱敏诊断包并作为文件发送（管理员；可下载转发）|
| `/jobs [list\|show <消息ID>\|retry <消息ID>]` | 对账排队/运行/完成/失败/中断任务；确认后显式重试 |
| `/resume` | 查看当前会话最近上下文|
| `/session`、`/session bind <sessionId>`、`/session current` | 浏览当前 canonical workspace 的 DSH session，经披露确认后显式绑定 / 查看绑定（`web` adapter）|
| `/stop` | 终止当前任务|
| `/timeout [N\|off\|default]` | 查看或设置当前会话运行超时|
| `/concurrency [N\|default]` | 查看或设置当前 scope 并行任务数（默认 2）|
| `/permission [ask\|allow\|deny] [scope]` | 查看或设置工具权限策略（设置仅管理员；可指定当前聊天内 scope）|
| `/isolation [group\|topic\|member]` | 查看或设置本群会话隔离模式（设置仅管理员）|
| `/role list`、`/role show <id>` | 查看角色列表 / 详情|
| `/role set <id>`、`/role clear` | 为当前 scope 绑定 / 解除角色|
| `/role save <id> <name> [--persona 文案] [--model <id>] [--tools <csv>] [--rules 文案]` | 创建 / 更新角色（管理员）|
| `/role remove <id>` | 删除角色（管理员）|
| `/notify <scope\|chatId> <text>` | 跨会话发送通知（管理员）|
| `/notify list` | 查看 bridge 已注册的 scope|
| `/notifications [show\|off\|default\|on …]` | 配置当前 scope 的完成 / 失败 / 审批提醒，或恢复 Web 默认值|
| `/replies [show\|default\|set …]` | 配置当前 scope 的回复合并、发送间隔、批量上限与近似去重（profile 管理员或当前群管理员可修改）|
| `/retention [N\|default]` | 查看或设置保留消息条数（超出自动归档）|
| `/archive [note]`、`/archive send <id> [scope\|chatId]`、`/archive list [N]`、`/archive clean` | 归档并发送 / 重发到当前或指定会话（跨会话仅管理员）/ 查看 / 清理|
| `/density [compact\|standard\|detailed]` | 查看或设置卡片密度|
| `/mode [quick\|balanced\|deep]`（兼容 `/effort`） | 用卡片或命令切换当前会话任务强度；下一轮生效 |
| `/model`、`/providers`、`/provider`、`/key` | 打开交互式管理卡片（模型直接点选/恢复默认；管理写操作走多轮向导）|
| `/model use <provider/model>` | 热切换当前会话模型（也兼容唯一模型 ID；下一轮生效，无需重启）|
| `/model default <id>` | 写入 dsh 默认模型 `agent-default-model`（管理员）|
| `/model add\|remove <provider> <modelId>` | 添加 / 删除 provider 的模型（管理员）|
| `/provider add\|update\|remove <id>` | 管理 provider（管理员；deepseek-official 与自定义 pi-ai）|
| `/key set\|remove\|list <引用名>` | 管理 dsh 凭据（set / remove 需管理员）|
| `/ask <问题>` | 发送问答卡，回答写入会话上下文|
| `/invite user\|admin\|group <id>`、`/invite list`、`/invite remove user\|group <id>` | 管理访问白名单（写操作需管理员）|
| `/help` | 查看帮助|

飞书消息中的图片会下载到本地 media 目录并传给 dsh；文本类文件会读取内容并注入任务上下文。

**DSH session 消息级同步（`web` adapter）**：发送 `/session` 只会列出当前 canonical workspace
的非 subagent session 元数据，不显示正文；选择后确认卡会列明标题、ID、workspace、更新时间、
回填数量、当前 scope，以及是否替换/独占迁移。只有确认后才发送有数量和字节双重上限的历史
transcript 卡并持久绑定。私聊允许已授权用户；member scope 仅本人；共享 group/topic 仅 profile
管理员；跨 scope 独占迁移也仅 profile 管理员。WebUI 或 dsh-TUI 的 open/resume/activity **永远不会**
自动切换飞书绑定，也不会广播给所有 scope。绑定后，DSH `session/event` 是唯一真源：外部用户消息
镜像为带来源的 bot 消息，assistant chunk 节流更新同一张 bot-owned 卡，最终消息原位终态化；更新
失败才追加增量。bridge 以持久 seq cursor 重连补齐，并用 message ID / event seq / prompt `rpcId`
抑制飞书回显；tool/thinking 默认不投影。状态位于 profile 的 `session-projections.json`（0600），包含
路由、待确认历史水位/cursor、当前 turn 来源和消息映射；仅为跨重启续写流式卡保存其未终态正文，
不复制完整 transcript。历史确认完成前 live 事件保持串行等待，发送失败会在启动/重连时重试。
新投影卡使用稳定的飞书 `uuid` 幂等创建，覆盖发送成功但 cursor 尚未落盘时的崩溃重放。

**`/newg <群名>`**：自动新建私密群、拉发送者入群并回复群链接——新群即新 scope / 新会话，当前会话不受影响。需应用具备 `im:chat` 与 `im:chat.members:write_only` 权限。

同一 scope（私聊 / 群聊 / 话题）默认 **2 个任务并行**（`DSH_LARK_SCOPE_CONCURRENCY` 或 `/concurrency` 调整）：多条消息以独立 run 并行推进，每个 run 使用独立 dsh session 与 runId；SDK runtime 以 `scope + workspace` 为取消域，同一 scope 的并发 session 也会切到独立 runtime，因此卡片停止只影响该 run，`/stop` 只终止当前 scope 的全部运行，不会误停其他群。`/status` 查看当前 workspace 的 run，`/new` 只停止当前 workspace。

**会话状态卡**：`/status` 展示工作区、有效模型、session、显式投影绑定/cursor、active runs、版本、上下文占用、
累计 input / output / cache token，以及待审批 / 待提问 / 待批准计划；点击“刷新”会原位更新同一张卡。
只展示 adapter 或模型目录明确提供的数据：ACP 可提供真实 context `used / size` 与累计 token，
SDK 可提供每次模型调用的 token/cache 用量；上游未提供的字段显示“暂无”，不按文本长度估算。
累计用量随 scope 持久化；最近的 context 快照按 canonical provider/model 与 native session 分别保留，
并行 run 不会互相覆盖，当前身份不匹配时也不会复用旧占用值。会话与指标按 `scope + workspace`
持久化；`/cd` / `/ws use` 会中断原工作区仍在运行的任务，但不会删除其会话、指标或归档，切回即可
继续；只有 `/new` / `/reset` 清空当前 workspace。待处理卡与归档列表/清理也只统计当前 workspace。
成员 scope 的刷新只允许 owner 操作。

**消息与任务可靠性**：普通 agent 消息以飞书 `messageId` 去重，先原子写入 profile 的
`jobs.json`（0600）再进入内存队列。进程重启后，尚未开始的 queued 消息自动回到原 scope、thread
与 workspace；崩溃时已 running 的任务会转为 interrupted，保留最后安全阶段、run/native session
标识，但不会自动重复可能已有外部副作用的操作。用 `/jobs` 对账、`/jobs show <消息ID>` 查看，确认后
再 `/jobs retry <消息ID>`。`/status` 和重连提示会显示当前 workspace 的账本统计。保证范围从 bridge
已经收到并成功落盘开始；断网期间飞书从未投递给 bridge 的事件无法由本地账本恢复。
若首次落盘失败，bot 会明确回复“未接收/未执行，请重发”；若执行前 running receipt 失败，任务不会
启动，并明确落为 failed 或保留 queued 等待重启恢复。终态落盘失败也会提示对账；残留 running 会在
出站通道就绪后安全标为 interrupted，中断通知失败会跨启动继续投递。

**群聊会话隔离**：管理员可用 `/isolation group|topic|member` 在“整群共享 / 话题独立 /
成员独立”之间切换；默认 `topic` 保持既有行为。切换只改变后续消息的 scope 路由，不迁移或
删除已有会话，切回即可继续；切换前已发出的停止 / 审批 / 问答卡仍绑定原 scope，`/stop` 也会
覆盖当前成员可达的切换前 scope。成员模式的任务卡会显示发送者 open_id，避免误把别人的上下文
当成当前对话。策略持久化在 `~/.dsh-lark/profiles/<profile>/isolation.json`。

**多角色 Agent**：管理员用 `/role save <id> <name> --persona <文案> [--model <id>] [--tools <csv>] [--rules <文案>]` 定义 PM / 开发 / 文档等角色，`/role set <id>` 绑定到当前 scope；每个 run 携带角色 persona 与规则，角色模型低于每会话 `/model use`。角色定义持久化在 `~/.dsh-lark/profiles/<profile>/roles.json`。

**多机器人实例与 @ 交接**：

```bash
dsh-lark-bot bot add reviewer --model gateway/review-model # 无凭据参数时扫码创建独立 PersonalAgent
dsh-lark-bot bot list
dsh-lark-bot bot status reviewer
dsh-lark-bot bot remove reviewer                       # 保留会话/工作树数据
```

每个实例使用独立的 bridge profile、`dsh-lark-<name>` profile、
`~/.dsh-lark/bots/<name>/dsh` DSH_HOME、OS 用户服务、飞书与 provider 凭据、模型目录、
session/scope/worktree/archive；添加/移除不会重启其他实例。可在执行 `bot add` 时为当前进程设置
该实例专用的 `DEEPSEEK_API_KEY`；自定义 provider 凭据可在实例启动后通过 `/key set` 写入独立凭据库。
连接后，本机共享的
`fleet.json` 只把已登记 bot open_id 视为可信 peer。agent 获得 peer 的精确 open_id，可用
`lark_notify` 在当前群真实 @ 对方并附交接摘要；未知 bot、未 @、system/anonymous 消息不进入 agent，
bot 发来的 `/...` 也只作为任务文本。共享 `handoffs.json` 对 messageId 去重并在全 fleet 统计连续
交接，默认 6 轮；任一新鲜真人消息（即使未 @）立即重置。成员隔离群中的 bot 交接使用该实例的
group/topic scope，避免生成无人可操作的 bot-owned 审批卡。额外实例由自己的 service 常驻；默认
guardian 仍只救援其配置的主实例。
`default` 主机器人不能通过 `bot remove` 删除，避免附加实例管理误伤既有机器人。
附加实例仅支持各自隔离 runtime 的 `sdk` / `acp`（以及 legacy `headless`）；`bot add` 与运行时都会
拒绝 `web`，因为共享 Web agent 的广播事件流无法提供实例级 session 隔离。

**出站 @ 提及与跨会话通知**：`/notify <scope|chatId> <text>` 可向其他会话推送汇报（管理员）；agent 侧内置 `lark_notify` dsh 工具（SDK / ACP runtime 均可装配），任务完成后主动向其他群 / 话题发消息并 @ 成员。回调走 127.0.0.1 本地端口 + 随机 token，不暴露公网。

**可配置主动提醒**：Web 设置默认关闭、不刷屏，也可为未单独设置的会话选择“完成与失败”或“全部”。普通用户可用 `/notifications on current` 覆盖当前 scope，默认 @ 自己并在审批等待 10 分钟后只提醒一次；可用 `events=`、`mentions=`、`remind=` 调整。管理员还可把目标设为已登记的其他 `scope|chatId`。偏好原子持久化到 profile，重启不丢，并在 `/status` 显示；`/notifications off` 显式关闭，`/notifications default` 恢复 Web 默认值。

**回复流量控制**：默认保持即时逐条回复。profile 管理员或当前群的群主/群管理员可用 `/replies set merge=5 batch=3 interval=10 dedupe=60` 为当前 scope 开启 5 秒合并窗口、每条合并最多 3 个任务、两批至少间隔 10 秒，并在 60 秒内抑制同一发送者在同 workspace 的近似重复任务；超出批量上限的答案在 bridge 进程存活期间继续排队，不会因批量上限被丢弃。`/replies` 与 `/status` 显示有效策略，`/replies default` 恢复默认。

**任务执行模式**：发送 `/mode` 可用双语卡片选择 `quick`（快速：直接回答，只做必要检查）、`balanced`（平衡：兼顾速度与可靠性，默认）或 `deep`（深度：充分调查并验证假设与结果）；也可直接发送 `/mode quick|balanced|deep`，`/effort` 是等价别名。选择按隔离 scope 持久化并显示在 `/status`。每个 run 启动时固化模式，因此切换只影响下一轮，不会中断当前任务、清空上下文或绕过权限/计划审批。

**结果文件直接回传**：SDK / ACP / Web agent 可调用 `lark_send_file`，把当前会话 workspace、实际执行 worktree、当前 scope 归档或实例日志中的文件直接上传到原飞书聊天 / 话题；普通 `/archive [note]` 会在落盘后立即发送 Markdown + JSONL，失败时保留路径并可用 `/archive send <id> [scope|chatId]` 重试或由管理员转发到指定会话。上传只接受普通文件，默认单文件不超过 20 MiB；真实路径必须位于 bridge 计算的会话目录内，runtime 自报 cwd 不能扩大边界。

**逐操作审批与 scope 权限策略**：默认 SDK 与 Web 宿主在 `tools/pre-execute` 强制拦截高风险调用，并接入 dsh rc.8 官方 `approval/request` seam；ACP 走原生 `session/request_permission`。默认 `ask` 会弹出“允许执行一次 / 拒绝”卡。管理员可用 `/permission allow` 对当前隔离 scope 自动放行逐工具审批，或用 `/permission deny` 直接拒绝并向聊天给出明确反馈；`/permission ask` 恢复逐次询问。member 隔离下可从目标 `/status` 复制 scope，执行 `/permission <策略> <scope>`；只允许修改当前聊天内 scope。策略成功落盘后才确认，持久化到 profile 的 `permission-policies.json`（0600），重启不丢，且显示在 `/status`。该策略不绕过较大/高风险任务的计划门禁；legacy `headless` 不具备工具回调能力。

**关键任务计划门禁**：SDK / ACP / Web agent 在修改文件、运行脚本等较大或高风险动作前使用
`lark_request_plan_approval`；同一 turn 未获批准时，runtime pre-execute 策略会拒绝写入、删除、
移动、非只读 shell 命令与 `run_code`。一次计划批准只放行随后一次高风险调用，计划外的后续调用必须
重新确认。`date`、`pwd`、`ls`、`find`、`rg`、`git status/log/diff` 等单条
只读检查直接放行；包含串联、重定向、命令替换或未知程序的 shell 调用仍保守地走计划门禁。
bridge 先把完整 Markdown 计划作为普通消息发出，再弹出“批准，开始执行 /
继续规划”决策卡；卡内可填写修改意见。工具在等待期间阻塞且暂停空闲超时，批准后原任务自动继续；
继续规划时 agent 会收到意见、修订计划并再次请求确认。门禁无固定十分钟截止，跟随所属 run 的取消
信号；停止任务会精确取消该 session 的 pending 卡并撤回。可信部署可设置
`DSH_LARK_PLAN_GATE=off` 关闭这层独立门禁（逐工具审批仍按原策略执行）；legacy headless adapter 不具备工具回调能力。

**任务中向你提问（问答卡）**：agent 需要你拍板、确认或补充信息时，通过 `lark_ask_user` 工具弹**问答卡**（单选 / 多选 / 自由文本）。可提交卡片，也可直接回复该卡片输入任意文字；单选/多选没有合适项时，回复文字就是补充答案。系统按被回复的 card messageId 精确匹配 pending 问题，回答后任务自动继续，等待期间运行超时看门狗暂停。（与 `/ask` 的“你主动提问”方向相反。）

计划、审批与问答卡提交后会立即显示成功提示、发送一条终态确认并撤回原卡，避免按钮仍停留在聊天中造成“未生效”的误解；失效卡会返回明确错误提示，入站点击与失效原因写入结构化日志。确认或撤回失败不会影响已经提交给 agent 的决策、审批结果或答案。本地人机决策回调会以 JSON 空白流保活，避免 Node HTTP 客户端在等待 5 分钟后切断仍有效的卡片。

**安全网守护**：独立于 dsh 进程、系统级常驻的最小守护进程（systemd / LaunchAgent / Windows 启动项），默认随 `setup` 安装。dsh 正常时静默；dsh 下线或无法 boot（如第三方插件破坏 profile 组合）时自动接管飞书通道，无需命令行即可自救：

- `/safemode`：进入**仅核心安全模式**（仅 `dsh-base` + `dsh-headless` 官方核心，**不加载第三方插件**），优先 SDK 流式引擎、失败回退 headless，直接在聊天里定位 / 修复 / 禁用损坏插件；
- `/safemode plugins`：列出故障 profile 的插件清单；`/safemode status`：查看状态；`/safemode stop`：终止当前安全任务（或点卡片 ⏹）；`/safemode exit`：重启完整 profile 并交还通道。

安全模式任务有**空闲超时**（`DSH_LARK_GUARDIAN_SAFE_TIMEOUT_MS`，默认 10 分钟，仅持续无活动事件才终止），超时 / 失败都给出明确终态。安装：

```bash
# 随 setup 默认安装；已安装后也可单独安装 / 重装：
dsh-lark-bot guardian install --dsh-profile dsh-lark
```
不需要时 `setup --no-guardian` 跳过；单独卸载用 `dsh-lark-bot guardian uninstall`。

**正常引擎后台服务（issue #23）**：安装仍只有 `setup` 这一条路径；如需登录后自动运行、退出终端
仍在线，可再用一条命令把同一个标准 dsh profile 交给系统用户服务托管（不会启动第二套桥接引擎）：

```bash
dsh-lark-bot service install --profile dsh-lark
dsh-lark-bot service status --profile dsh-lark
dsh-lark-bot service logs --profile dsh-lark -n 200 -f
dsh-lark-bot service restart --profile dsh-lark
dsh-lark-bot service stop --profile dsh-lark
dsh-lark-bot service start --profile dsh-lark
dsh-lark-bot service uninstall --profile dsh-lark
```

Linux 优先使用 systemd user unit，无 user systemd 时回退 XDG supervisor；macOS 使用 LaunchAgent，
Windows 使用登录计划任务。服务异常退出会自动重启，`doctor` 会报告已安装服务的状态。guardian
发现正常引擎掉线时会优先重启该受管服务，避免重复拉起；`upgrade --restart` 也走同一路径。
`stop` / `uninstall` 会持久记录“期望停止”，guardian 不会擅自拉起；install/start 若检测到同
profile 的前台进程会拒绝并提示先停止，生命周期锁阻止并发双启动。
机器睡眠或断网期间 WebSocket 无法收消息；恢复后 SDK 自动重连，并向最近活跃会话发送恢复提示。

### 模型 / Provider / 凭据管理

配置以 dsh 官方方式持久化（与 dsh Web **Settings → Models** 同一存储协议），改动下一请求生效、无需重启：

- **交互式管理卡片**：`/providers`（或 `/provider`、`/model`、`/key`）打开管理卡片；当前模型带
  ✅ 标记，可直接点选其他模型或“恢复默认”，下一轮生效且保留上下文。增删改查按
  BotFather 式的多轮向导完成——能选择的用按钮点选（API 协议、provider、模型、凭据引用），
  需要填值的用卡片输入（ID、Base URL、模型列表、密钥值），写入前有确认卡，随时可取消。
- `/model use <provider/model>`：按会话精确路由并热切换模型（也兼容唯一模型 ID，下一轮生效）；`/model default <id>`：写入 dsh 默认模型。
- `/providers`：查看 provider、模型与凭据状态；`/provider add|update|remove`：管理自定义 provider
  （需 `--api` / `--base-url` / 至少一个 `--model`，与官方 schema 一致）或 `deepseek-official`。
- `/key set|remove|list`：读写 `~/.dsh/.credentials.yaml`（0600）；settings 只存 `apiKeyEnv` 引用，
  字面密钥不进 settings / 聊天记录。
- **凭据引用必须关联**：`/key set <引用名> <值>` 只写入凭据文件；provider 要生效还须在其
  `apiKeyEnv` 字段引用同一名字（`/provider add|update ... --api-key-env <引用名>`，或向导中填写）。
  引用名与 provider ID 相同且 provider 未设 `apiKeyEnv` 时，`/key set` 会自动补关联；
  已存在的老配置在下次运行时也会自动补齐。
- **热重载**：桥接在每轮运行前把模型解析为「provider + model」路由并传给 dsh runtime；SDK 适配器
  在路由变化时自动重建 runtime（下一轮生效）。pi-ai 的 Base URL 填根域名（如
  `https://www.kingapi.xyz`）会自动补全为 `/v1`。dsh runtime 启动后需几百毫秒才注册
  pi-ai 路由，桥接会重试握手直到注册完成（避免 “no adapter registered for provider”）。

安全提醒：在飞书会话输入密钥会对可见成员暴露，建议私聊使用或 `--api-key-env` 引用环境变量；bot 不在任何回复中回显密钥值。

## 升级、禁用与卸载

### 升级

**推荐：一行命令彻底升级（v0.12.0+ 新增，issue #10）**

```bash
npx dsh-lark-bot@latest upgrade --profile dsh-lark --yes
```

`upgrade` 自动完成：检测当前已装版本 / 运行中 CLI / npm 最新版 → 升级**包本体**
（`dsh plugin add <name>@<latest>`）→ **幂等重装并重启 guardian 服务** → 升级后运行
`doctor` 验证。覆盖运行中实例的安全处理：

- 默认不打断运行中的 dsh profile，只提示重启命令（升级不影响配置 / 会话 / 凭据）；
- `--restart`：升级后自动重启 guardian 服务与（受管/后台的）dsh profile 进程；
- `--check`：只报告版本与运行状态，零改动；
- `--rollback`：回滚到上一次升级前的版本（记录在 `~/.dsh-lark/upgrade-state.json`）；
- `--force`：无法访问 npm（离线）时按当前运行版本重装；
- `--no-guardian`：跳过守护升级；
- **runtime profile 一致性修复**：升级后自动把 `dsh-lark-sdk` / `dsh-lark-acp` 的
  own-package 链接重指到新版本，并当场幂等重装版本陈旧的 SDK server / ACP 依赖。

无需交互确认时加 `--yes`（非交互环境不带 `--yes` 会安全中止）。其余方式：

- 插件本体：重跑 `setup`（或 `dsh plugin --profile <name> add dsh-lark-bot`）拉取 npm 最新版。
- 安全网守护：随 `upgrade` / `setup` 一起安装 / 升级（幂等重装），也可单独
  `dsh-lark-bot guardian install`。
- CLI 工具（可选）：`npm i -g dsh-lark-bot@latest`；使用 `npx` 时无需全局安装。
- 升级后重启 profile（未用 `--restart` 时）：`dsh --profile dsh-lark`。

### 禁用

保持插件加载但停止桥接引擎：启动 profile 前导出 `DSH_LARK_DISABLED=1`。彻底移除见下节。

### 卸载

```bash
dsh plugin --profile dsh-lark remove dsh-lark-bot
```

卸载后 profile 不再加载本插件。本地状态（配置 / 会话 / 归档 / 角色）保留在 `~/.dsh-lark`；
如需清除，先备份再删除该目录。

更详细的安装、状态目录、日志和排障说明见 [`docs/QUICK_START.md`](docs/QUICK_START.md)。

---

## FAQ（典型用例与常见问题）

### 典型用例

**Q: 出门在外，想用手机指挥本机的 DeepSeek Harness？**

**A:** 可以。安装并扫码绑定后，用飞书手机 App 发消息即可指挥本机 dsh coding agent；任务完成还能跨会话主动推送并 @ 你。安装：`npx dsh-lark-bot@latest setup --profile dsh-lark` → `dsh --profile dsh-lark` → 扫码 → 开聊。

**Q: 多个项目 / 多人协作，怎么隔离与分工？**

**A:** 每个会话自动落在独立 git worktree，项目级 `AGENTS.md` 自动注入；管理员用 `/role` 定义并绑定角色、用 `/invite` 管理白名单；同群默认 2 个任务并行（`/concurrency` 调整），`/archive` + `/retention` 控制归档与保留。

**Q: dsh 崩溃 / 掉线后，飞书机器人还能用吗？**

**A:** 能。`setup` 默认安装独立于 dsh 的「安全网守护」：dsh 崩溃时守护自动接管飞书通道并先尝试自动重启；仍失败时发 `/safemode` 进入仅核心安全模式定位 / 修复问题，`/safemode exit` 恢复完整 profile。全程不需要命令行。

### 常见问题

**Q: DeepSeek Harness 怎么接入飞书？**

**A:** 安装 Node.js ≥ 22 与 DeepSeek Harness（已配置 `DEEPSEEK_API_KEY`），执行 `npx dsh-lark-bot@latest setup --profile dsh-lark`，再 `dsh --profile dsh-lark` 扫码绑定即可。私聊直接发消息；群聊 / 话题默认 `@bot`，也可按下文的权限与白名单要求开启无 @ 模式。

**Q: 需要公网 IP、域名或服务器吗？**

**A:** 不需要。飞书通道使用 WebSocket 长连接（出站连接），本机在 NAT 后面也能用，免公网服务器、免域名、免内网穿透。

**Q: dsh-lark-bot 和其他 DeepSeek Harness 飞书插件（如 harness-lark）有什么区别？**

**A:** 功能组合最全：安全网守护、多角色 Agent、多机器人可信交接、并行多任务、持久任务对账、会话归档、跨会话主动通知、dsh Web 可视化设置、对话内模型 / 密钥管理、执行模式与关键任务计划门禁十一项合一；标准 dsh profile bundle，`setup` 是唯一安装路径；可选 `service install` 只负责把同一 profile 交给 OS 常驻，不是第二套运行时。

**Q: 项目从哪下载？会不会有假冒版本？**

**A:** 唯一官方仓库是 [github.com/PlutoKeating/dsh-lark-bot](https://github.com/PlutoKeating/dsh-lark-bot)，唯一官方 npm 包是 `dsh-lark-bot` / `dsh-feishu-bot`（维护者 `plutokeating`）。本项目从不提供 .exe 或“下载即运行”的安装包；任何以项目名义分发 exe 的仓库或页面都是假冒来源，请勿运行（详见文末「假冒仓库警告」）。

---

## 关键词

`dsh` · `deepseek` · `deepseek harness` · `feishu` · `lark` · `bridge` · `bot` ·
`chatbot` · `messaging` · `qrcode` · `typescript` · `feishu-bot` · `lark-bot` ·
`dsh-plugin` · `deepseek-harness` · `im-bridge` · `ai-agent` · `workspace` · `self-healing`

## 兼容性

- **DeepSeek Harness（`dsh`）**：已验证 **dsh 0.1.0-rc.8**（最后验证 2026-08-22：临时安装 + SDK JSON-RPC / ACP runtime initialize、工具/审批、live session 续接与 restart collision 探针），通过官方 `@deepseek-ai/dsh-sdk-client` / `@deepseek-ai/dsh-acp` 接入；
  具体锁定版本、升级政策与自动化探测见 [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)，
  adapter 接入细节见 [`docs/adapter-notes.md`](docs/adapter-notes.md)，rc.8 差异、已知风险和
  自动/人工验证边界见 [`docs/DSH_RC8_AUDIT.md`](docs/DSH_RC8_AUDIT.md)。
- **运行时**：Node.js ≥ 22.19（见 `package.json` engines）。
- **平台**：Linux / macOS / Windows（飞书 WebSocket 出站长连接，免公网服务器 / 域名 / 内网穿透）。
- 默认 adapter 为官方 **`@deepseek-ai/dsh-sdk-client`**（SDK JSON-RPC runtime，原生 session 续跑 +
  token 级流式事件）；`DSH_LARK_ADAPTER=acp` 切到官方 **ACP server**（审批卡）；`headless` 保留旧版
  子进程 fallback；`DSH_LARK_ADAPTER=web` 驱动**本地 dsh web agent**（`session.prompt` +
  `/api/events.mux`，网页端成为唯一写者，从根上消除多写者会话损坏）。首次启动自动在
  `~/.dsh/profiles/dsh-lark-sdk`（或 `dsh-lark-acp`）创建 runtime profile。

## 已知限制

- ACP 模式会话每次全新（上游限制，无续跑）；SDK 协议暂无 mid-turn cancel，停止操作会关闭
  该 run 所属的隔离 runtime 并自动重建，不会关闭其他 scope 或并发 run 的 runtime。SDK 只在当前
  bridge 进程仍持有同一个 live runtime 时原生续接 session；进程重启、停止或模型切换后会主动
  新建 session 并回放 bridge transcript，避免把旧 ID 交给 rc.8 新 runtime 触发 `id collision`。
- 桥接引擎作为 dsh 插件在 dsh 进程内运行，agent 执行使用官方 dsh SDK runtime 子进程
  （嵌套 runtime 是有意取舍，用于按 scope + workspace 隔离取消域与并行 run）。
  唯一的进程级例外是默认安装的「安全网守护」——它独立于 dsh / Cordis 常驻，仅在 dsh
  下线后接管飞书通道，正常运行时保持静默。
- 飞书文档评论、富文本回复为规划中能力，尚未实现。
- pnpm ≥ 10 的构建脚本策略由 `setup` 自动处理；手动 `dsh plugin add` 时若报
  `ERR_PNPM_IGNORED_BUILDS`，按官方指引在 profile 的 `pnpm-workspace.yaml` 加
  `allowBuilds: { protobufjs: true }` 后重试。

## 配置

### dsh Web 可视化设置（推荐）

打开本机 dsh Web，进入 **Settings → Plugins → Plugin configuration → dsh-lark-bot**。页面可直接查看和修改服务区域、App ID、App Secret、默认项目文件夹、默认模型、每会话并行任务数、adapter 与默认提醒策略：

- App Secret 标记为 secret，只能写入，Web 响应、卡片和日志都不会回显；扫码绑定后实际生效的 profile 会作为页面初始值，App ID 不会错误显示为空。
- 点击“保存设置”后，凭据、区域、工作目录和 adapter 会安全停止旧 generation 后自动重连；模型、并行数和提醒会热更新到下一任务/提醒，不中断正在执行的任务，页面逐项标明时机。
- “快速诊断”可在本页直接检查设置连接、App ID、工作目录、模型和远程只读状态；需要运行态详情时可继续复制 `/status` 或 `/doctor` 到飞书会话。
- 浏览器半侧由本包的 `./client` 动态加载并注册到官方插件配置页，不需要 fork 或重建 dsh Web。没有 Web 设置服务时，现有飞书命令和下列环境变量仍可使用。

- 本地配置：`~/.dsh-lark/config.json`
- 状态根目录可用 `DSH_LARK_HOME` 覆盖
- 环境变量统一使用 `DSH_LARK_*` 前缀
- 模板见 [`.env.example`](.env.example)
- 敏感项：`DSH_LARK_APP_SECRET`、`DEEPSEEK_API_KEY` 等凭据只保存在本机配置 / 环境中，日志与
  卡片自动脱敏，仓库只提交 `.env.example` 模板。

会话运行在 Git 仓库中时，会自动在 `~/.dsh-lark/profiles/<profile>/worktrees/<scope-slug>-<path-hash>/` 创建隔离 worktree，并复制项目级 `AGENTS.md`。升级时会先从 Git registry 核验旧版 `<scope-slug>` worktree 的 owning repo：会话与旧 retention 归档归回真实项目，匹配时原位迁移并保留分支与未提交文件；当前指针已切到其他项目时则保留旧树并为新项目独立建树。

每个飞书 scope 默认保存最近 40 条对话消息（可用 `/retention` 或 `DSH_LARK_RETENTION_MSGS`
调整）；超出保留窗口的消息自动归档到 `~/.dsh-lark/profiles/<profile>/archives/`（Markdown +
JSONL，目录本身是 Git 仓库，每次归档独立 commit），支持 `/archive` 对当前 workspace 手动归档、
查看与执行保留策略清理。
SDK 模式下 dsh 原生 session 续跑，headless 模式则把历史注入下一次 prompt 实现近似记忆。

当前核心环境变量：

| 变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `DSH_LARK_HOME` | `~/.dsh-lark` | 本地状态根目录|
| `DSH_LARK_TENANT` | `feishu` | `feishu` 或 `lark`|
| `DSH_LARK_WORKSPACE` | 未设置 | 新会话默认工作目录|
| `DSH_LARK_DSH_COMMAND` | `自动发现` | dsh 启动命令；通常无需设置|
| `DSH_LARK_DSH_ARGS` | `自动发现` | dsh 启动参数，逗号分隔；通常无需设置|
| `DSH_LARK_ADAPTER` | `sdk` | `sdk`（默认，approval answerer）/ `acp`（协议原生审批）/ `headless`（legacy）/ `web`（本地 dsh web agent，单写者）|
| `DSH_LARK_PROVIDER` | `deepseek-official` | 模型 provider|
| `DSH_LARK_MODEL` | `deepseek-v4-flash` | 默认模型|
| `DSH_LARK_MAX_TOKENS` | 未设置 | SDK agent 每请求输出 token 上限|
| `DSH_LARK_WEB_URL` | `http://127.0.0.1:3080` | `web` 适配器：本地 dsh web agent 的 base URL|
| `DSH_LARK_SESSION_PROJECTION` | `true` | `web` 适配器：启用用户显式绑定后的历史/实时消息投影；绝不自动切换（`0` 关闭）|
| `DSH_LARK_SESSION_BACKFILL_MESSAGES` | `20` | 确认绑定时最多回填的人类消息数|
| `DSH_LARK_SESSION_BACKFILL_BYTES` | `65536` | 一次历史 transcript 卡最多披露的 UTF-8 字节数|
| `DSH_LARK_SESSION_STREAM_UPDATE_MS` | `800` | 同一 assistant 投影卡的最小更新间隔（最小 400ms）|
| `DSH_LARK_WEB_PUSH` | 未设置 | 已弃用兼容别名；仅当新开关未设置时作为 `DSH_LARK_SESSION_PROJECTION` 读取|
| `DSH_LARK_ACCESS_DEFAULT_DENY` | `false` | 无白名单时拒绝私聊|
| `DSH_LARK_EVENT_FRESHNESS_MS` | `600000` | 过期消息拒绝窗口（0 关闭）|
| `DSH_LARK_GROUP_NO_AT` | `false` | 处理白名单实时无 @ 消息并轮询已登记群聊历史；要求 `im:message.group_msg` 权限和非空 `allowed_users` |
| `DSH_LARK_GROUP_POLL_MS` | `3000` | 无 @ 群消息轮询间隔（毫秒，最小 1000）|
| `DSH_LARK_BOT_HANDOFF_MAX` | `6` | 本机可信机器人连续 @ 交接上限（最小 2；真人消息重置）|
| `DSH_LARK_RUN_TIMEOUT_MS` | `300000` | 单次运行空闲超时：持续无活动事件才终止（活跃任务不会被误杀）|
| `DSH_LARK_STOP_GRACE_MS` | `5000` | SIGTERM 后等待优雅退出再 SIGKILL 的宽限期|
| `DSH_LARK_SCOPE_CONCURRENCY` | `2` | 每个 scope 的并行任务数（1=严格串行）|
| `DSH_LARK_NOTIFICATION_DEFAULT` | `off` | 未设置 scope 覆盖时的主动提醒：`off` / `completed`（完成+失败）/ `all`（含审批）|
| `DSH_LARK_RETENTION_MSGS` | `40` | 每个 scope + workspace 保留的消息条数（0=全部保留）|
| `DSH_LARK_ARCHIVE_MAX` | `50` | 每个 scope + workspace 最多保留的归档数（0=不清理）|
| `DSH_LARK_ARCHIVE_MAX_AGE_DAYS` | `90` | 归档最大保留天数（0=不清理）|
| `DSH_LARK_HEARTBEAT_MS` | `5000` | 桥接引擎心跳写入间隔（守护存活信号）|
| `DSH_LARK_GUARDIAN_DISABLED` | `false` | `1` 时安全网守护进程保持停止|
| `DSH_LARK_GUARDIAN_PROFILE` | `dsh-lark` | 守护监视 / 重启的 dsh profile（首次安装时写入状态）|
| `DSH_LARK_GUARDIAN_BRIDGE_PROFILE` | `default` | 提供飞书凭据与白名单的桥接状态 profile|
| `DSH_LARK_GUARDIAN_POLL_MS` | `2000` | 守护看门狗轮询间隔|
| `DSH_LARK_GUARDIAN_STALE_MS` | `15000` | 心跳超时阈值，超过且无 dsh 进程则接管飞书通道|
| `DSH_LARK_GUARDIAN_ENGINE_DEAD_MS` | `120000` | dsh 进程存活但心跳持续超时该时长，判定桥接引擎已死并接管|
| `DSH_LARK_GUARDIAN_SAFE_ADAPTER` | `auto` | 安全模式引擎：`auto` 优先 SDK 流式、失败回退 headless；`sdk` 强制 SDK；`headless` 跳过预置|
| `DSH_LARK_GUARDIAN_SAFE_TIMEOUT_MS` | `600000` | 安全模式单任务空闲超时（持续无活动事件才停止并出超时卡）|
| `DSH_LARK_GUARDIAN_CARD_DENSITY` | `detailed` | 安全模式任务卡片密度（compact / standard / detailed）|
| `DSH_LARK_UPGRADE_REGISTRY` | `https://registry.npmjs.org` | `upgrade` 探测最新版本的 npm registry（可指向镜像）|
| `DSH_LARK_UPGRADE_CHECK` | `1` | `doctor` / `/version` 是否探测 npm 最新版本（`0` 关闭，best-effort）|
| `DSH_LARK_UPGRADE_CHECK_INTERVAL_MS` | `21600000` | 桥接引擎检查新版本的间隔（`0` 关闭，默认 6h）|
| `DSH_LARK_UPGRADE_NOTIFY` | `false` | `true` 时发现新版本向指定 chat 推送飞书通知（默认仅日志）|
| `DSH_LARK_UPGRADE_NOTIFY_CHAT` | — | 接收更新通知的 chat id（配合 `DSH_LARK_UPGRADE_NOTIFY=true`）|

启动时会自动查找本机常见的 `@deepseek-ai/dsh` 安装位置。只有自动发现失败或需要指定特殊 profile 时，才需要设置这两个变量。

## 权限与数据

本工具在**本机**运行，安装前请知悉它会访问：

- **飞书凭据**：PersonalAgent 应用的 `app_id` / `app_secret`，明文写入本机 `~/.dsh-lark/config.json`（文件权限 600）。
- **多机器人身份与消息**：`fleet.json`（0600）保存实例名、dsh/bridge profile、独立 DSH_HOME、bot open_id/名称，不保存密钥；
  `handoffs.json`（0600）保存 chat id、最近交接 message id 与轮数。只有已登记 peer 的真实 @ 消息会进入
  agent；已登记 peer 的 name/open_id 会注入每轮 agent prompt 并随任务上下文发送给模型 provider，
  以便生成精确 @ 交接。交接提示、卡片和回复仍发送到共享群，对群成员可见。移除实例会删除其
  飞书配置凭据、独立 `.credentials.yaml` 与 service env；DSH_HOME 中的 provider 设置/runtime
  session 默认保留以便恢复，
  默认保留 `profiles/<name>/` 会话/工作树；需要删除这些数据时由用户另行处理。
- **文件系统**：读取 / 写入你通过 `/cd`、`/ws` 指定的工作目录（含执行 shell 命令、修改文件）。
- **网络**：向飞书开放平台建立 WebSocket 出站长连接收发消息；向 DeepSeek API 发送任务上下文。
- **群消息与可选历史**：为识别“直接回复问答卡”，群实时事件先进入 bridge，再由 bridge 忽略未 @ 且未命中 pending 卡的消息。仅当 `DSH_LARK_GROUP_NO_AT=true` 时，实时无 @ 消息会进入任务管线，并轮询曾经通过事件登记的群聊 / 话题；两条路径都只处理白名单真人消息（及可选群白名单），历史消息还须为启动后的未删除消息，并与实时事件按 message ID 去重。该模式需管理员授予 `im:message.group_msg` 权限并确认符合团队隐私政策。
- **成员隔离标识与群可见性**：`member` 模式把发送者 `open_id` 写入本机 `isolation.json` 派生的
  session / scope directory / worktree / archive 索引或路径，并显示在共享群任务卡。它只隔离 agent
  上下文，不隐藏群消息：输入、进度卡与回复仍对群成员可见；其他成员不能操作该成员的任务卡。
- **本地会话用量**：adapter 上报的 input/output/cache token 与 context used/limit 随 scope 写入
  `~/.dsh-lark/profiles/<profile>/sessions.json`（0600），并显示在 `/status` 卡；成员 scope 仅 owner
  可刷新，但群内已经发送的状态卡仍遵循共享群消息可见性。
- **诊断包**：管理员可在会话发送 `/doctor`，bridge 在内存中生成 Markdown 文件并上传到原聊天 /
  话题；包含版本、平台、非敏感配置计数、当前 workspace 的运行/pending/任务账本摘要、服务状态与
  当前 bridge 进程内有界最近结构化事件（不读取 dsh 宿主共享 stdout）。不包含 App ID/Secret、凭据值、消息正文或 session transcript；常见密钥形态、
  当前进程已知敏感环境值及主目录会再次脱敏。文件一旦发到群中即对群成员可见，建议在私聊生成并在
  转发前人工复核。生成等待有超时边界，底层服务命令也会被有界终止；上传等待超时时会明确提示
  结果未知及文件可能迟到，避免用户立即重试造成重复投递。
- **持久任务账本**：`profiles/<profile>/jobs.json`（0600）保存 bridge 已接收任务的原始消息正文、
  附件/提及元数据、chat/thread/scope、workspace、状态与安全 checkpoint，最多保留 500 条终态记录。
  `/jobs` 输出会脱敏并按当前 scope + workspace 隔离；文件内容与 `sessions.json` 一样可能包含用户在
  prompt 中主动提供的敏感文本，应保护 profile 目录并在分享前清理。账本不保存隐藏推理或工具参数。
- **scope 路由**：`scopes.json` 保存 chat/thread 与最近入站 messageId；messageId 仅用于把 agent
  后续问答卡作为 reply 正确发回原话题。
- **本地回调**：运行 `lark_notify`、`lark_send_file`、`lark_ask_user`、`lark_request_plan_approval` 或逐工具审批时，dsh
  runtime 子进程通过 `127.0.0.1` 随机端口 + 每启动随机 token 回调 bridge 进程（仅本机回环，
  不监听公网）；等待人工回答的回调会立即发送响应头，并用 JSON 空白心跳维持连接，避免 Node 默认的
  5 分钟 HTTP 空闲边界中断审批。计划内容、待执行工具的理由/参数与决策卡会发送到当前飞书 / Lark 会话。
  群聊中的审批内容对群成员可见。
- **进程**：spawn 本机 `dsh` runtime 子进程（`dsh-sdk-jsonrpc-server` / `dsh-acp` profile）执行 agent 任务。
- **dsh 配置**：`/model` `/providers` `/provider` `/key` 命令按 dsh 官方存储协议读写
  `~/.dsh/settings.yaml` 与 `~/.dsh/.credentials.yaml`（仅管理员可写；settings 只存 `apiKeyEnv`
  引用，凭据文件权限 0600、目录 0700，字面密钥不进入 settings 或聊天记录）。
- **安全网守护（默认随 `setup` 安装）**：系统级常驻进程，读取 `~/.dsh-lark/config.json` 中的飞书
  凭据；dsh 下线时接管同一 bot 的飞书长连接并扫描本机进程（仅 `ps` 命令行，不读内存）；
  `/safemode` 时创建仅官方核心的 dsh profile（headless 或 SDK JSON-RPC runtime，均无第三方插件）
  并逐条执行任务；SDK 引擎会以官方 `dsh-sdk-jsonrpc-server` 子进程提供实时流式事件。
- **正常引擎后台服务（可选）**：`service install` 将标准 `dsh --profile <name>` 交给当前用户的
  systemd / launchd / Windows 计划任务托管。服务环境只按白名单快照到
  `~/.dsh-lark/service/<profile>.env`（POSIX 0600；Windows owner-only ACL）；plist / 计划任务不嵌入密钥。日志写入
  `profiles/<profile>/logs/service.log`。`service uninstall` 删除系统入口与 env 快照，但保留配置、会话与日志。

所有数据仅在本机与飞书、DeepSeek 之间流转，不收集、不上传任何遥测。密钥不会提交进仓库（见 `.gitignore`）。

## 排障

先运行 `dsh-lark-bot doctor`，它会检查 profile、工作目录，并对当前 adapter 做真实可用性探测
（`sdk` / `acp` / `headless` 对应 runtime 的初始化握手）；启用无 @ 群消息后，还会使用一个已登记群聊探测历史消息权限。
无法接触终端时，管理员可直接在飞书发送 `/doctor` 获取可下载的脱敏诊断包；聊天版为运行态快照，
不会另起 adapter 做破坏性探测，终端版仍是完整可用性检查。

常见问题：

- **bot 静默 / 长连接失败**：运行 `service status` 并查看 `service logs -f`（前台运行则看 stderr），关注 `channel` 与 `channel-command` 类别；SDK 会自动重连并在恢复后向最近活跃会话提示。系统睡眠期间不能接收消息。
- **agent 无响应**：发送 `/status` 查看当前 scope、cwd 和 active run；发送 `/stop` 终止当前任务；持续无响应超过 `DSH_LARK_RUN_TIMEOUT_MS` 时看门狗会自动终止（空闲超时，活跃任务不会被误杀）。
- **首次扫码失败**：确认本机时间准确、网络可访问飞书开放平台；已拿到 App ID/Secret 时可用 `--app-id` / `--app-secret` 跳过扫码。

桥接引擎日志以 JSON Lines 输出到 stderr（由 dsh 宿主进程捕获；`logs/bot.log` 是 0.6.0
独立服务时代的遗留路径，0.7.0 起不再写入）；dsh 宿主日志走 dsh 自己的日志体系。

**回滚**：`dsh plugin --profile dsh-lark remove dsh-lark-bot` 后重装固定版本即可
（如 `dsh plugin --profile dsh-lark add dsh-lark-bot@0.6.0`）；`~/.dsh-lark` 状态独立于插件
本体，升级 / 回滚不会丢失配置与会话。

## 开发

**dsh-TUI 兼容边界**：本包以唯一根 `dsh-plugin.json` 声明 v0.15 host facet，并在构建后运行
`pnpm check:tui-admission` 与真实 PTY `pnpm check:tui-tty`。可选 TUI seam 缺失时安全 no-op；同步
仍只依赖 DSH history/event，不监听 TUI input/session switch。该 facet 为 `trusted-in-process`，
不是安全沙箱。项目继续采用 GNU AGPLv3；生态 listing 不改变许可证，也不代表兼容认证、安全审查
或官方背书。

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm check:publish-bundle   # 校验 dist 与全部 exports/bin 入口一致（发布前防线）
pnpm ci:local
pnpm release:check   # ci:local + 上游一致性检查
pnpm compat:probe    # 临时安装锁定版 dsh，验证 SDK/ACP 握手及 SDK 工具/续接
pnpm dsh:upstream    # 对比 npm 上游 stable 与锁定矩阵
pnpm security:monitor # 假冒仓库与仿冒包监控（建议每周）
```

开发规范见 [`AGENTS.md`](AGENTS.md)，模块契约见 [`docs/API.md`](docs/API.md)，架构见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。
兼容矩阵的升级政策与自动化见 [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)。

**贡献**：欢迎 Issue 与 PR。开发流程见 [`AGENTS.md`](AGENTS.md)（必读文档、
提交规范与推送边界），生态交付标准见 [`docs/ECOSYSTEM.md`](docs/ECOSYSTEM.md)。

发布双包（`dsh-lark-bot` 与 `dsh-feishu-bot` 共享同一份 dist / 版本 / 依赖）：

```bash
pnpm publish:dual:dry-run
pnpm publish:dual
```

`scripts/publish-dual-packages.mjs` 从根 `package.json` 生成两份仅 `name` / `bin` 不同的发布清单，避免两份源码漂移。发布时整目录同步 `dist/`，并在发布前校验 `package.json` 每个 `exports` 子路径与 CLI 入口在产物中都存在——任何缺失（如 v0.9.0 的 `ask` 入口漏拷）都会直接中止发布。GitHub tag `v*` 会触发 [`release.yml`](.github/workflows/release.yml) 自动发布两个 npm 包并创建 Release。

同一份 dist 还会以 `@plutokeating/dsh-lark-bot` 和 `@plutokeating/dsh-feishu-bot` 发布到 GitHub Packages，便于在 GitHub Packages 页面查看。

## 维护与支持

- 状态：**活跃维护**。主维护者：**PlutoKeating**。
- 问题 / 建议：优先在 GitHub Issues 提交；安全漏洞请走 [`SECURITY.md`](SECURITY.md) 的私下报告渠道。

社区收录情况见下节「社区收录情况」。

## 作者

本项目由 **PlutoKeating** 开发并维护。作者专注于自动化与开发者工具，习惯从真实使用场景出发
做软件：本项目正是从“用飞书 / Lark 群聊驱动 DeepSeek Agent”的日常需求长出来的，逐步演进为
一套带守护、自愈与一键升级能力的完整桥接方案。更多信息见个人主页：
[PlutoKeating](https://github.com/PlutoKeating)。

## 贡献者

感谢以下贡献者（按合入 / 提交时间）：

| 贡献者 | 贡献 | 状态 |
| :--- | :--- | :--- |
| [koprivnikarurnaa-oss](https://github.com/koprivnikarurnaa-oss) | [PR #9](https://github.com/PlutoKeating/dsh-lark-bot/pull/9)：web 单写者适配器 + self-heal v2 + 守护自动重启| ✅ 已合入|
| [Normanyin](https://github.com/Normanyin) | [PR #11](https://github.com/PlutoKeating/dsh-lark-bot/pull/11)：`/newg` 自动建群命令| ✅ 已合入（cherry-pick）|

> 说明：GitHub 贡献者图按 commit 作者邮箱归因。PR #9 合入时的提交使用了本地通用身份
> `dsh-user <dsh-user@local>`（未绑定 GitHub 账号），因此未自动计入贡献者图；本表为仓库侧
> 的明确署名，PR #11 的提交身份已绑定其账号，合入后会自动计入。
>

## 许可与安全

- **许可证**：GNU Affero General Public License v3.0（见 `LICENSE`）。
- **版权归属**：源码版权归项目维护者所有，按 AGPL-3.0 授权；「DeepSeek」「飞书 / Lark」等
  商标归各自权利人所有。
- **安全报告**：如发现安全漏洞，请通过 GitHub Security Advisory 私下报告，勿公开 issue。
- **安全模型**：默认拒绝、密钥脱敏、路径 containment、SSRF 防护、过期事件拒绝与交互工具
  默认禁用——详见 [`SECURITY.md`](SECURITY.md)。

## 文档

> 接手本项目的工程师：**先读 [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) 和 [`docs/RESEARCH.md`](docs/RESEARCH.md)**，即可完整理解项目诉求与来龙去脉，无需线下沟通。

| 文档 | 内容 |
| :--- | :--- |
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | 完整项目诉求、产出预期、规范与约束|
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | 调研报告：官方现状、参考项目、可行性、技术差异|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 架构分层与目录映射|
| [`docs/API.md`](docs/API.md) | 模块接口与契约|
| [`docs/QUICK_START.md`](docs/QUICK_START.md) | 安装与快速开始|
| [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) | 兼容矩阵、升级政策与自动化|
| [`docs/MANUAL.md`](docs/MANUAL.md) | 完整用户手册|
| [`docs/adapter-notes.md`](docs/adapter-notes.md) | dsh adapter 接入说明（接口 / 落点 / 路线）|
| [`docs/UPGRADE.md`](docs/UPGRADE.md) | 更新链路架构审查、生效机制与已知边界（issue #15）|
| [`docs/ECOSYSTEM.md`](docs/ECOSYSTEM.md) | 生态兼容与交付标准（实现工程师必读）|
| [`docs/roadmap.md`](docs/roadmap.md) | 路线图与里程碑|
| [`docs/PLAN.md`](docs/PLAN.md) | 主线开发计划与验收标准|
| [`SECURITY.md`](SECURITY.md) | 安全模型与报告渠道|
| [`AGENTS.md`](AGENTS.md) | AI Agent 开发工作流规范|

## 架构

> 详见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

```
飞书 / Lark ──WebSocket 长连接──▶ bridge/ ──▶ session/ ──▶ workspace/ ──▶ adapters/ ──▶ dsh ──▶ DeepSeek V4
```

核心思路：**飞书通道与 agent 后端解耦**。桥接层复刻 `lark-channel-bridge` 的成熟做法（WebSocket 长连接 + 流式卡片 + 会话路由），agent 后端通过 adapter 抽象，默认挂接带逐工具审批的官方 DeepSeek Harness SDK（`DSH_LARK_ADAPTER=sdk`），ACP 保留协议原生审批，另有 legacy headless。

默认安装的「安全网守护」（`src/guardian/`）独立于 dsh 进程常驻：dsh 在线时静默，下线时接管飞书
通道接收 `/safemode` 控制信号，以仅核心 profile（`dsh-base` + `dsh-headless`）拉起受限对话
用于自愈，`/safemode exit` 重启完整 profile 并交还通道。

## 目录结构

| 目录 | 职责 |
| :--- | :--- |
| `src/bridge/` | 飞书通道接入（消息、卡片、媒体）|
| `src/onboard/` | 首次扫码创建 / 绑定 PersonalAgent 应用|
| `src/session/` | 会话路由、排队、访问控制|
| `src/workspace/` | 项目工作区、git worktree 隔离与规则注入|
| `src/adapters/` | agent 后端适配器（sdk 默认 / acp 审批 / headless legacy / web 单写者）|
| `src/card/` | 流式卡片、Card JSON 2.0 per-viewer 中英国际化与审批 / 问答 / 计划决策卡渲染|
| `src/bot/` | 运行注册、消息排队、审批 / 问答 / 计划注册表、群聊隔离策略、多机器人 fleet / 交接限制|
| `src/commands/` | 斜杠命令（/cd /ws /new …）|
| `src/diagnostics/` | `/doctor` 内存诊断文件生成、限额与二次脱敏 |
| `src/cli/` | CLI 入口：`setup` / `bot add|list|status|remove` / `service` / `doctor` / `upgrade` / 隐藏运行入口|
| `src/service/` | 正常 dsh profile 的跨平台用户服务、0600 环境快照、状态与日志管理|
| `src/upgrade/` | 一键升级（issue #10/#51）：版本探测、升级状态、guardian/profile 重启、runtime 链接及依赖迁移|
| `src/guardian/` | 安全网守护：心跳、进程观察、仅核心安全 profile、接管状态机、系统服务安装|
| `src/config/` | profile / 配置 / 访问白名单 / dsh 配置管理|
| `src/core/` | 结构化日志|
| `src/media/` | 附件下载与文本注入|
| `src/platform/` | 跨平台原子写入|
| `docs/` | 架构、路线图等文档|
| `reference/` | 参考研究用的克隆仓库（不提交）|

## 路线图

见 [`docs/roadmap.md`](docs/roadmap.md)。

## 参考项目

| 项目 | 说明 |
| :--- | :--- |
| [`zarazhangrui/lark-coding-agent-bridge`](https://github.com/zarazhangrui/lark-coding-agent-bridge) | 飞书 ↔ Claude Code / Codex 桥接，本项目的直接参照|
| [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) | DeepSeek Harness（`dsh`），agent 后端|
| [`grinev/opencode-telegram-bot`](https://github.com/grinev/opencode-telegram-bot) | OpenCode 的 Telegram 手机端，另一参照|

## 社区收录情况

<div align="center">

<a href="https://dshfind.com/zh/plugins/PlutoKeating/dsh-lark-bot?ref=badge"><img src="https://dshfind.com/api/card/PlutoKeating/dsh-lark-bot?lang=zh" alt="dshfind" width="440"></a>

</div>

> 本项目的社区收录 / 推荐状态，随提交的更新请求持续维护。截至 v0.15.9（2026-08-20 复核）：

| 平台 | 状态 | 说明 |
| :--- | :--- | :--- |
| [awesome-dsh-plugins](https://github.com/AdamPlatin123/awesome-dsh-plugins) | ✅ 已收录 · 运行级可用| 社区榜单标注 `✅ 运行级可用`（agent 实测通过）；收录条目 v0.8.0 经 [PR #127](https://github.com/AdamPlatin123/awesome-dsh-plugins/pull/127) 合并，榜单行同步 [issue #139](https://github.com/AdamPlatin123/awesome-dsh-plugins/issues/139) 已关闭；**v0.15.1 数据刷新 [PR #230](https://github.com/AdamPlatin123/awesome-dsh-plugins/pull/230) 已提交 · 待合并**|
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | 📨 收录 PR 已提交 · 待合并| 7.2k+ star 的社区插件精选大榜（`dsh-plugin` 生态流量入口）；收录 PR [#1408](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/1408) 已提交，合并后回填状态|
| [dshfind](https://dshfind.com/zh/plugins/PlutoKeating/dsh-lark-bot) | ✅ 已收录 · 详情页在线| 条目名称修正 [issue #2](https://github.com/hikariming/dshfind/issues/2) 已关闭；**v0.15.1 数据刷新请求 [#6 跟进评论](https://github.com/hikariming/dshfind/issues/6#issuecomment-5317081509) 已提交 · 待维护方处理**；顶部徽章 / 展示卡来自 dshfind|
| [dshbase](https://dshbase.com/zh/plugins/dsh-lark-bot) | ✅ 已收录 · 实测可装| 中文插件目录（收录 1771+ 插件），自动化 CI 实测 `dsh plugin add` 可装可启动，标注 `✅ 已验证 · 实测可装`；顶部徽章来自 dshbase|
| [dsh-plugin.org](https://dsh-plugin.org/zh/plugins/plutokeating/dsh-lark-bot) | ✅ 已收录 · 官方源已核验| 平台已下架冒用本项目名称的寄生仓库条目，并收录 `PlutoKeating/dsh-lark-bot` 官方源；[收录申请 #1](https://github.com/yacuo/dsh-plugin/issues/1) 与[安全举报 #2](https://github.com/yacuo/dsh-plugin/issues/2) 均经维护者确认处理并关闭；平台另发布了[一文读懂安装与使用教程](https://dsh-plugin.org/zh/plugins/plutokeating/dsh-lark-bot/using-dsh-lark-bot)；顶部徽章来自 dsh-plugin.org|
| [omdsh-dev/community](https://github.com/orgs/omdsh-dev/discussions/11) | ✅ 收录申请通过 · 讨论活跃| `[Plugin]` 收录申请（Discussion #11）已通过并持续维护，最新更新说明 v0.10.2；**v0.15.1 更新说明已备妥，待人工粘贴（org 级 discussion 不支持 API）**|

**更新请求进度（截至 2026-08-20 复核）**：

- awesome-dsh-plugins 收录条目 v0.8.0：[#127](https://github.com/AdamPlatin123/awesome-dsh-plugins/pull/127) — ✅ 已合并；榜单行同步：[#139](https://github.com/AdamPlatin123/awesome-dsh-plugins/issues/139) — ✅ 已关闭
- awesome-dsh-plugin 大榜收录：[#1408](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/1408) — 📨 已提交（2026-08-17，v0.15.0 数据；v0.15.1 [跟进评论](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/1408#issuecomment-5317081726) 已提交）
- dshfind 条目名称修正 + v0.8.0 刷新：[#2](https://github.com/hikariming/dshfind/issues/2) — ✅ 已关闭；v0.10.1 刷新：[#6](https://github.com/hikariming/dshfind/issues/6) — 📨 待处理（v0.15.1 [跟进评论](https://github.com/hikariming/dshfind/issues/6#issuecomment-5317081509) 已提交）
- dsh-plugin.org 官方源收录与寄生条目下架：[收录申请 #1](https://github.com/yacuo/dsh-plugin/issues/1) / [安全举报 #2](https://github.com/yacuo/dsh-plugin/issues/2) — ✅ 维护者已处理并关闭；[官方详情页](https://dsh-plugin.org/zh/plugins/plutokeating/dsh-lark-bot)与[专题教程](https://dsh-plugin.org/zh/plugins/plutokeating/dsh-lark-bot/using-dsh-lark-bot)已上线
- omdsh-dev/community 收录：[Discussion #11](https://github.com/orgs/omdsh-dev/discussions/11) — ✅ 通过，讨论活跃（最新更新说明 v0.10.2）；v0.15.1 更新说明 — 📨 已备妥，待人工粘贴
- 平台数据刷新（v0.14.0 → v0.15.1）— ✅ 已恢复提交（2026-08-17）：awesome-dsh-plugins [PR #230](https://github.com/AdamPlatin123/awesome-dsh-plugins/pull/230) · dshfind [#6 跟进](https://github.com/hikariming/dshfind/issues/6#issuecomment-5317081509) · omdsh 说明备妥

**历史亮点跟进**（当时六项独家能力与 issue #6 设计实现；当前能力见上方十一项清单）：

- awesome-dsh-plugins 榜单行同步（仓库描述 → 最新）与 agent-test 报告名称异常：[#139](https://github.com/AdamPlatin123/awesome-dsh-plugins/issues/139) — 📨 已提交（维护方已确认，等待渲染周期同步）
- dshfind 详情页补「对话内管理模型和密钥」亮点：[#2 跟进评论](https://github.com/hikariming/dshfind/issues/2#issuecomment-5301019067) — 📨 已提交
- omdsh 当时六项独家亮点补充（含 Guardian 设计实现）：[Discussion #11 亮点评论](https://github.com/orgs/omdsh-dev/discussions/11#discussioncomment-18026370) — 📨 已提交

## 假冒仓库警告

> 2026-08-17 发现假冒仓库 **`tarraencompassing61/dsh-lark-bot`**：非 fork 重新上传、114 个 commit 中
> 113 个作者为 PlutoKeating、删除全部 CI、关闭 Issues、Releases 为 0，却以“下载 Windows exe 双击运行”的
> SEO 诱饵 README 冒充官方分发。**本项目从不提供 exe，任何此类下载均为假冒 / 恶意来源。**
>
> 取证存档：[`docs/security/2026-08-17-impostor-repo-evidence/`](docs/security/2026-08-17-impostor-repo-evidence/README.md) ·
> 官方下载渠道：[`docs/DOWNLOAD.md`](docs/DOWNLOAD.md) ·
> 持续监控：`pnpm security:monitor`

## 免责声明

> 本项目为非官方社区工具，与 DeepSeek、字节跳动 / 飞书（Lark）无关联，亦未获得其背书。DeepSeek Harness、Feishu / Lark 及相关商标归各自权利人所有。
>
