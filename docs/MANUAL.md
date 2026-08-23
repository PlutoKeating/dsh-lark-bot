# 用户手册 · User Manual

> 面向普通用户和运维者的完整使用手册。
> Complete manual for end users and operators.

## 1. 安装 · Installation

唯一安装路径（标准 dsh profile bundle）：

```bash
npx dsh-lark-bot@latest setup --profile dsh-lark
```

`setup` 自动完成：定位本机 dsh → 预批准 pnpm 构建策略 → 执行标准
`dsh plugin --profile dsh-lark add dsh-lark-bot`。安装后包名 `dsh-lark-bot` /
`dsh-feishu-bot` 内容一致，`dsh-lark-bot --version` 可查看版本。

### 1.1 升级 · Upgrade（v0.12.0+）

**完全不接触命令行：** profile 管理员在飞书发送 `/upgrade`。有新版本时点击只允许发起人操作的
确认卡，Guardian 会安装卡片中确认的精确 npm 版本、修复 runtime profiles、重启并验证，然后回到
原 chat/thread 报告结果；取消不会更改任何内容。重载可能中断正在执行的任务，但配置、会话、归档
和凭据保留。每次 `/new` / `/reset` 也会检查一次 npm，只有发现更新才追加一条简短文本提醒。

**一行命令彻底升级（包本体 + guardian + 升级后验证）：**

```bash
npx dsh-lark-bot@latest upgrade --profile dsh-lark --yes
```

- 默认不打断运行中的 dsh profile（只提示重启命令；配置 / 会话 / 凭据不受影响）；
- `--check`：只报告已装 / 运行中 CLI / npm 最新版本与进程状态，零改动；
- `--restart`：升级后自动重启 guardian 服务，并重启受管 / 后台的 dsh profile 进程；
- `--rollback`：回滚到上次升级前版本（记录在 `~/.dsh-lark/upgrade-state.json`）；
- `--force`：npm 不可达（离线）时按当前运行版本重装；
- `--no-guardian`：跳过守护升级；
- **runtime profile 一致性修复**：自动把 `dsh-lark-sdk` / `dsh-lark-acp` 的 own-package
  链接重指到新版本，并当场幂等重装版本陈旧的 SDK server / ACP 依赖；
- 非交互环境不带 `--yes` 会安全中止（不产生任何变更）。

未使用 `--restart` 时，升级后手动重启 profile 使新版本生效：

```bash
dsh --profile dsh-lark
```

## 2. 启动与首次扫码 · Start & first scan

```bash
dsh --profile dsh-lark
```

首次启动（无凭据时）在终端显示二维码，用飞书 / Lark App 扫码，选择或创建 PersonalAgent
应用。绑定后 `dsh-lark-bot/plugin` 在 dsh 进程内运行桥接引擎（飞书通道 / 会话工作区 / 卡片 /
通知回调）。桥接仍只在 dsh 宿主内运行；如需后台常驻，使用可选 OS 托管：

```bash
dsh-lark-bot service install --profile dsh-lark
dsh-lark-bot service status --profile dsh-lark
dsh-lark-bot service logs --profile dsh-lark -f
```

另有 `start|stop|restart|uninstall`。stop 保留登录自启入口，uninstall 删除入口与私有 env 快照，
但不删配置、会话、日志。异常退出由系统自动重启；guardian 与 `upgrade --restart` 会优先操作受管服务防双实例。
停止意图持久写入 `service/<profile>.intent.json`，因此 guardian 不会撤销显式 stop/uninstall；
install/start 会拒绝同 profile 的既有前台进程，并以生命周期锁避免并发双启动。
机器睡眠 / 断网期间不能接收新消息，恢复后会自动重连并向最近活跃会话提示。

已拥有应用时，可跳过扫码：

```bash
DSH_LARK_APP_ID=cli_xxx DSH_LARK_APP_SECRET=<secret> DSH_LARK_TENANT=feishu \
  dsh --profile dsh-lark
```

## 3. 卸载 · Uninstall

```bash
dsh plugin --profile dsh-lark remove dsh-lark-bot
```

## 4. 飞书内命令 · In-chat commands

命令帮助、状态/错误提示和 bot 自有卡片文案均提供中文 / English。支持 Card JSON 2.0 国际化的客户端
会按每位读者的语言显示同一张共享卡；普通 Markdown、toast 和旧客户端降级因服务端拿不到读者 locale，
会并列显示中英文。agent 生成的正文、推理、工具内容与用户输入保持原文，不做自动翻译。

