# 核心能力详解 · Detailed Feature Notes

> 本文档是 dsh-lark-bot 各核心能力的**实现级行为说明**（谁触发、怎么落盘、边界与失败语义）。
> 面向需要理解确切行为的高级用户 / 排查者；普通用户只需看根目录 `README.md` 的「30 秒上手」与
> `docs/MANUAL.md` 的命令表。本文档承接 README 迁移出的细节，避免任何信息丢失。

---

## 1. 基础能力

- 私聊、群聊、话题（thread）里指挥本机 dsh coding agent，图片 / 文本文件直接发给 bot 即可；
- 流式过程卡以飞书原生折叠面板实时展示阶段、耗时以及工具名称与状态；完成但存在失败工具时汇总为
  「已完成（含警告）/ Completed with warnings」，不把「任务轮次结束」冒充为「所有工具成功」。
  完成后最终回答单独发送，支持交互按钮（停止 / 计划门禁 / 审批 / 问答卡）；原始推理、工具输入输出
  与底层错误不会进入卡片；卡片更新失败会有限重试，飞书返回「message withdrawn」（消息已被撤回/替换）
  时会按最新快照重建卡片并继续流式更新，只有真正不可恢复的失败才降级为普通提示——Agent 与最终回答
  都不会拖垮或中断，bridge 进程不受影响；
- Git 仓库内为每个会话自动创建隔离 worktree 项目工作区，多项目互不干扰。

## 2. 消息与任务可靠性

普通 agent 消息以飞书 `messageId` 去重，先原子写入 profile 的 `jobs.json`（0600）再进入内存队列。
进程重启后，尚未开始的 queued 消息自动回到原 scope、thread 与 workspace；崩溃时已 running 的任务
会转为 interrupted，保留最后安全阶段、run/native session 标识，但不会自动重复可能已有外部副作用
的操作。用 `/jobs` 对账、`/jobs show <消息ID>` 查看，确认后再 `/jobs retry <消息ID>`。`/status`
和重连提示会显示当前 workspace 的账本统计。保证范围从 bridge 已经收到并成功落盘开始；断网期间飞书
从未投递给 bridge 的事件无法由本地账本恢复。若首次落盘失败，bot 会明确回复“未接收/未执行，请重发”；
若执行前 running receipt 失败，任务不会启动，并明确落为 failed 或保留 queued 等待重启恢复。终态
落盘失败也会提示对账；残留 running 会在出站通道就绪后安全标为 interrupted，中断通知失败会跨启动
继续投递。

## 3. 群聊会话隔离

管理员可用 `/isolation group|topic|member` 在「整群共享 / 话题独立 / 成员独立」之间切换；默认
`topic` 保持既有行为。切换只改变后续消息的 scope 路由，不迁移或删除已有会话，切回即可继续；
切换前已发出的停止 / 审批 / 问答卡仍绑定原 scope，`/stop` 也会覆盖当前成员可达的切换前 scope。
成员模式的任务卡会显示发送者 open_id，避免误把别人的上下文当成当前对话。策略持久化在
`~/.dsh-lark/profiles/<profile>/isolation.json`。

## 4. 多角色 Agent

管理员用 `/role save <id> <name> --persona <文案> [--model <id>] [--tools <csv>] [--rules <文案>]`
定义 PM / 开发 / 文档等角色，`/role set <id>` 绑定到当前 scope；每个 run 携带角色 persona 与规则，
角色模型低于每会话 `/model use`。角色定义持久化在 `~/.dsh-lark/profiles/<profile>/roles.json`。

## 5. 多机器人实例与 @ 交接

```bash
dsh-lark-bot bot add reviewer --model gateway/review-model # 无凭据参数时扫码创建独立 PersonalAgent
dsh-lark-bot bot list
dsh-lark-bot bot status reviewer
dsh-lark-bot bot remove reviewer                       # 保留会话/工作树数据
```

