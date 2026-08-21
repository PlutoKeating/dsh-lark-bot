# 快速开始 · Quick Start

> 本文描述 dsh-lark-bot 面向最终用户的安装与首次使用流程。

## 1. 前置条件

- Node.js ≥ 22.19
- 已安装 DeepSeek Harness（`dsh`）并配置 `DEEPSEEK_API_KEY`
- 当前兼容基线为 dsh `0.1.0-rc.8`；托管 SDK / ACP runtime 会自动修复旧版本 profile
- 一个飞书 / Lark 账号

## 2. 安装（唯一路径）

```bash
npx dsh-lark-bot@latest setup --profile dsh-lark
```

`setup` 会：定位本机 dsh → 预批准 pnpm 构建策略（protobufjs 等）→ 执行标准
`dsh plugin --profile dsh-lark add dsh-lark-bot`，把本插件作为标准 bundle 装进 profile，
并**默认同时安装「安全网守护」**（见第 6 节；不需要时加 `--no-guardian` 跳过）。

开发阶段也可以先 `pnpm install && pnpm build`，再用
`DSH_LARK_SETUP_PACKAGE=/path/to/dsh-lark-bot-x.y.z.tgz node dist/cli.js setup --profile dsh-lark`
安装本地构建产物（可选，不面向普通用户）。

**升级（v0.12.0+ 推荐）：** 一行命令彻底升级包 + guardian + 升级后验证：

```bash
npx dsh-lark-bot@latest upgrade --profile dsh-lark --yes
```

`--check` 只报告版本与运行状态；`--restart` 升级后自动重启 guardian 与受管 profile；
`--rollback` 回滚到上次升级前版本；详见 README「升级」与 docs/MANUAL.md §1.1。

## 3. 启动并扫码（首次一次性绑定）

```bash
dsh --profile dsh-lark
```

dsh 以标准插件方式加载桥接引擎；首次启动（无凭据时）终端显示二维码：

1. 终端显示二维码。
2. 使用飞书 App 扫码。
3. 选择或创建 PersonalAgent 应用。
4. 绑定成功后，桥接引擎在 dsh 进程内运行并发送欢迎卡片到私聊。
5. 直接发送消息即可开始使用；群聊默认需要 `@bot`。

如需让 bot 接收群内未 @ 它的消息，先在目标群 `@bot` 一次以登记群聊，确认发送人已在
`allowed_users`（扫码操作者默认加入，也可用 `/invite user <open_id>`），为应用授予
`im:message.group_msg`，再以以下环境变量启动：

```bash
DSH_LARK_GROUP_NO_AT=true DSH_LARK_GROUP_POLL_MS=3000 dsh --profile dsh-lark
```

这是显式 opt-in：bridge 会处理白名单成员的实时无 @ 消息，并只轮询已登记群聊；历史路径仅处理
启动后的白名单真人消息，不回放历史积压；实时与轮询都再次校验当前用户/群白名单，
请在开启前确认群成员知情并符合组织的数据与隐私政策。开启后可运行 `dsh-lark-bot doctor`
验证历史消息权限。

在 Git 仓库中工作时，bot 会为每个会话自动创建独立 git worktree；非 Git 目录则直接使用你指定的目录。

桥接始终由 dsh profile 内插件运行。需要退出终端后常驻 / 登录自启时，可选执行：

```bash
dsh-lark-bot service install --profile dsh-lark
dsh-lark-bot service status --profile dsh-lark
dsh-lark-bot service logs --profile dsh-lark -f
```

`start|stop|restart|uninstall` 管理完整生命周期；这只是 OS 托管同一 profile，不是第二套引擎。
机器睡眠/断网时不能收消息，恢复连接后会向最近活跃会话提示。默认安全网守护见第 6 节。

要在同一群加入多个独立机器人，可为每个 PersonalAgent 创建一个实例：

```bash
dsh-lark-bot bot add reviewer --model gateway/review-model
dsh-lark-bot bot list
dsh-lark-bot bot status reviewer
```