| 命令 | 作用 |
| --- | --- |
| `/new` `/reset` | 清空当前会话 |
| `/cd <path>` | 切换工作目录 |
| `/ws list` | 查看工作空间导航卡片 |
| `/ws save <name>` | 保存当前工作空间 |
| `/ws use <name>` | 切换到命名工作空间 |
| `/ws remove <name>` | 删除命名工作空间 |
| `/status` | 查看并原位刷新 scope / cwd / 模型 / session / run / context / token / pending / 任务账本 |
| `/version` | 查看当前版本与 npm 最新版本 |
| `/upgrade` | 检查并通过 owner-bound 卡确认 Guardian 后台更新和重载（profile 管理员） |
| `/doctor` | 管理员生成脱敏诊断 Markdown 文件并上传到原聊天/话题 |
| `/jobs [list\|show <消息ID>\|retry <消息ID>]` | 对账任务状态、查看 checkpoint、确认后重试中断/失败任务 |
| `/resume` | 查看最近上下文 |
| `/session`、`/session bind <sessionId>`、`/session current` | 浏览当前 workspace 的 DSH session，经披露确认后显式绑定 / 查看当前绑定（仅 `web` adapter） |
| `/stop` | 终止当前任务 |
| `/timeout [N\|off\|default]` | 查看或设置运行超时 |
| `/concurrency [N\|default]` | 查看或设置当前 scope 的并行任务数 |
| `/permission [ask\|allow\|deny] [scope]` | 查看或设置工具权限策略（管理员可指定当前聊天内 scope） |
| `/isolation [group\|topic\|member]` | 查看或设置本群会话隔离（设置仅管理员） |
| `/role list` | 查看角色列表与当前 scope 绑定 |
| `/role show <id>` | 查看角色详情 |
| `/role set <id>` | 为当前 scope 绑定角色（下一轮生效） |
| `/role clear` | 解除当前 scope 的角色绑定 |
| `/role save <id> <name> [--persona ..] [--model ..] [--tools ..] [--rules ..]` | 创建 / 更新角色（管理员） |
| `/role remove <id>` | 删除角色（管理员） |
| `/notify <scope\|chatId> <text>` | 向其他会话推送通知（管理员） |
| `/notify list` | 查看 bridge 已注册的 scope |
| `/notifications [show\|off\|default\|on …]` | 查看、关闭、恢复 Web 默认或开启当前 scope 的主动提醒 |
| `/replies [show\|default\|set …]` | 查看或由 profile 管理员、当前群主/群管理员修改当前 scope 的回复流量策略 |
| `/retention [N\|default]` | 查看或设置保留消息条数（超出自动归档） |
| `/archive [note]` | 手动归档当前会话并把 Markdown + JSONL 上传到当前聊天 |
| `/archive send <id> [scope\|chatId]` | 重发当前 scope + workspace 的归档；管理员可发到指定已登记会话 |
| `/archive list [N]` | 查看当前 workspace 最近 N 条归档 |
| `/archive clean` | 清理当前 workspace 的过期归档 |
| `/density [compact\|standard\|detailed]` | 查看或设置卡片密度 |
| `/mode [quick\|balanced\|deep]`（兼容 `/effort`） | 选择当前会话任务强度；下一轮生效 |
| `/model`、`/providers`、`/provider`、`/key` | 打开交互式管理卡片（模型直接点选/恢复默认；写操作走多轮向导） |
| `/model use <provider/model>` | 精确路由并热切换当前会话模型（也兼容唯一模型 ID；下一轮生效） |
| `/model default <id>` | 写入 dsh 默认模型 `agent-default-model`（管理员） |
| `/model add\|remove <provider> <modelId> [--input-modalities text,image]` | 添加 / 删除 provider 模型并声明视觉输入能力（管理员） |
| `/provider add\|update\|remove <id>` | 管理 provider（管理员） |
| `/key set <引用名>`、`/key remove\|list <引用名>` | 用仅请求者可提交的安全表单设置 dsh 凭据；写需管理员 |
| `/secret status\|set\|remove <dsh-credential\|app-secret> <引用>` | 安全采集受支持密钥或查询配置状态 |
| `/language show\|set plain\|agent …\|reset …` | 管理 plain fallback 与 Agent 回答语言策略 |
| `/ask <问题>` | 发送问答卡，回答写入会话上下文 |
| `/invite user\|admin\|group <id>` | 添加白名单 |
| `/invite list` | 查看白名单 |
| `/invite remove user\|group <id>` | 移除白名单 |
| `/help` | 查看当前版本权威命令清单；即使 Agent runtime Skill 暂不可用仍由 bridge 直接处理 |

安全网守护接管期间（dsh 下线后）的额外命令：

| 命令 | 作用 |
| --- | --- |
| `/safemode` | 进入仅核心安全模式（`dsh-base` + `dsh-headless`，无第三方插件） |
| `/safemode status` | 查看守护 / dsh / 安全模式状态 |
| `/safemode plugins` | 列出故障 profile 已安装的插件清单 |
| `/safemode stop` | 终止当前正在运行的安全模式任务（也可点击任务卡片 ⏹ 按钮） |
| `/safemode exit` | 退出安全模式，重启完整 profile 并交还飞书通道 |
| `/safemode help` | 查看上述命令帮助 |

### 模型 / Provider / 凭据管理

常用 bridge 设置位于本机 dsh Web 的 **Settings → Plugins → Plugin configuration → dsh-lark-bot**。Host 半侧注册 `dsh-lark-bot` settings namespace，浏览器半侧由 npm 包的 `./client` 动态加载。页面展示实际 profile（包括扫码绑定）的 App ID、workspace 和模型，而不是只展示启动环境；App Secret 使用 secret role，任何 Web read 都会脱敏。

