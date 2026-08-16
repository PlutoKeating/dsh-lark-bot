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
  链接重指到新版本；
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
通知回调），常驻与守护由 dsh 宿主负责。

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

| 命令 | 作用 |
| --- | --- |
| `/new` `/reset` | 清空当前会话 |
| `/cd <path>` | 切换工作目录 |
| `/ws list` | 查看工作空间导航卡片 |
| `/ws save <name>` | 保存当前工作空间 |
| `/ws use <name>` | 切换到命名工作空间 |
| `/ws remove <name>` | 删除命名工作空间 |
| `/status` | 查看当前 scope、cwd、session、active run |
| `/resume` | 查看最近上下文 |
| `/stop` | 终止当前任务 |
| `/timeout [N\|off\|default]` | 查看或设置运行超时 |
| `/concurrency [N\|default]` | 查看或设置当前 scope 的并行任务数 |
| `/role list` | 查看角色列表与当前 scope 绑定 |
| `/role show <id>` | 查看角色详情 |
| `/role set <id>` | 为当前 scope 绑定角色（下一轮生效） |
| `/role clear` | 解除当前 scope 的角色绑定 |
| `/role save <id> <name> [--persona ..] [--model ..] [--tools ..] [--rules ..]` | 创建 / 更新角色（管理员） |
| `/role remove <id>` | 删除角色（管理员） |
| `/notify <scope\|chatId> <text>` | 向其他会话推送通知（管理员） |
| `/notify list` | 查看 bridge 已注册的 scope |
| `/retention [N\|default]` | 查看或设置保留消息条数（超出自动归档） |
| `/archive [note]` | 手动归档当前会话（Markdown + JSONL） |
| `/archive list [N]` | 查看当前 scope 最近 N 条归档 |
| `/archive clean` | 清理过期归档 |
| `/density [compact\|standard\|detailed]` | 查看或设置卡片密度 |
| `/model` | 查看当前会话模型、dsh 默认模型与可用模型列表 |
| `/model use <id>` | 热切换当前会话模型（下一轮生效） |
| `/model default <id>` | 写入 dsh 默认模型 `agent-default-model`（管理员） |
| `/model add\|remove <provider> <modelId>` | 添加 / 删除 provider 的模型（管理员） |
| `/providers` | 查看 dsh providers、模型与凭据状态 |
| `/provider add\|update\|remove <id>` | 管理 provider（管理员） |
| `/key set\|remove\|list <引用名>` | 管理 dsh 凭据（set / remove 需管理员） |
| `/ask <问题>` | 发送问答卡，回答写入会话上下文 |
| `/invite user\|admin\|group <id>` | 添加白名单 |
| `/invite list` | 查看白名单 |
| `/invite remove user\|group <id>` | 移除白名单 |
| `/help` | 查看帮助 |

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

模型与 provider 的配置直接读写 dsh 官方配置存储（`~/.dsh/settings.yaml` 与
`~/.dsh/.credentials.yaml`，与 dsh Web **Settings → Models** 页面同一协议），改动在下一个
请求生效、无需重启 bot：

- `/model use <id>`：按会话热切换模型，下一轮消息即用新模型；`/model reset` 恢复默认。
- `/model default <id>`：写入 dsh 的 `agent-default-model`，作为新会话的默认模型。
- `/providers`：展示 dsh 已配置的 provider、模型与凭据状态（DeepSeek 官方 + 自定义 pi-ai）。
- `/provider add|update <id>`：新增 / 更新自定义 provider（`llm-pi-ai`）或 `deepseek-official`；
  自定义 provider 需要 `--api`（`openai-completions` / `openai-responses` / `anthropic-messages`）、
  `--base-url` 与至少一个 `--model`。`/provider remove <id>` 删除 provider。
- `/model add|remove <provider> <modelId>`：增删 provider 的模型目录。
- `/key set|remove|list`：读写 `~/.dsh/.credentials.yaml`（目录 0700、文件 0600）；settings
  只保存 `apiKeyEnv` 引用，字面密钥不进入 settings 或聊天记录。

除 `/model use`、`/model reset`、`/model`、`/providers`、`/key list` 外，其余写操作均需管理员
（`/invite admin <open_id>` 设置）。密钥值永不回显；在群聊中粘贴密钥会对群成员可见，建议仅在
私聊使用，或优先用 `--api-key-env` 引用环境变量 / 在 dsh Web 页面录入。

### 多角色 Agent

- `/role save <id> <name> --persona <文案>` 定义角色；`--model` 指定角色模型偏好，`--tools`
  给出工具指引（逗号分隔），`--rules` 给出角色规则（等价于角色级 AGENTS.md）。
- `/role set <id>` 把角色绑定到当前 scope，`/role clear` 解除；`/status` 会显示当前角色。
- 角色定义持久化在 `~/.dsh-lark/profiles/<profile>/roles.json`（0600），重启后绑定仍然生效。
- 模型优先级：每会话 `/model use` > 角色 `--model` > profile 偏好 > dsh 默认模型 > 环境默认。
- 角色 save / remove 仅管理员可执行；set / clear 任意被邀请用户可执行。

### 出站 @ 提及与跨会话通知

- 出站契约支持 `mentions`（`userId` + 可选 `name`），桥接层自动把 `<at>` 提及标记拼入消息体。
- `/notify <scope|chatId> <text>`：管理员向其他已注册会话推送消息；`/notify list` 查看
  bridge 已知的 scope（`<profile>/scopes.json` 持久化，重启不丢）。
- agent 侧工具 `lark_notify`：SDK / ACP runtime 均自动装配；参数 `text`、`scope`（目标会话，
  缺省当前会话）、`chat_id`（直连兜底）、`mention_user_ids`（@ 提及的 open_id 列表）。
  runtime 子进程通过 `http://127.0.0.1:<随机端口>/notify` + 每启动随机 token 回调 bridge，
  不暴露公网。