每个实例使用独立的 bridge profile、`dsh-lark-<name>` profile、`~/.dsh-lark/bots/<name>/dsh`
DSH_HOME、OS 用户服务、飞书与 provider 凭据、模型目录、session/scope/worktree/archive；
添加/移除不会重启其他实例。可在执行 `bot add` 时为当前进程设置该实例专用的 `DEEPSEEK_API_KEY`；
自定义 provider 凭据可在实例启动后通过 `/key set` 写入独立凭据库。连接后，本机共享的
`fleet.json` 只把已登记 bot open_id 视为可信 peer。agent 获得 peer 的精确 open_id，可用
`lark_notify` 在当前群真实 @ 对方并附交接摘要；未知 bot、未 @、system/anonymous 消息不进入 agent，
bot 发来的 `/...` 也只作为任务文本。共享 `handoffs.json` 对 messageId 去重并在全 fleet 统计连续
交接，默认 6 轮；任一新鲜真人消息（即使未 @）立即重置。成员隔离群中的 bot 交接使用该实例的
group/topic scope，避免生成无人可操作的 bot-owned 审批卡。额外实例由自己的 service 常驻；默认
guardian 仍只救援其配置的主实例。`default` 主机器人不能通过 `bot remove` 删除，避免附加实例管理
误伤既有机器人。附加实例仅支持各自隔离 runtime 的 `sdk` / `acp`（以及 legacy `headless`）；
`bot add` 与运行时都会拒绝 `web`，因为共享 Web agent 的广播事件流无法提供实例级 session 隔离。

## 6. 出站 @ 提及与跨会话通知

`/notify <scope|chatId> <text>` 可向其他会话推送汇报（管理员）；agent 侧内置 `lark_notify` dsh 工具
（SDK / ACP runtime 均可装配），任务完成后主动向其他群 / 话题发消息并 @ 成员。回调走 127.0.0.1
本地端口 + 随机 token，不暴露公网。

## 7. 可配置主动提醒

Web 设置默认关闭、不刷屏，也可为未单独设置的会话选择「完成与失败」或「全部」。普通用户可用
`/notifications on current` 覆盖当前 scope，默认 @ 自己并在审批等待 10 分钟后只提醒一次；
可用 `events=`、`mentions=`、`remind=` 调整。管理员还可把目标设为已登记的其他 `scope|chatId`。
偏好原子持久化到 profile，重启不丢，并在 `/status` 显示；`/notifications off` 显式关闭，
`/notifications default` 恢复 Web 默认值。

## 7.1 通知转发到其他 IM（纯通知，issue #113）

飞书仍是唯一完整交互平台；同时可把「完成 / 失败 / 审批 / 突发 / 故障」通知作为**额外出站投递目标**
转发到其他 IM（`OutboundSink`，首期实现 Telegram 官方 Bot API 与企业微信群机器人 webhook，均为
无状态 HTTPS POST、无第三方 bot 框架）。管理员用 `/channels` 配置渠道（含打码显示、0600 存储、
绝不回显），scope 用 `/notifications on … sinks=<id>` 选择把事件一并推给渠道。`notifyUrgent()` 面向
安全网守护 / 重连 / 心跳异常的「突发 / 故障」类事件，不管 scope 是否 opt-in 都广播到全部启用渠道。
未配置任何额外渠道，或偏好未列出 `sinks` 时，行为与现状完全一致；这些渠道**不做任何入站交互**
（命令、卡片、问答、审批、文件）。凭据只存于 `<profile>/notification-channels.json`（0600），
且从不出现在日志 / 诊断包 / 命令回显。

## 8. 回复流量控制

默认保持即时逐条回复。profile 管理员或当前群的群主/群管理员可用 `/replies set merge=5 batch=3
interval=10 dedupe=60` 为当前 scope 开启 5 秒合并窗口、每条合并最多 3 个任务、两批至少间隔 10 秒，
并在 60 秒内抑制同一发送者在同 workspace 的近似重复任务；超出批量上限的答案在 bridge 进程存活期间
继续排队，不会因批量上限被丢弃。`/replies` 与 `/status` 显示有效策略，`/replies default` 恢复默认。

## 9. 任务执行模式

发送 `/mode` 可用双语卡片选择 `quick`（快速：直接回答，只做必要检查）、`balanced`（平衡：兼顾速度
与可靠性，默认）或 `deep`（深度：充分调查并验证假设与结果）；也可直接发送 `/mode quick|balanced|deep`，
`/effort` 是等价别名。选择按隔离 scope 持久化并显示在 `/status`。每个 run 启动时固化模式，因此切换
只影响下一轮，不会中断当前任务、清空上下文或绕过权限/计划审批。

## 10. 结果文件直接回传

