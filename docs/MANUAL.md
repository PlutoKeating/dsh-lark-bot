# 用户手册 · User Manual

> 面向普通用户和运维者的完整使用手册。
> Complete manual for end users and operators.

## 1. 安装 · Installation

两个 npm 包内容一致，任选一个：

```bash
npm install -g dsh-lark-bot
# 或
npm install -g dsh-feishu-bot
```

安装后命令分别为：

```bash
dsh-lark-bot --version
dsh-feishu-bot --version
```

作为 dsh 插件安装（profile bundle）：

```bash
dsh plugin --profile <name> add dsh-lark-bot
```

profile 启动时装配 `dsh-lark-bot/plugin`：在 `ctx.larkBridge` 暴露 bridge 后台服务管理
（status / start / restart / stop），不阻塞 profile 启动；`DSH_LARK_AUTOSTART=1` 可在
profile 启动时自动拉起 bridge。pnpm ≥ 10 若因 `ERR_PNPM_IGNORED_BUILDS`（protobufjs）失败，
在 profile 目录 `pnpm-workspace.yaml` 加入 `allowBuilds: { protobufjs: true }` 后重试。

## 2. 后台服务与首次启动 · Background service & first start

`dsh-lark-bot start` 会在本机安装后台服务：加入开机自启列表，并在进程退出、崩溃或出错时自动重启。
首次启动会在终端显示二维码完成一次性绑定，绑定后 bot 转入后台运行，终端可以随时关闭。

```bash
dsh-lark-bot start
```

首次启动会显示二维码，用飞书 / Lark App 扫码，选择或创建 PersonalAgent 应用。

已拥有应用时，可跳过扫码：

```bash
dsh-lark-bot start \
  --app-id cli_xxx \
  --app-secret <secret> \
  --tenant feishu
```

## 3. 服务管理 · Service management

| 命令 | 作用 |
| :--- | :--- |
| `dsh-lark-bot start` | 安装后台服务、加入开机自启并启动（幂等，已安装时重启以应用最新环境） |
| `dsh-lark-bot status` | 查看安装状态、开机自启、运行状态、PID、重启次数 |
| `dsh-lark-bot restart` | 重启后台服务（保留开机自启） |
| `dsh-lark-bot stop` | 停止后台服务并移出开机自启 |

实现机制：

- Linux：systemd user service（`Restart=always`）；无 systemd 时降级为自带 supervisor + XDG autostart。
- macOS：LaunchAgent（`KeepAlive` + `RunAtLoad`）。
- Windows：计划任务（登录时启动 + 失败自动重启）。

服务进程环境来自 `~/.dsh-lark/service/service.env`（0600），由 `start` / `restart` 从当前终端环境快照。

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
- adapter 模式与 dsh 是否真实可用（`sdk` / `acp` / `headless` 对应 runtime 探测）

后台服务运行日志：`~/.dsh-lark/profiles/<profile>/logs/bot.log`（JSON Lines，stdout + stderr）。
服务状态可用 `dsh-lark-bot status` 查看；服务未运行时先检查该日志再运行 `doctor`。

## 8. 卸载 · Uninstall

```bash
dsh-lark-bot stop
npm uninstall -g dsh-lark-bot
rm -rf ~/.dsh-lark
```

## 9. 环境变量 · Environment

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_LARK_HOME` | `~/.dsh-lark` | 本地状态根目录 |
| `DSH_LARK_TENANT` | `feishu` | `feishu` 或 `lark` |
| `DSH_LARK_WORKSPACE` | 未设置 | 新会话默认工作目录 |
| `DSH_LARK_DSH_COMMAND` | 自动发现 | dsh 启动命令 |
| `DSH_LARK_DSH_ARGS` | 自动发现 | dsh 启动参数 |
| `DSH_LARK_ADAPTER` | `sdk` | `sdk`（默认）/ `acp`（审批）/ `headless`（legacy） |
| `DSH_LARK_PROVIDER` | `deepseek-official` | 模型 provider |
| `DSH_LARK_MODEL` | `deepseek-v4-flash` | 默认模型 |
| `DSH_LARK_MAX_TOKENS` | 未设置 | SDK agent 输出 token 上限 |
| `DSH_LARK_ACCESS_DEFAULT_DENY` | `false` | 无白名单时拒绝私聊 |
| `DSH_LARK_EVENT_FRESHNESS_MS` | `600000` | 过期消息拒绝窗口 |
| `DSH_LARK_RUN_TIMEOUT_MS` | `300000` | 单次运行墙钟超时 |
| `DSH_LARK_STOP_GRACE_MS` | `5000` | 优雅退出宽限期 |
| `DSH_LARK_RETENTION_MSGS` | `40` | 每个 scope 保留的消息条数（0=全部保留） |
| `DSH_LARK_ARCHIVE_MAX` | `50` | 每个 scope 最多保留的归档数（0=不清理） |
| `DSH_LARK_ARCHIVE_MAX_AGE_DAYS` | `90` | 归档最大保留天数（0=不清理） |

`start` / `restart` 会把当前终端的 `DSH_LARK_*`、`DEEPSEEK_API_KEY`、`DSH_HOME`、`PATH`、`HOME`
快照到 `~/.dsh-lark/service/service.env`（权限 0600），后台服务启动时读取；修改环境后重新执行
`dsh-lark-bot start` 或 `restart` 即可生效。