一次保存可修改服务区域、凭据、workspace、模型、并行数、adapter 与默认提醒。连接类配置会等待旧 generation 完整停止后再启动新 generation，避免双实例；模型/并行数/提醒热更新并从下一任务或提醒开始生效，不会中断 active run。快速诊断可先在页面直接检查脱敏配置，再复制 `/status` 或 `/doctor` 获取运行态详情。Web settings 不可用时，飞书命令和环境变量继续是兼容降级。

模型与 provider 的配置直接读写 dsh 官方配置存储（`~/.dsh/settings.yaml` 与
`~/.dsh/.credentials.yaml`，与 dsh Web **Settings → Models** 页面同一协议），改动在下一个
请求生效、无需重启 bot：

- **交互式管理卡片（推荐）**：`/providers`（或裸 `/provider`、`/model`、`/key`）打开管理卡片；
  当前模型带 ✅ 标记，可直接点选其他模型或恢复默认（下一轮生效且保留上下文）。增删改查按
  BotFather 式多轮向导完成：能选择的用按钮点选（API 协议、provider、模型、凭据引用），
  需要填值的用卡片输入（ID、Base URL、模型列表、密钥值），写入前有确认卡，随时可取消；
  向导 30 分钟无操作自动过期。文字命令与卡片向导等价、可混用。
- `/model use <provider/model>`：按会话精确路由并热切换模型（也兼容唯一模型 ID），下一轮消息即用新模型；`/model reset` 恢复默认。
- `/model default <id>`：写入 dsh 的 `agent-default-model`（`{ provider, model }`，provider 由
  桥接自动解析），作为新会话的默认模型。
- `/providers`：展示 dsh 已配置的 provider、模型与凭据状态（DeepSeek 官方 + 自定义 pi-ai）。
- `/provider add|update <id>`：新增 / 更新自定义 provider（`llm-pi-ai`）或 `deepseek-official`；
  自定义 provider 需要 `--api`（`openai-completions` / `openai-responses` / `anthropic-messages`）、
  `--base-url`（根域名如 `https://www.kingapi.xyz` 自动补全为 `/v1`）与至少一个 `--model`。
  `/provider remove <id>` 删除 provider。
- `/model add|remove <provider> <modelId> [--input-modalities text,image]`：增删 provider 的模型目录；
  视觉模型的 `inputModalities` 会被写入并从 settings 读回，交互向导也提供相同字段。
- provider 展示名、实时模型目录、模态与推理档位来自 models.dev，并缓存 15 分钟；目录不可用时
  仅显示 dsh settings 的显式配置和默认选择。可用 `DSH_LARK_MODEL_CATALOG_URL` 切换兼容镜像。
- `/key set|remove|list`：引用名与状态读自 `~/.dsh/.credentials.yaml`（目录 0700、文件 0600）；set
  只打开安全密码表单，值由本地 bridge 直接写入；普通聊天、旧的带值命令和 `--api-key` 不消费值。settings
  只保存 `apiKeyEnv` 引用，字面密钥不进入 settings 或聊天记录。
- **凭据引用必须关联**：`/key set <引用名>` 安全写入凭据文件；provider 要使用该密钥，其
  `apiKeyEnv` 必须引用同一名字（`/provider update <id> --api-key-env <引用名>` 或向导中填写）。
  引用名与 provider ID 相同且 provider 未设 `apiKeyEnv` 时，`/key set` 自动补关联；已存在的
  老配置在下次运行时也会自动补齐。
- **热重载**：每轮运行前桥接把模型解析为「provider + model」路由并传给 dsh runtime；SDK 适配器
  在路由变化时自动重建 runtime，`/model use` 的下一轮生效是真实行为（issue #47 修复）；
  因 dsh runtime 启动后异步注册 llm-pi-ai 路由，桥接会轮询重试握手（issue #47 二次修复）。
  命令执行失败会直接回复错误，不再被误转发给 agent；卡片发送失败自动降级为文字列表。

安全表单的数据仍需经过飞书/Lark 平台传输到本机 bridge；平台自身的审计、传输日志与保留策略不受
本项目控制，因此只应在受信私聊中操作。本项目保证该值不成为普通会话消息，并且 bridge 不把它送入
云端 LLM、prompt、session、任务账本、归档、结构化日志、诊断包、确认卡或回复。

除 `/model use`、`/model reset`、`/model`、`/providers`、`/key list` 外，其余写操作均需管理员
（`/invite admin <open_id>` 设置）。密钥值永不回显；在群聊中粘贴密钥会对群成员可见，建议仅在
私聊使用，或优先用 `--api-key-env` 引用环境变量 / 在 dsh Web 页面录入。

### 任务执行模式

- `/mode` 打开 Card JSON 2.0 双语选择器；也可用 `/mode quick|balanced|deep`，`/effort` 等价。
- `quick` 直接回答并只做必要检查；`balanced` 兼顾速度与可靠性（默认）；`deep` 充分调查并验证假设与结果。
- 选择按 immutable scope 原子持久化到 `execution-modes.json`（0600），重启保留，`/status` 展示当前值。
- run 创建时固化模式，所以切换只影响下一轮；正在运行的任务、session/context、工具权限与计划门禁均不改变。

### 多角色 Agent