`bot add` 会自动使用 `dsh-lark-<name>` 与 `~/.dsh-lark/bots/<name>/dsh` 创建独立 profile、
provider/凭据目录和用户服务；未显式提供 App ID/Secret 时一定扫码绑定，不继承主 bot App 凭据。
把这些 bot 加入同一群后，可信实例可通过真实 @ 交接；连续 bot 回合默认最多 6 次，任意真人消息
会重置。`bot remove reviewer` 删除服务、实例登记、配置凭据与服务环境快照，但保留该 profile 的
session/worktree/archive 数据。额外实例不受默认 guardian 救援。
已经有一个 PersonalAgent 应用时，
可在启动命令的环境变量中提供凭据跳过扫码：

```bash
DSH_LARK_APP_ID=cli_xxx DSH_LARK_APP_SECRET=<secret> DSH_LARK_TENANT=feishu \
  dsh --profile dsh-lark
```

## 4. 卸载

```bash
dsh plugin --profile dsh-lark remove dsh-lark-bot
```

## 5. 飞书内常用命令

bot 自带卡片使用 Card JSON 2.0 原生 `zh_cn` / `en_us` variant，同一群里的飞书/Lark 用户会按各自
客户端语言看到中文或英文。普通 Markdown/toast 降级并列显示中英文；agent 与用户原文不翻译。

| 命令 | 作用 |
| --- | --- |
| `/new` `/reset` | 开始新会话 |
| `/cd <path>` | 切换到该目录的独立会话（切回可继续） |
| `/ws list` | 查看命名工作空间 |
| `/ws save <name>` | 保存当前工作空间 |
| `/ws use <name>` | 切换到命名工作空间 |
| `/ws remove <name>` | 删除命名工作空间 |
| `/status` | 查看可刷新状态卡（模型 / session / run / context / token / pending / 任务账本） |
| `/doctor` | 生成并上传脱敏诊断 Markdown 文件（管理员） |
| `/jobs [list\|show <消息ID>\|retry <消息ID>]` | 对账任务、查看 checkpoint、显式重试失败/中断任务 |
| `/resume` | 查看当前会话最近上下文 |
| `/stop` | 终止当前任务 |
| `/timeout [N\|off\|default]` | 查看或设置当前会话运行超时 |
| `/concurrency [N\|default]` | 查看或设置当前 scope 并行任务数 |
| `/permission [ask\|allow\|deny] [scope]` | 查看或设置工具权限策略（管理员可指定当前聊天内 scope） |
| `/isolation [group\|topic\|member]` | 查看或设置群聊会话隔离（设置仅管理员） |
| `/role set <id>`、`/role list` | 绑定 / 查看多角色 Agent |
| `/archive [note]`、`/archive send <id> [scope\|chatId]`、`/archive list` | 归档并上传 / 重发或由管理员转发 / 查看记录 |
| `/notify <scope\|chatId> <text>` | 跨会话发送通知（管理员） |
| `/notifications [show\|off\|default\|on …]` | 配置当前 scope 主动提醒，或恢复 Web 默认值 |
| `/replies [show\|default\|set …]` | 配置回复合并、频率、批量上限与近似去重（profile 管理员或当前群管理员可修改） |
| `/density [compact\|standard\|detailed]` | 查看或设置卡片密度 |
| `/mode [quick\|balanced\|deep]`（兼容 `/effort`） | 选择当前会话任务强度；下一轮生效 |
| `/model`、`/providers`、`/provider`、`/key` | 打开交互式管理卡片（模型直接点选/恢复默认；写操作走多轮向导） |
| `/model use <provider/model>` `/model default <id>` | 精确路由并热切换当前会话模型（也兼容唯一模型 ID）/ 写入 dsh 默认模型 |
| `/model add\|remove <provider> <modelId>` | 管理 provider 的模型（管理员） |
| `/provider add\|update\|remove <id>` | 管理 provider（管理员） |
| `/key set\|remove\|list <引用名>` | 管理 dsh 凭据（set / remove 需管理员） |
| `/ask <问题>` | 你主动发送结构化问答卡（回答写入会话上下文） |
| `/invite user\|admin\|group <id>`、`/invite list`、`/invite remove user\|group <id>` | 管理访问白名单 |
| `/help` | 查看命令帮助 |