- agent 侧工具 `lark_ask_user`（问答卡）：agent 需要你拍板 / 确认 / 补充缺失信息时，通过
  `http://127.0.0.1:<随机端口>/ask` 回调 bridge，向当前会话弹单选 / 多选 / 自由文本问答卡并
  等待你回答；你提交后任务自动继续。等待期间任务运行超时看门狗暂停（答完重新计时）。
  与 `/ask`（你主动发结构化问题）方向相反。

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
  以 SDK 流式引擎实时展示思考 / 工具调用 / web search / 打字机式文字，并支持原生会话续跑；
  SDK 预置失败（如缺 pnpm）时回退 `~/.dsh/profiles/<dsh-profile>-safe`（`dsh-base` +
  `dsh-headless`），历史上下文自动拼接（每 scope 上限 30 条）。任一引擎下任务卡片都实时显示
  “正在思考 / 已运行 Ns / 无响应 Ns”，任务结束 / 出错 / 超时都有明确终态；单任务空闲超时默认
  10 分钟（`DSH_LARK_GUARDIAN_SAFE_TIMEOUT_MS`：任务持续无活动事件才被终止并真正停止 dsh
  子进程，活跃的流式任务不会被误杀）。
- `/safemode plugins` 执行 `dsh plugin --profile <name> list` 展示插件清单。
- `/safemode stop`（或卡片 ⏹ 按钮）终止当前安全模式任务；同一会话同时只允许一个任务，
  忙碌时新消息会立即收到“仍在处理中”回执。
- `/safemode exit` 以 detached 方式重启完整 profile，短暂延迟后断开飞书连接并交还通道；
  用户已有会话 / 工作区数据不受影响。
- dsh 重新在线（手动启动或退出安全模式）时，守护自动回归静默。

停止守护：在服务单元环境或启动命令中设 `DSH_LARK_GUARDIAN_DISABLED=1`，或
`dsh-lark-bot guardian uninstall`。

## 5. 会话与工作区 · Sessions & workspaces

- 每个飞书私聊、群聊、话题对应独立 scope。
- 每个 scope 默认保存最近 40 条对话（`/retention` 调整，`DSH_LARK_RETENTION_MSGS` 配置默认值）。
- 同一 scope 默认允许 2 个任务并行（`/concurrency` 或 `DSH_LARK_SCOPE_CONCURRENCY` 调整，
  1 为严格串行）；并行 run 各持独立 dsh session 与 runId，共享 scope 的会话转写与工作区，
  `/status` 显示全部 active runs，`/stop` 终止全部。
- 超出保留窗口的消息自动归档到 `~/.dsh-lark/profiles/<profile>/archives/`：每条归档同时写
  Markdown 转写与 JSONL 原始数据，归档目录初始化为独立 Git 仓库，每次归档 / 清理单独 commit，
  可审计、可回放；`/archive [note]` 可随时手动导出完整会话。
- 保留策略：每个 scope 最多保留 `DSH_LARK_ARCHIVE_MAX`（默认 50）条归档、超过
  `DSH_LARK_ARCHIVE_MAX_AGE_DAYS`（默认 90 天）的归档会被自动清理，`/archive clean` 手动触发。
- SDK 模式使用 dsh 原生 session 续跑，headless 模式把历史注入下一次 prompt 作为近似上下文。
- 工作目录是 Git 仓库时，自动创建独立 git worktree，避免多会话互相污染。
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

桥接引擎日志：以 JSON Lines 输出到 stderr（由 dsh 宿主进程捕获；`logs/bot.log` 是
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
| `DSH_LARK_TENANT` | `feishu` | `feishu` 或 `lark` |
| `DSH_LARK_WORKSPACE` | 未设置 | 新会话默认工作目录 |
| `DSH_LARK_DSH_COMMAND` | 自动发现 | dsh 启动命令 |
| `DSH_LARK_DSH_ARGS` | 自动发现 | dsh 启动参数 |
| `DSH_LARK_ADAPTER` | `sdk` | `sdk`（默认）/ `acp`（审批）/ `headless`（legacy）/ `web`（本地 dsh web agent，单写者） |
| `DSH_LARK_PROVIDER` | `deepseek-official` | 模型 provider |
| `DSH_LARK_MODEL` | `deepseek-v4-flash` | 默认模型 |
| `DSH_LARK_MAX_TOKENS` | 未设置 | SDK agent 输出 token 上限 |
| `DSH_LARK_WEB_URL` | `http://127.0.0.1:3080` | `web` 适配器：本地 dsh web agent base URL |
| `DSH_LARK_WEB_PUSH` | `true` | `web` 适配器：网页端回合完成推送飞书 + 自动切换会话映射（`0` 关闭） |
| `DSH_LARK_ACCESS_DEFAULT_DENY` | `false` | 无白名单时拒绝私聊 |
| `DSH_LARK_EVENT_FRESHNESS_MS` | `600000` | 过期消息拒绝窗口 |
| `DSH_LARK_RUN_TIMEOUT_MS` | `300000` | 单次运行空闲超时（持续无活动事件才终止） |
| `DSH_LARK_STOP_GRACE_MS` | `5000` | 优雅退出宽限期 |
| `DSH_LARK_SCOPE_CONCURRENCY` | `2` | 每个 scope 的并行任务数（1=严格串行） |
| `DSH_LARK_RETENTION_MSGS` | `40` | 每个 scope 保留的消息条数（0=全部保留） |
| `DSH_LARK_ARCHIVE_MAX` | `50` | 每个 scope 最多保留的归档数（0=不清理） |
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
桥接引擎）；无需任何独立服务环境快照。