- `/role save <id> <name> --persona <文案>` 定义角色；`--model` 指定角色模型偏好，`--tools`
  给出工具指引（逗号分隔），`--rules` 给出角色规则（等价于角色级 AGENTS.md）。
- `/role set <id>` 把角色绑定到当前 scope，`/role clear` 解除；`/status` 会显示当前角色。
- 角色定义持久化在 `~/.dsh-lark/profiles/<profile>/roles.json`（0600），重启后绑定仍然生效。
- 模型优先级：每会话 `/model use` > 角色 `--model` > profile 偏好 > dsh 默认模型 > 环境默认。
- 角色 save / remove 仅管理员可执行；set / clear 任意被邀请用户可执行。

### 多机器人实例与 @ 交接

```bash
dsh-lark-bot bot add reviewer --model gateway/review-model
dsh-lark-bot bot list
dsh-lark-bot bot status reviewer
dsh-lark-bot bot remove reviewer
```

- `bot add` 为实例创建独立 bridge/dsh profile、`~/.dsh-lark/bots/<name>/dsh` DSH_HOME、
  PersonalAgent 凭据与 OS 用户服务；可扫码，或同时传 `--app-id` / `--app-secret`。执行 add 时设置的
  `DEEPSEEK_API_KEY` 只进入该实例 service；自定义 provider secret 可在启动后用 `/key set` 写入
  独立 `.credentials.yaml`，模型目录和 provider 设置也位于该 DSH_HOME。
- 附加实例使用 `sdk` / `acp`（或 legacy `headless`）；不支持 `web`，因为共享 Web agent 的事件
  广播不能保证多实例 session 隔离，命令与启动都会明确拒绝。
- 同群 peer 只有在 bot 类型事件、真实 @ 当前 bot、sender `open_id` 已登记且启用时才能交接；
  `DSH_LARK_BOT_HANDOFF_MAX` 控制连续 bot 回合上限（默认 6、最小 2），任意新鲜真人消息重置。
- `fleet.json` 与 `handoffs.json` 只保存身份/profile/计数元数据，不保存 App Secret；交接内容、卡片
  与回复仍对共享群成员可见。member 隔离下的 bot 交接使用 group/topic scope。
- `bot remove` 删除实例飞书配置凭据、独立 `.credentials.yaml`、服务 env 与系统入口，但保留
  profile 下会话、工作树、归档，以及 DSH_HOME 中不含字面密钥的 provider 设置/runtime session；
  彻底删除须由用户备份后手工清理。
  `default` 主机器人不能由 `bot remove` 删除，需使用标准 service/plugin 生命周期命令。
  默认 guardian 只救援其配置的主实例；额外实例由各自 service 保活。
- 升级按 dsh profile 执行；有多个实例时逐个运行
  `dsh-lark-bot upgrade --profile <实例的-dsh-profile> --yes [--restart]`。

### 出站 @ 提及与跨会话通知

- 出站契约支持 `mentions`（`userId` + 可选 `name`），桥接层自动把 `<at>` 提及标记拼入消息体。
- `/notify <scope|chatId> <text>`：管理员向其他已注册会话推送消息；`/notify list` 查看
  bridge 已知的 scope（`<profile>/scopes.json` 持久化 chat/thread 与最近入站 messageId；后者也作为
  topic 问答卡的 reply anchor，重启不丢）。
- agent 侧工具 `lark_notify`：SDK / ACP runtime 均自动装配；参数 `text`、`scope`（目标会话，
  缺省当前会话）、`chat_id`（直连兜底）、`mention_user_ids`（@ 提及的 open_id 列表）。
  runtime 子进程通过 `http://127.0.0.1:<随机端口>/notify` + 每启动随机 token 回调 bridge，
  不暴露公网。
- `/notifications on [current|scope|chatId] [events=completed,failed,approval] [mentions=self,ou_x|none] [remind=10]`
  显式开启当前 scope 的主动提醒；默认事件全选、@ 操作者、审批等待 10 分钟提醒一次。普通用户只能
  使用当前会话，管理员可选已登记的跨会话目标；`show` 查看，`off` 关闭。偏好以 0600 原子持久化，
  `/status` 同步显示开关、事件、目标和审批延迟。通知失败只记日志，不改变任务终态。
- `/replies set merge=5 batch=3 interval=10 dedupe=60`：当前 scope 的最终回答在 5 秒内合并，每条最多
  3 个任务，两批至少间隔 10 秒；超出部分继续排队。60 秒内同一发送者、同 workspace 的高度近似任务
  在 durable enqueue 前被明确提示并跳过。查看对所有成员开放，修改/`default` 仅管理员；策略 0600
  原子持久化并在 `/status` 展示。默认值全部关闭，保持既有即时逐条回复与 messageId 幂等。
- agent 侧工具 `lark_send_file`：SDK / ACP runtime 与 Web 宿主自动装配；参数 `path` 与可选
  `file_name`。文件总是发回当前 native session 对应的原聊天 / 话题，不能指定其他目标。bridge
  仅允许当前 workspace、当前 scope 的实际执行 worktree、当前 scope 归档目录与实例日志目录；
  校验 realpath、拒绝目录 / symlink 越界与不安全文件名，默认单文件上限 20 MiB。