SDK / ACP / Web agent 可调用 `lark_send_file`，把当前会话 workspace、实际执行 worktree、当前 scope
归档或实例日志中的文件直接上传到原飞书聊天 / 话题；普通 `/archive [note]` 会在落盘后立即发送
Markdown + JSONL，失败时保留路径并可用 `/archive send <id> [scope|chatId]` 重试或由管理员转发到指定
会话。上传只接受普通文件，默认单文件不超过 20 MiB；真实路径必须位于 bridge 计算的会话目录内，
runtime 自报 cwd 不能扩大边界。

## 11. 逐操作审批与 scope 权限策略

SDK / ACP / Web runtime 在任何本地快速通道和计划门裁决前，先通过鉴权回环同步读取当前 immutable
scope 的 `ask|allow|deny`；该 policy-only 查询不创建卡片或进入人类等待传输。`deny` 对低风险与高风险
工具都先行拒绝并返回 `permission-policy` 来源；`ask` 对保守只读自省静默放行、对高风险调用弹
“允许执行一次 / 拒绝”卡；`allow` 自动放行逐工具审批，但仍不替代高风险任务的计划确认或 Harness
文件沙箱。管理员可用 `/permission allow|deny|ask [scope]` 修改当前聊天内 scope；策略成功落盘后才
确认，持久化到 profile 的 `permission-policies.json`（0600），重启不丢并显示在 `/status`。legacy
`headless` 不具备工具回调能力。

## 12. 关键任务计划门禁

SDK / ACP / Web agent 在修改文件、运行脚本等较大或高风险动作前使用 `lark_request_plan_approval`；
同一 turn 未获批准时，runtime pre-execute 策略会拒绝写入、删除、移动、非只读 shell 命令与
`run_code`。一次计划批准只放行随后一次高风险调用，计划外的后续调用必须重新确认。快速通道只保留无路径
的 `date`、`id`、`pwd`、`uname`、`whoami` 与受限的 `git status/log/diff` 等仓库内检查；`cat`、`grep`、
`find`、`head`、`tail`、`rg`、`ls` 等可读取文件或枚举路径的命令不在快速通道，避免借工作区外路径读取
环境或凭据。SDK `bash` 自动附带的 `description`、`workdir` 与 `run_in_background:false` 经无副作用
校验后不会改变只读判定。包含未知参数、串联、重定向、命令替换或未知程序的 shell 调用仍保守地走计划
门禁。bridge 先把完整 Markdown 计划作为普通消息发出，再弹出“批准，开始执行 / 继续规划”决策卡；卡内
可填写修改意见。工具在等待期间阻塞且暂停空闲超时，批准后原任务自动继续；继续规划时 agent 会收到
意见、修订计划并再次请求确认。门禁无固定十分钟截止，跟随所属 run 的取消信号；停止任务会精确取消该
session 的 pending 卡并撤回。可信部署可设置 `DSH_LARK_PLAN_GATE=off` 关闭这层独立门禁（逐工具审批
仍按原策略执行）；legacy headless adapter 不具备工具回调能力。

插件可控的拒绝统一为 `[policy-denial layer=<plan-gate|permission-policy|tool-approval>]`，随后给出
`reason` 与 `to change`；Harness 自己的 `[sandbox: ...]` 明确归类为 `file-sandbox`。高风险分类器、
persona 中的只读说明和拒绝文本由 `src/policy/tool-policy.ts` 同一来源生成，因此策略调整不会只改提示词
或只改执行钩子。persona 同时要求任一层拒绝后停止，不得换用等价命令、工具或路径绕行。计划门与逐工具
审批仍保留不同语义，`/permission allow` 不扩大文件沙箱，也不替代计划确认。

## 13. 任务中向你提问（问答卡）

agent 需要你拍板、确认或补充信息时，通过 `lark_ask_user` 工具弹问答卡（单选 / 多选 / 自由文本）。
可提交卡片，也可直接回复该卡片输入任意文字；单选/多选没有合适项时，回复文字就是补充答案。系统按被
回复的 card messageId 精确匹配 pending 问题，回答后任务自动继续，等待期间运行超时看门狗暂停。
（与 `/ask` 的“你主动提问”方向相反。）