模型 / provider / 凭据管理直接读写 dsh 官方配置（`~/.dsh/settings.yaml` 与
`~/.dsh/.credentials.yaml`，与 dsh Web Settings→Models 同协议），改动下一请求生效：
`/model use` 按会话热切换模型（桥接每轮解析 provider 路由并传给 dsh runtime，SDK 适配器
路由变化时自动重建，下一轮真实生效）；`/model default` 写入 `{ provider, model }` 双字段的
`agent-default-model`；`/provider add|update` 管理 `deepseek-official` 与自定义 pi-ai provider
（Base URL 根域名自动补 `/v1`）；`/key set|remove` 写读凭据文件（0600）。密钥不会在聊天回复中
显示，建议在私聊中使用。

任务强度用 `/mode` 双语卡片或 `/mode quick|balanced|deep` 切换：快速适合简单问答，平衡适合大多数任务，深度适合复杂重构与需要更多验证的工作。模式按 scope 持久化并显示在 `/status`；切换仅影响下一轮，不会中断当前任务或清空上下文。`/effort` 是等价别名。

启动后如发现异常，先运行 `dsh-lark-bot doctor` 检查 profile、工作目录和本机 dsh 可用性。
无法使用终端时，管理员可在飞书私聊发送 `/doctor`，取得版本、非敏感配置摘要、当前运行状态和
有限最近日志组成的脱敏文件；它不代替终端命令的 adapter 实际握手探测。

### 不用环境变量：在 dsh Web 中设置

打开本机 dsh Web 的 **Settings → Plugins → Plugin configuration → dsh-lark-bot**。这里可修改 App ID/Secret、默认项目文件夹、模型、每会话并行数、adapter 和默认提醒。Secret 只写不回显；连接类字段保存后自动重连，模型/并行数/提醒从下一任务或提醒热生效且不中断当前任务。页面底部可直接检查常见配置问题，也可复制 `/status`（Bot 没反应）或 `/doctor`（任务失败）到飞书会话深入诊断。远程浏览器为只读时，请回到运行 dsh 的本机 Web 操作。

默认 backend 为官方 `@deepseek-ai/dsh-sdk-client`（`DSH_LARK_ADAPTER=sdk`）：首次启动会自动在
`~/.dsh/profiles/dsh-lark-sdk` 创建 SDK JSON-RPC runtime profile（bundle `dsh-base` +
`dsh-sdk-jsonrpc-server`），需要本机可用 `pnpm`；默认 SDK 已通过 rc.8 approval answerer 支持逐工具审批。
也可切换 `DSH_LARK_ADAPTER=acp`（`~/.dsh/profiles/dsh-lark-acp`，改用 ACP
`session/request_permission` 原生回调）；`headless` 保留旧版子进程 fallback；
`DSH_LARK_ADAPTER=web` 驱动本地 dsh web agent（`session.prompt` + `/api/events.mux`，
网页端成为唯一写者，从根上消除多写者会话损坏）。设置 `DSH_LARK_WEB_URL` 后，在飞书发送
`/session`，从当前 canonical workspace 的无正文列表中选择并确认绑定；确认前不会披露历史，
WebUI/TUI 的 open、resume 或 activity 也不会自动切换飞书 binding。可用
`DSH_LARK_SESSION_BACKFILL_MESSAGES` / `DSH_LARK_SESSION_BACKFILL_BYTES` 限制历史回填，
`DSH_LARK_SESSION_STREAM_UPDATE_MS` 控制 assistant 卡片更新间隔。

开发/准入验证还应在 build 后运行 `pnpm check:tui-admission`（唯一 v0.15 manifest、artifact SHA-256、
lock closure 与 local/remote Host Descriptor）及 `pnpm check:tui-tty`（真实 PTY；Windows 需 ConPTY）。

bot 会为每个飞书 scope 默认保存最近 40 条对话（`/retention` 可调），超出保留窗口的消息自动
归档到 `~/.dsh-lark/profiles/<profile>/archives/`（Markdown + JSONL + Git commit，`/archive`
可手动导出）；`/new` 只清空当前 `scope + workspace` 的会话记忆，其他工作区可切回续接。

发送图片时，bot 会先下载到本地 media 目录；发送文本类文件时，会把文件内容注入给 dsh 处理。

**任务中向你提问（问答卡）**：agent 需要你拍板、确认或补充缺失信息时，会通过 `lark_ask_user`
工具主动向当前会话弹一张问答卡（单选 / 多选 / 自由文本）。可提交卡片，也可直接回复该卡片输入
任意文字；单选/多选没有合适项时可直接补充说明。回答后任务自动继续；等待期间
任务运行超时看门狗暂停，本地回调也会发送轻量心跳，不会在约 5 分钟时被 HTTP 空闲超时打断。