- agent 侧工具 `lark_ask_user`（问答卡）：agent 需要你拍板 / 确认 / 补充缺失信息时，通过
  `http://127.0.0.1:<随机端口>/ask` 回调 bridge，向当前会话弹单选 / 多选 / 自由文本问答卡并
  等待你回答；可提交卡片，也可直接回复该卡片输入任意文字（单选/多选也接受选项外补充）。系统按
  被回复卡的 messageId 精确结算对应问题；并发 run 的问题按 native session 独立清理与暂停看门狗，
  回答后只有所属任务继续（答完重新计时）。
  与 `/ask`（你主动发结构化问题）方向相反。
- agent 侧工具 `lark_request_plan_approval`（计划门禁）：较大或高风险动作前先经 `/plan` 回调
  发送完整计划，再等待批准 / 继续规划与可选意见；批准后同一任务自动续跑，等待期间暂停超时。
  pre-execute 策略拒绝当前 turn 未批准的写入、删除、移动、命令执行与 `run_code`；门禁无固定十分钟
  截止，停止 run 时按 session 取消并撤回失效卡，不影响同 scope 的其他并发任务。
- SDK / ACP / Web 在任何只读快速通道和计划门前先经 `/approval` policy-only 回调同步读取 scope 策略；
  该查询只返回 `ask|allow|deny`，不要求审批 outcome，也不会创建或等待卡片。
  当前 scope 默认 `ask`：低风险自省静默放行，高风险调用弹出“允许执行一次 / 拒绝”卡；管理员可用 `/permission allow` 自动放行，或
  `/permission deny` 直接拒绝并得到明确反馈，`/permission ask` 恢复逐次询问。member 模式下
  管理员可用 `/permission <策略> <scope>` 修改同一聊天内其他成员 scope。策略写入成功后才回执，
  按隔离 scope 持久化（0600）并显示在 `/status`；`deny` 优先于独立计划门禁，`allow` 不替代计划
  确认。legacy headless 无工具回调。

### 安全网守护 · Safety-net guardian

背景：dsh 采用「一切皆插件」架构，单个第三方插件报错即可让整个 profile boot 失败，此时桥接
引擎随 dsh 一起下线，飞书入口不可用。为保留最坏情况下的救援通道，`setup` 默认安装一个
**独立于 dsh 进程**的最小「安全网守护」：

```bash
# 随 setup 默认安装（无需额外参数）；已安装后也可单独安装 / 重装：
dsh-lark-bot guardian install --dsh-profile dsh-lark

# 状态 / 卸载
dsh-lark-bot guardian status
dsh-lark-bot guardian uninstall
```

工作方式：

- 桥接引擎启动后每 5 秒向 `~/.dsh-lark/profiles/<profile>/guardian/heartbeat.json` 写入心跳。
- 守护（`DSH_LARK_GUARDIAN_POLL_MS=2000` 轮询）在心跳新鲜或存在 `dsh --profile <name>`
  进程时判定 dsh 在线，保持静默、不占用飞书通道（同 app 飞书长连接仅允许单连接）。
- 曾观察到 dsh 在线且心跳过期 / 无进程（`DSH_LARK_GUARDIAN_STALE_MS=15000`）后，守护接管
  飞书通道；只有管理员（无管理员时回退白名单用户）能触发控制命令。
- `/safemode` 进入仅核心安全模式：优先预置 `~/.dsh/profiles/<dsh-profile>-safe-sdk`
  （官方 `dsh-base` + `dsh-sdk-jsonrpc-server`，不加载第三方插件、不挂载 bridge 回调工具），
  以 SDK 流式引擎在原生折叠面板实时展示思考 / 工具调用 / web search、单独发送最终回答，
  并支持原生会话续跑；
  SDK 预置失败（如缺 pnpm）时回退 `~/.dsh/profiles/<dsh-profile>-safe`（`dsh-base` +
  `dsh-headless`），历史上下文自动拼接（每 scope 上限 30 条）。任一引擎下任务卡片都实时显示
  “正在思考 / 已运行 Ns / 无响应 Ns”，任务结束 / 出错 / 超时都有明确终态；单任务空闲超时默认
  10 分钟（`DSH_LARK_GUARDIAN_SAFE_TIMEOUT_MS`：任务持续无活动事件才被终止并真正停止 dsh
  子进程，活跃的流式任务不会被误杀）。
- `/safemode plugins` 执行 `dsh plugin --profile <name> list` 展示插件清单。
- `/safemode stop`（或卡片 ⏹ 按钮）终止当前安全模式任务；同一会话同时只允许一个任务，
  忙碌时新消息会立即收到“仍在处理中”回执。
- `/safemode exit` 优先通过已安装的正常引擎 service 重启完整 profile，仅未安装 service 时才
  detached 启动；若 `service stop/uninstall` 的期望停止状态阻止重启，则留在安全模式并明确提示。
  成功启动后短暂延迟、断开飞书连接并交还通道；用户已有会话 / 工作区数据不受影响。
- dsh 重新在线（手动启动或退出安全模式）时，守护自动回归静默。