计划、审批与问答卡提交后会立即显示成功提示、发送一条终态确认并撤回原卡，避免按钮仍停留在聊天中造成
“未生效”的误解；失效卡会返回明确错误提示，入站点击与失效原因写入结构化日志。确认或撤回失败不会影响
已经提交给 agent 的决策、审批结果或答案。本地人机决策回调会以 JSON 空白流保活，避免 Node HTTP 客户端
在等待 5 分钟后切断仍有效的卡片。

## 14. 安全网守护

独立于 dsh 进程、系统级常驻的最小守护进程（systemd / LaunchAgent / Windows 启动项），默认随 `setup`
安装。dsh 正常时静默；dsh 下线或无法 boot（如第三方插件破坏 profile 组合）时自动接管飞书通道，无需
命令行即可自救：

- `/safemode`：进入仅核心安全模式（仅 `dsh-base` + `dsh-headless` 官方核心，不加载第三方插件），优先
  SDK 流式引擎、失败回退 headless，直接在聊天里定位 / 修复 / 禁用损坏插件；
- `/safemode plugins`：列出故障 profile 的插件清单；`/safemode status`：查看状态；`/safemode stop`：
  终止当前安全任务（或点卡片 ⏹）；`/safemode exit`：重启完整 profile 并交还通道。

安全模式任务有空闲超时（`DSH_LARK_GUARDIAN_SAFE_TIMEOUT_MS`，默认 10 分钟，仅持续无活动事件才终止），
超时 / 失败都给出明确终态。安装：`dsh-lark-bot guardian install --dsh-profile dsh-lark`（随 setup
默认安装；已安装后也可单独安装 / 重装）。不需要时 `setup --no-guardian` 跳过；单独卸载用
`dsh-lark-bot guardian uninstall`。

### 通道活性看门狗与健康模型（issue #108）

桥接引擎的心跳文件在 `{pid, startedAt, ts}` 之外，还附带一个 **channel readiness 快照**
（`state: connecting|ready|reconnecting|failed|stopped`、`generation`、`reconnectAttempts`、
`lastInboundAt`、`lastReconnectAt`、`lastError`）。因此 `service status`、`doctor` 与
`guardian status` 都能把 **「引擎进程活着」** 与 **「飞书通道可用」** 区分开，而不再把新鲜的
engine heartbeat 单独当成端到端 healthy。

- 长连接默认启用 SDK 的 `wsConfig.pingTimeout`（无入站帧判定死连接并强制重连）与应用层
  `keepalive` 看门狗（定期探测 + 强制重建新 WS generation）。
- 当强制重连也失败（`onUnrecoverable`）时，引擎以非零状态退出，交给受管 service / guardian
  恢复，用一个新的 WebSocket 连接重启。
- guardian 只在 **引擎心跳过期且无 dsh 进程** 时接管通道（同 app 单长连接约束）；引擎存活但
  上报通道不健康时 guardian **不抢占**，仅记录 `channel-unhealthy` 事件并如实展示，避免双实例
  同时消费同一连接。

## 15. 正常引擎后台服务

安装仍只有 `setup` 这一条路径；如需登录后自动运行、退出终端仍在线，可再用一条命令把同一个标准 dsh
profile 交给系统用户服务托管（不会启动第二套桥接引擎）：

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
Windows 使用登录计划任务。服务异常退出会自动重启，`doctor` 会报告已安装服务的状态。guardian 发现
正常引擎掉线时会优先重启该受管服务，避免重复拉起；`upgrade --restart` 也走同一路径。`stop` /
`uninstall` 会持久记录“期望停止”，guardian 不会擅自拉起；install/start 若检测到同 profile 的前台
进程会拒绝并提示先停止，生命周期锁阻止并发双启动。机器睡眠或断网期间 WebSocket 无法收消息；恢复后
SDK 自动重连，并向最近活跃会话发送恢复提示。

---

## 模型 / Provider / 凭据管理（行为细节）

见 `docs/MANUAL.md` §「模型 / Provider / 凭据管理」。要点：配置以 dsh 官方方式持久化
（与 dsh Web **Settings → Models** 同一存储协议），改动下一请求生效、无需重启；`/config`（或其别名
`/model` `/provider` `/providers` `/key`）打开交互式管理卡片，当前模型带 ✅ 标记，可直接点选其他模型
或“恢复默认”，增删改查按多轮向导完成；`/model use` 热切换、`/model default` 写默认、`/key set` 走
安全表单；凭据引用必须关联 `apiKeyEnv`。