**关键任务计划门禁**：SDK / ACP / Web agent 在较大或高风险动作前调用
`lark_request_plan_approval`。完整计划先以普通 Markdown 消息发送，随后决策卡可“批准，开始执行”
或填写意见后“继续规划”；未批准时 runtime 会拒绝写入、删除、移动、非只读 shell 命令与 `run_code`。
单条 `date`、`pwd`、`ls`、`rg`、`git status/log/diff` 等只读检查不需要计划审批；包含串联、重定向、
命令替换或未知程序的 shell 调用仍按高风险处理。等待仅暂停
该 session 的空闲超时，批准后原任务自动继续。停止任务会取消并撤回该 session 的卡；legacy headless 不支持工具回调。

**逐操作审批**：默认 SDK 安装无需切换 adapter。计划获批后，dsh rc.8 对实际高风险工具调用会
自动弹“允许执行一次 / 拒绝”卡；卡上显示工具、理由与可取得的参数，等待不计入 idle timeout。
拒绝不会终止整个任务，而会交给 agent 改用安全方案。Web host 同样可用；ACP 使用原生 permission 通道。

计划、审批和问答卡提交成功后会显示 toast、发送终态确认并撤回原卡；即使确认消息或撤回因网络
原因失败，计划决策、审批结果或答案仍会正常交给 agent。失效卡会明确提示使用最新卡片，不会静默。
若普通消息正常但所有卡片按钮完全无响应，请在飞书开放平台进入“事件与回调 → 回调配置”，启用
卡片回调并重新发布应用；新版扫码向导会自动申请 `card.action.trigger`，旧版创建的应用需补做一次。

## 6. 安全网守护（默认安装）· Safety-net guardian

dsh 采用「一切皆插件」架构，任何第三方插件都可能让整个 profile boot 失败。此时桥接引擎与
dsh 一起下线，飞书入口不可用。因此 `setup` **默认安装**一个**独立于 dsh 进程**的最小守护，
在最坏情况下仍保留飞书救援入口：

```bash
# 随 setup 默认安装（无需额外参数）；已安装后也可单独安装 / 重装：
dsh-lark-bot guardian install --dsh-profile dsh-lark

# 状态查看 / 卸载
dsh-lark-bot guardian status
dsh-lark-bot guardian uninstall
```

不需要守护时，安装命令加 `--no-guardian` 跳过。

dsh 正常运行时守护保持静默（不占用飞书通道）；dsh 下线或无法 boot 后，守护自动接管通道，
在飞书里向 bot 发送控制信号即可全程自救，无需命令行：

| 命令 | 作用 |
| --- | --- |
| `/safemode` | 进入仅核心安全模式（`dsh-base` + `dsh-headless`，无第三方插件），后续消息与 dsh 核心对话 |
| `/safemode status` | 查看守护 / dsh / 安全模式状态 |
| `/safemode plugins` | 列出故障 profile 已安装的插件清单 |
| `/safemode stop` | 终止当前正在运行的安全模式任务（也可点击任务卡片 ⏹ 按钮） |
| `/safemode exit` | 退出安全模式，重启完整 profile 并交还飞书通道 |

安全模式下 agent 具备代码执行能力，可配合上述命令定位 / 修复 / 禁用损坏插件。安全模式优先使用
官方 SDK 流式引擎（原生折叠面板实时展示思考 / 工具调用 / web search，最终回答单独发送）；
SDK runtime 不可用（如缺 pnpm）时自动回退 headless——此时任务期间卡片仍实时显示
“正在思考 / 已运行 Ns / 无响应 Ns”，任务结束、出错或超时都有明确终态。单任务**空闲超时**
默认 10 分钟（`DSH_LARK_GUARDIAN_SAFE_TIMEOUT_MS`，任务持续无活动事件才被终止，活跃任务
不会被误杀）。dsh 恢复后守护自动断开并回归静默。
守护相关本地状态见下节。

## 7. 本地状态