停止守护：在服务单元环境或启动命令中设 `DSH_LARK_GUARDIAN_DISABLED=1`，或
`dsh-lark-bot guardian uninstall`。

## 5. 会话与工作区 · Sessions & workspaces

- 正常任务与安全模式任务都使用飞书 Card JSON 2.0 原生折叠面板实时展示推理、工具调用与结果；
  运行中默认展开，结束后默认收起。最终回答另发一条 Markdown 消息并保持原回复/话题位置，便于
  直接引用和转发。面板外始终有最新推理尾部与最近工具结果的兼容快照；若平台拒绝折叠组件，bot 会
  自动重试不含该组件的 legacy 流式卡。若轮次完成但任一工具失败，标题与摘要显示
  “已完成（含警告）/Completed with warnings”，而不会把 job 误标为失败。若最终消息发送失败，过程卡会明确提示并回填回答正文，已写入
  的会话记录不会丢失。

- SDK / ACP / Web agent 对修改文件、运行脚本等较大或高风险动作使用计划门禁：先发送完整计划，
  再等待“批准，开始执行 / 继续规划”卡片；可在卡内填写约束或修改意见。批准后原任务自动续跑，
  继续规划则由 agent 修订后再次请求确认；未批准时写入/删除/移动/命令执行/`run_code` 被拒绝，
  等待期间仅所属 session 不触发 idle timeout。legacy headless 不支持。
- 计划获批不等于永久放行具体工具：默认 SDK / Web 随后仍按 dsh policy 对每个高风险调用逐次审批；
  卡片里的命令、参数和理由在群聊中对群成员可见，敏感操作请改用私聊。
- 可信内网 profile 如不需要独立计划门禁，可在启动/服务环境设置 `DSH_LARK_PLAN_GATE=off`；
  这不会关闭逐工具审批。受管服务会在 `service install|start|restart` 时重新快照当前环境，例如
  POSIX shell 使用 `DSH_LARK_PLAN_GATE=off dsh-lark-bot service restart --profile dsh-lark`，
  Windows PowerShell 先执行 `$env:DSH_LARK_PLAN_GATE = "off"`，再执行
  `dsh-lark-bot service restart --profile dsh-lark`。默认 `strict`；
  `date`、`id`、`pwd`、`uname`、`whoami` 与受限仓库内只读 Git 命令无需计划审批；文件内容读取、
  路径枚举、外部路径与控制语法均按高风险处理，拒绝后不得换用等价命令/工具/路径绕行；
  SDK 的 `description`、`workdir` 与 `run_in_background:false` 无副作用元数据不会改变只读判定，
  未知参数继续失败关闭。

- 私聊始终独立；群聊默认按话题隔离 scope。管理员可用 `/isolation group|topic|member` 改为
  整群共享、话题独立或成员独立；切换只影响后续消息路由，旧 scope 数据与已经发出的停止 / 审批 /
  问答卡继续绑定原 scope，`/stop` 也覆盖操作者可达的旧 scope。成员任务卡显示入队时固化的 owner。
  注意：成员模式只隔离 agent 上下文，不隐藏共享群里的输入、进度卡或回复；这些内容仍对群成员可见。
- 每个 scope + workspace 默认保存最近 40 条对话（`/retention` 调整，`DSH_LARK_RETENTION_MSGS` 配置默认值）。
- `sessions.json` 按 `scope + workspace cwd` 保存独立 native session、transcript 与指标；`/cd` / `/ws use`
  会中断原工作区仍在运行的任务，但不删除数据，切回会续接。`/new` / `/reset` 只清空当前工作区。
- 同一 scope 默认允许 2 个任务并行（`/concurrency` 或 `DSH_LARK_SCOPE_CONCURRENCY` 调整，
  1 为严格串行）；并行 run 各持独立 dsh session 与 runId。SDK runtime 以 `scope + workspace`
  为停止域，并发 session 也彼此隔离；卡片停止只终止对应 run，`/stop` 仍终止当前 scope 内全部
  运行，但不会影响其他群。重启、停止或模型切换后的旧 SDK session binding 不会交给新 runtime，
  bridge 会以 transcript 新建 session，避免 rc.8 `id collision`。
- `/status` 状态卡还显示有效模型、版本、待审批 / 提问 / 计划数，以及当前 session 的累计
  input / output / cache token；pending 数仅统计当前 workspace 的 session/run。ACP `usage_update` 提供真实 context used/size；SDK 当前只保证
  模型调用 token/cache usage。模型目录声明的 contextWindow 可作为上限；没有真实 used 时仍显示
  “暂无”，不估算百分比。最近 context 快照按 native session 与 canonical provider/model 分别保存，
  并行 run 不互相覆盖；只有当前 workspace/session/model 身份匹配的快照才展示。点击“刷新”原位更新；
  指标写入 `sessions.json`，仅当前工作区的新建/重置会清零，切换目录不会清零。
- `/doctor` 是无终端排障入口：只允许管理员，内存生成后直接上传，不落临时文件。报告含版本、
  平台、非敏感配置计数、当前 workspace 的运行/pending/job 摘要、服务状态与当前 bridge 进程内
  有界结构化事件（不读取共享 dsh 宿主 stdout）；
  不含消息正文/transcript/凭据，并再次脱敏已知敏感值与主目录。群文件对成员可见，优先私聊使用。
- 普通 agent 消息先原子写入 `jobs.json` 再排队。重启自动恢复 queued；running 转为 interrupted，
  保留最后阶段但不自动重复可能已有副作用的工具。`/jobs show` 对账后可用 `/jobs retry` 显式重跑；
  `/status` 与重连提示显示当前 workspace 的账本统计。仅已被 bridge 接收并成功落盘的事件受此保证，
  WebSocket 断开期间平台未投递的事件无法恢复。执行前 running receipt 落盘失败时不会启动任务，
  并明确落 failed 或保留 queued；中断通知持久化并在投递失败后跨启动重试。
- 超出保留窗口的消息自动归档到 `~/.dsh-lark/profiles/<profile>/archives/`：每条归档同时写
  Markdown 转写与 JSONL 原始数据，归档目录初始化为独立 Git 仓库，每次归档 / 清理单独 commit，
  可审计、可回放；`/archive [note]` 可随时手动导出完整会话并把两种格式直接上传到当前聊天，
  上传失败不删除本地归档，可用 `/archive send <id>` 重试；管理员可追加 `[scope|chatId]` 转发到
  `ScopeDirectory` 已登记会话。归档来源仍只从当前 scope + workspace 选择，避免跨会话读取。
- 保留策略：每个 scope + workspace 最多保留 `DSH_LARK_ARCHIVE_MAX`（默认 50）条归档、超过
  `DSH_LARK_ARCHIVE_MAX_AGE_DAYS`（默认 90 天）的归档会被自动清理，`/archive clean` 只清当前 workspace。
- SDK 模式使用 dsh 原生 session 续跑，headless 模式把历史注入下一次 prompt 作为近似上下文。
- 工作目录是 Git 仓库时，按 scope + 项目路径自动创建独立 git worktree，避免多项目互相污染；
  旧版 scope-only worktree 会先核验 Git owning repo，会话和旧自动归档归回真实项目；匹配时原位迁移，若当前指针
  已是另一项目则保留旧树并另建新树，分支和未提交文件都不会被覆盖。
- 非 Git 目录直接使用指定目录。
- 项目根目录有 `AGENTS.md` 时，会注入到 worktree。

## 6. 权限 · Permissions

- 首次扫码创建者自动写入白名单。
- 使用 `/invite user <open_id>` 允许用户私聊。
- 使用 `/invite group <chat_id>` 允许群聊。
- 使用 `/invite admin <open_id>` 设为管理员。
- 管理员可执行 `/model default`、`/model add|remove`、`/provider add|update|remove`、
  `/key set|remove` 等写操作。
- 白名单非空时，飞书 SDK 启用 DM / group allowlist。

## 7. 诊断与排障 · Diagnostics

```bash
dsh-lark-bot doctor
```

会检查：

- profile 是否可读
- 访问白名单用户数 / 群聊数
- 工作目录是否存在
- adapter 模式与 dsh 是否真实可用（`sdk` / `acp` / `headless` / `web` 对应 runtime 探测）

桥接引擎日志：前台以 JSON Lines 输出到 stderr；后台服务写入
`profiles/<profile>/logs/service.log`，用 `service logs -f` 查看（`logs/bot.log` 是
0.6.0 独立服务时代的遗留路径，0.7.0 起不再写入）。
守护状态可用 `dsh-lark-bot guardian status` 查看；服务未运行时先检查该日志再运行 `doctor`。

## 8. 卸载 · Uninstall

```bash
dsh-lark-bot guardian uninstall        # 仅安装过安全网守护时需要
dsh plugin --profile dsh-lark remove dsh-lark-bot
```

卸载后 profile 不再加载插件；本地状态（配置 / 会话 / 归档 / 角色 / 守护状态）保留在
`~/.dsh-lark`，如需彻底清除请先备份再删除该目录。