- 配置文件：`~/.dsh-lark/config.json`
- 守护状态：`~/.dsh-lark/guardian.json`
- 会话状态与每 scope + workspace session 累计 token/context 快照：`~/.dsh-lark/profiles/<profile>/sessions.json`
- 持久任务账本（原始消息/routing/workspace/状态/安全 checkpoint，0600）：`~/.dsh-lark/profiles/<profile>/jobs.json`
- 会话归档：`~/.dsh-lark/profiles/<profile>/archives/`
- 角色定义：`~/.dsh-lark/profiles/<profile>/roles.json`
- scope 目录（chat/thread 与 topic reply anchor messageId）：`~/.dsh-lark/profiles/<profile>/scopes.json`
- 群聊隔离策略：`~/.dsh-lark/profiles/<profile>/isolation.json`
- 工具权限策略：`~/.dsh-lark/profiles/<profile>/permission-policies.json`（按隔离 scope 保存 `ask/allow/deny`，0600）
- 通知偏好：`~/.dsh-lark/profiles/<profile>/notification-preferences.json`（按 scope 保存事件/目标/@/审批提醒延迟，0600）
- 回复策略：`~/.dsh-lark/profiles/<profile>/reply-policies.json`（按 scope 保存合并窗口、批量/频率限制和近似去重窗口，0600）
- 执行模式：`~/.dsh-lark/profiles/<profile>/execution-modes.json`（按 scope 保存 `quick/balanced/deep`，0600）
- 工作空间：`~/.dsh-lark/profiles/<profile>/workspaces.json`
- Git worktree：`~/.dsh-lark/profiles/<profile>/worktrees/`
- 媒体目录：`~/.dsh-lark/profiles/<profile>/media/`
- 运行日志：桥接引擎以 JSON Lines 输出到 stderr（由 dsh 宿主进程捕获；`logs/bot.log`
  是 0.6.0 独立服务时代的遗留路径，0.7.0 起不再写入）
- 后台服务环境 / 元数据：`~/.dsh-lark/service/<profile>.env|json`（POSIX 文件为 0600；Windows
  环境快照用当前 access token SID 的 owner-only ACL 收紧）
- 后台服务运维意图：`~/.dsh-lark/service/<profile>.intent.json`（0600；stop/uninstall 后阻止 guardian 回拉）
- 后台服务日志：`~/.dsh-lark/profiles/<profile>/logs/service.log`
- 多机器人实例登记：`~/.dsh-lark/fleet.json`（0600；身份/profile 元数据，不含密钥）
- 多机器人交接计数：`~/.dsh-lark/handoffs.json`（0600；chat 计数与近期 messageId）
- 多机器人独立 dsh 配置：`~/.dsh-lark/bots/<name>/dsh/`（provider settings、credentials、runtime profiles）
- 附加实例 adapter：`sdk` / `acp` / legacy `headless`；拒绝无法隔离广播 session 的共享 `web`
- 守护心跳：`~/.dsh-lark/profiles/<profile>/guardian/heartbeat.json`（桥接引擎周期写入）

dsh runtime profile（由 bot 首次启动自动创建于 `~/.dsh/profiles/`）：

- `dsh-lark-sdk`：SDK JSON-RPC runtime（`DSH_LARK_ADAPTER=sdk`，默认）
- `dsh-lark-acp`：ACP runtime（`DSH_LARK_ADAPTER=acp`，审批）
- `dsh-lark-safe`：仅核心安全 profile（`/safemode` 时由守护创建，`dsh-base` + `dsh-headless`）
- `dsh-lark-safe-sdk`：安全模式的 SDK 流式 runtime（`/safemode` 时由守护优先创建，
  `dsh-base` + `dsh-sdk-jsonrpc-server`，无第三方插件；失败自动回退 `dsh-lark-safe`）

可通过 `DSH_LARK_HOME` 修改状态根目录；`DSH_LARK_RUN_TIMEOUT_MS` 控制单次运行空闲超时
（持续无活动事件才终止），`DSH_LARK_STOP_GRACE_MS` 控制优雅退出宽限期。

## 8. 卸载

```bash
dsh-lark-bot guardian uninstall   # 仅安装过守护时需要
dsh-lark-bot service uninstall --profile dsh-lark  # 仅安装过正常后台服务时需要
dsh plugin --profile dsh-lark remove dsh-lark-bot
```

卸载后 profile 不再加载插件；本地状态保留在 `~/.dsh-lark`，如需清除请先备份再删除该目录。