## 9. 环境变量 · Environment

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_LARK_HOME` | `~/.dsh-lark` | 本地状态根目录 |
| `DSH_LARK_PROFILE` | `default` | bridge 状态 profile；多实例 service 自动写入 |
| `DSH_LARK_DSH_PROFILE` | `dsh-lark` | 当前实例关联的 dsh profile；多实例 service 自动写入 |
| `DSH_LARK_TENANT` | `feishu` | `feishu` 或 `lark` |
| `DSH_LARK_WORKSPACE` | 未设置 | 新会话默认工作目录 |
| `DSH_LARK_DSH_COMMAND` | 自动发现 | dsh 启动命令 |
| `DSH_LARK_DSH_ARGS` | 自动发现 | dsh 启动参数 |
| `DSH_LARK_ADAPTER` | `sdk` | `sdk`（默认，逐操作审批）/ `acp`（协议原生审批）/ `headless`（legacy）/ `web`（本地 dsh web agent，单写者） |
| `DSH_LARK_PROVIDER` | 未设置 | 模型 provider；可由对象形式的 dsh 默认模型提供 |
| `DSH_LARK_MODEL` | 未设置 | 默认模型；可由 dsh `agent-default-model` 提供 |
| `DSH_LARK_MODEL_CATALOG_URL` | `https://models.dev/api.json` | provider / 模型能力实时目录或兼容镜像 |
| `DSH_LARK_MAX_TOKENS` | 未设置 | SDK agent 输出 token 上限 |
| `DSH_LARK_PLAN_GATE` | `strict` | `strict` 启用独立计划门禁；可信 profile 可设 `off`，仅关闭计划门禁，不关闭逐工具审批；受管服务需在该环境下 restart 以重新快照 |
| `DSH_LARK_WEB_URL` | `http://127.0.0.1:3080` | `web` 适配器：本地 dsh web agent base URL |
| `DSH_LARK_SESSION_PROJECTION` | `true` | `web` 适配器：启用用户显式确认的 DSH session 历史/实时投影；不会自动跟随 WebUI/TUI |
| `DSH_LARK_SESSION_BACKFILL_MESSAGES` | `20` | 确认绑定后最多回填的人类消息数 |
| `DSH_LARK_SESSION_BACKFILL_BYTES` | `65536` | 单次 transcript 回填 UTF-8 字节上限 |
| `DSH_LARK_SESSION_STREAM_UPDATE_MS` | `800` | 同一 assistant 投影卡最小更新间隔（ms） |
| `DSH_LARK_WEB_PUSH` | 未设置 | 已弃用别名；仅在新投影开关缺失时读取，不再表示自动切换 |
| `DSH_LARK_ACCESS_DEFAULT_DENY` | `false` | 无白名单时拒绝私聊 |
| `DSH_LARK_EVENT_FRESHNESS_MS` | `600000` | 过期消息拒绝窗口 |
| `DSH_LARK_RUN_TIMEOUT_MS` | `300000` | 单次运行空闲超时（持续无活动事件才终止） |
| `DSH_LARK_STOP_GRACE_MS` | `5000` | 优雅退出宽限期 |
| `DSH_LARK_SCOPE_CONCURRENCY` | `2` | 每个 scope 的并行任务数（1=严格串行） |
| `DSH_LARK_NOTIFICATION_DEFAULT` | `off` | 未设置 scope 覆盖时的提醒默认值：`off` / `completed` / `all` |
| `DSH_LARK_BOT_HANDOFF_MAX` | `6` | 同 chat 连续可信 bot @ 交接上限（最小 2；真人消息重置） |
| `DSH_LARK_RETENTION_MSGS` | `40` | 每个 scope + workspace 保留的消息条数（0=全部保留） |
| `DSH_LARK_ARCHIVE_MAX` | `50` | 每个 scope + workspace 最多保留的归档数（0=不清理） |
| `DSH_LARK_ARCHIVE_MAX_AGE_DAYS` | `90` | 归档最大保留天数（0=不清理） |
| `DSH_LARK_DISABLED` | 未设置 | `1` 时保持桥接引擎停止（插件仍加载） |
| `DSH_LARK_HEARTBEAT_MS` | `5000` | 桥接引擎心跳写入间隔（守护存活信号） |
| `DSH_LARK_GUARDIAN_DISABLED` | `false` | `1` 时安全网守护进程保持停止 |
| `DSH_LARK_GUARDIAN_PROFILE` | `dsh-lark` | 守护监视 / 重启的 dsh profile |
| `DSH_LARK_GUARDIAN_BRIDGE_PROFILE` | `default` | 提供飞书凭据与白名单的桥接状态 profile |
| `DSH_LARK_GUARDIAN_POLL_MS` | `2000` | 守护看门狗轮询间隔 |
| `DSH_LARK_GUARDIAN_STALE_MS` | `15000` | 心跳超时阈值（超时且无 dsh 进程则接管） |
| `DSH_LARK_GUARDIAN_ENGINE_DEAD_MS` | `120000` | dsh 进程存活但心跳持续超时该时长即判定引擎已死并接管 |
| `DSH_LARK_GUARDIAN_SAFE_ADAPTER` | `auto` | 安全模式引擎：`auto` 优先 SDK 流式、失败回退 headless；`sdk` 强制 SDK；`headless` 跳过预置 |
| `DSH_LARK_GUARDIAN_SAFE_TIMEOUT_MS` | `600000` | 安全模式单任务空闲超时（持续无活动事件才停止并出超时卡） |
| `DSH_LARK_GUARDIAN_CARD_DENSITY` | `detailed` | 安全模式任务卡片密度（compact / standard / detailed） |

环境变量在启动 dsh profile 前导出即可（`DSH_LARK_*`、`DEEPSEEK_API_KEY` 等会随 dsh 进程传入
桥接引擎）。SDK / ACP 会先使用完整显式 provider/model；缺失时回退到 dsh 对象形式
`agent-default-model`，仍不完整则给出明确配置错误。受管 bridge/guardian service 在
install/start/restart 时把旧 service env 的受管键与当前 `DSH_LARK_*` 环境合并（当前 shell 显式值
优先），因此稀疏 shell 重启不会删除已有 route；修改值后仍需在新环境下执行 service restart 才会生效。
模型目录冷启动请求失败时，对象形式 `agent-default-model` 仍作为所属 provider 的最小离线条目参与
解析；未在 settings 中明确出现的未知模型继续拒绝。
