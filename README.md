<h1 align="center">dsh-lark-bot</h1>

<p align="center">
  <strong>把 DeepSeek Harness 接入飞书 | Bridge DeepSeek Harness into Feishu / Lark</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Feishu%20%2F%20Lark-3370FF" alt="Platform">
  <img src="https://img.shields.io/badge/agent-DeepSeek%20Harness-4D6BFE" alt="Agent">
  <img src="https://img.shields.io/badge/runtime-Node.js%20%E2%89%A5%2022-339933" alt="Node">
  <img src="https://img.shields.io/badge/License-AGPLv3-blue" alt="License">
  <img src="https://img.shields.io/badge/status-released-blue" alt="Status">
</p>

<br>

<div align="center">

让 **DeepSeek Harness（`dsh`）** 成为你飞书里的一员：在手机、群聊、话题里指挥本机 coding agent，把对话、任务、卡片和**项目工作区**都收进同一个协作流。

<br>

*Turn **DeepSeek Harness (`dsh`)** into a member of your Feishu / Lark workspace — drive your local coding agent from mobile, group chats and topics, and fold conversations, tasks, cards and **project workspaces** into one collaborative flow.*

</div>

---

## 快速开始 | Quick Start（普通用户先看这里 | for end users）

### 1. 安装 | Install

两个包名内容完全一致，任选一个即可：

Both package names ship identical content — pick either one:

```bash
# 推荐 | Recommended
npm install -g dsh-lark-bot

# 或飞书命名版本 | or the Feishu-named edition
npm install -g dsh-feishu-bot
```

安装完成后，对应命令分别为 `dsh-lark-bot` 和 `dsh-feishu-bot`。

After installation, the commands are `dsh-lark-bot` and `dsh-feishu-bot` respectively.

### 2. 启动后台服务并绑定飞书 | Start the background service and bind Feishu

```bash
dsh-lark-bot start
```

或： | or:

```bash
dsh-feishu-bot start
```

`start` 会自动在本机安装一个**后台服务**：加入系统开机自启列表，并在进程退出、崩溃或出错时自动重启。首次启动会：

`start` automatically installs a **background service** locally: it joins the OS autostart
list and restarts automatically whenever the process exits, crashes or errors. On first launch:

1. 在终端显示二维码。
2. 用飞书 / Lark App 扫码。
3. 选择或创建 PersonalAgent 应用。
4. 绑定成功后，bot 会向你的私聊发送欢迎卡片。
5. 私聊直接发消息；群聊或话题里 `@bot`。

1. A QR code is shown in the terminal.
2. Scan it with the Feishu / Lark app.
3. Choose or create a PersonalAgent app.
4. Once bound, the bot sends a welcome card to your private chat.
5. Message it directly in private chat; use `@bot` in group chats or topics.

绑定完成后 bot 转入后台运行，终端可以随时关闭。

After binding, the bot runs in the background; you can close the terminal anytime.

如果你已经有 PersonalAgent 应用，也可以跳过扫码：

If you already have a PersonalAgent app, you can skip the QR step:

```bash
dsh-lark-bot start \
  --app-id cli_xxx \
  --app-secret <secret> \
  --tenant feishu
```

### 3. 服务管理命令 | Service management commands

| 命令 Command | 作用 Description |
| :--- | :--- |
| `dsh-lark-bot start` | 安装后台服务、加入开机自启并启动（首次运行会先扫码绑定）<br>Install the background service, enable autostart and start it (first run prompts QR binding) |
| `dsh-lark-bot status` | 查看服务状态（退出码 0=运行中，1=未运行）<br>Show service status (exit code 0=running, 1=not running) |
| `dsh-lark-bot restart` | 重启后台服务（保留开机自启）<br>Restart the background service (keeps autostart) |
| `dsh-lark-bot stop` | 停止后台服务并移出开机自启<br>Stop the background service and remove autostart |

后台服务的运行日志写入 `~/.dsh-lark/profiles/<profile>/logs/bot.log`。

Background service logs are written to `~/.dsh-lark/profiles/<profile>/logs/bot.log`.

### 4. 基本使用 | Basic usage

在飞书里向 bot 发送普通消息即可开始工作，常用命令：

Just send a normal message to the bot in Feishu to get started. Common commands:

| 命令 Command | 作用 Description |
| --- | --- |
| `/new` `/reset` | 开始新会话<br>Start a new session |
| `/cd <path>` | 切换工作目录并重置会话<br>Change working directory and reset the session |
| `/ws list` | 查看命名工作空间<br>List named workspaces |
| `/ws save <name>` | 保存当前工作空间<br>Save the current workspace |
| `/ws use <name>` | 切换到命名工作空间<br>Switch to a named workspace |
| `/ws remove <name>` | 删除命名工作空间<br>Remove a named workspace |
| `/status` | 查看当前状态<br>Show current status |
| `/resume` | 查看当前会话最近上下文<br>Show the session's recent context |
| `/stop` | 终止当前任务<br>Stop the current task |
| `/timeout [N\|off\|default]` | 查看或设置当前会话运行超时<br>View or set the current session run timeout |
| `/retention [N\|default]` | 查看或设置保留消息条数（超出自动归档）<br>View or set the live message retention window (overflow is archived) |
| `/archive [note]`、`/archive list [N]`、`/archive clean` | 手动归档 / 查看 / 清理会话记录<br>Archive / list / clean session transcripts |
| `/density [compact\|standard\|detailed]` | 查看或设置卡片密度<br>View or set card density |
| `/model` | 查看当前模型、dsh 默认模型与可用模型列表<br>View current model, dsh default model and available models |
| `/model use <id>` | 热切换当前会话模型（下一轮生效，无需重启）<br>Hot-switch the current session model (effective next message, no restart) |
| `/model default <id>` | 写入 dsh 默认模型 `agent-default-model`（管理员）<br>Write the dsh default model `agent-default-model` (admin) |
| `/model add\|remove <provider> <modelId>` | 添加 / 删除 provider 的模型（管理员）<br>Add / remove a provider model (admin) |
| `/providers` | 查看 dsh 已配置 providers、模型与凭据状态<br>View configured dsh providers, models and credential status |
| `/provider add\|update\|remove <id>` | 管理 provider（管理员；deepseek-official 与自定义 pi-ai）<br>Manage providers (admin; deepseek-official and custom pi-ai) |
| `/key set\|remove\|list <引用名>` | 管理 dsh 凭据（set / remove 需管理员）<br>Manage dsh credentials (set / remove require admin) |
| `/ask <问题>` | 发送问答卡，回答写入会话上下文<br>Send a Q&A card; the answer is written back to session context |
| `/invite user\|admin\|group <id>`、`/invite list`、`/invite remove user\|group <id>` | 管理访问白名单<br>Manage the access allowlist |
| `/help` | 查看帮助<br>Show help |

飞书消息中的图片会下载到本地 media 目录并传给 dsh；文本类文件会读取内容并注入任务上下文。

Images in Feishu messages are downloaded to the local media directory and passed to dsh; text files are read and their content is injected into the task context.

### 模型 / Provider / 凭据管理 | Models / Providers / Credentials

模型与 provider 的配置以 dsh 官方方式持久化（与 dsh Web **Settings → Models** 页面完全相同的
存储协议），改动在下一个请求生效，无需重启 bot：

Model and provider configuration is persisted the official dsh way (the exact storage protocol
used by the dsh Web **Settings → Models** page); changes take effect on the next request without
restarting the bot:

- `/model use <id>`：按会话热切换模型，下一轮消息即用新模型。
- `/model default <id>`：写入 dsh 的 `agent-default-model`，作为新会话的默认模型。
- `/providers`：展示 dsh 已配置的 provider、模型与凭据状态（DeepSeek 官方 + 自定义 pi-ai）。
- `/provider add|update|remove`：管理自定义 provider（`llm-pi-ai`）或 `deepseek-official`；
  自定义 provider 需要 `--api`（`openai-completions` / `openai-responses` / `anthropic-messages`）、
  `--base-url` 与至少一个 `--model`，与官方 schema 一致。
- `/key set|remove|list`：读写 `~/.dsh/.credentials.yaml`（0600）。settings 只保存 `apiKeyEnv`
  引用，字面密钥不进入 settings 或聊天记录。

- `/model use <id>`: hot-switch the model for this session; the next message uses it.
- `/model default <id>`: write the dsh `agent-default-model` as the default for new sessions.
- `/providers`: show configured providers, models and credential status (official DeepSeek + custom pi-ai).
- `/provider add|update|remove`: manage custom providers (`llm-pi-ai`) or `deepseek-official`;
  a custom provider needs `--api` (`openai-completions` / `openai-responses` / `anthropic-messages`),
  `--base-url` and at least one `--model`, matching the official schema.
- `/key set|remove|list`: read / write `~/.dsh/.credentials.yaml` (0600). Settings keep only
  `apiKeyEnv` references; literal keys never enter settings or chat history.

安全提醒：在飞书会话里输入密钥会对该会话的可见成员暴露密钥，建议仅在私聊中使用，或优先用
`--api-key-env` 引用已配置的环境变量 / dsh Web 页面录入。bot 不会在任何回复中回显密钥值。

Security note: typing a key in a Feishu conversation exposes it to everyone who can see that
chat; prefer private chats, `--api-key-env` references to existing environment variables, or the
dsh Web UI. The bot never echoes key values in any reply.

### 5. 卸载 | Uninstall

```bash
dsh-lark-bot stop
npm uninstall -g dsh-lark-bot
rm -rf ~/.dsh-lark
```

更详细的安装、状态目录、日志和排障说明见 [`docs/QUICK_START.md`](docs/QUICK_START.md)。

See [`docs/QUICK_START.md`](docs/QUICK_START.md) for installation details, state directories,
logs and troubleshooting.

---

## 关键词 | Keywords

`dsh` · `deepseek` · `deepseek harness` · `feishu` · `lark` · `bridge` · `bot`

## 这是什么 | What it is

**dsh-lark-bot** 是一个轻量桥接工具，把本机的 DeepSeek Harness（`dsh`）接入飞书 / Lark，复刻当年 OpenCode Telegram Bot / MiMoCode Telegram Bot 的体验——在 IM 里与 coding agent 对话、收流式卡片、审阅 diff，并在此基础上叠加**完整的项目工作区管理**。

**dsh-lark-bot** is a lightweight bridge that connects your local DeepSeek Harness (`dsh`) into Feishu / Lark, recreating the beloved OpenCode / MiMoCode Telegram-bot experience — chat with your coding agent, receive streaming cards, review diffs — and adds **full project workspace management** on top.

## 目标 | Goals

- **一条命令启动**：clone 后一键安装运行，已发布到 npm，`npm i -g dsh-lark-bot && dsh-lark-bot start` 即可拉起后台服务。
- **飞书原生体验**：流式卡片、交互按钮、图片 / 文件，全程双语（文档评论为规划中能力）。
- **完整工作区管理**：多项目隔离、git worktree、项目级规则注入、上下文持久化。

- **One-command start**: clone and run in one step, published to npm — `npm i -g dsh-lark-bot && dsh-lark-bot start`.
- **Native Feishu experience**: streaming cards, interactive buttons, images / files, doc comments.
- **Full workspace management**: multi-project isolation, git worktrees, per-project rules, persistent context.

## 兼容性 | Compatibility

- **DeepSeek Harness（`dsh`）**：已验证 **dsh 0.1.0-rc.6**（2026-08-14：SDK JSON-RPC / ACP runtime 握手 +
  真实任务流式验证），通过官方 `@deepseek-ai/dsh-sdk-client` / `@deepseek-ai/dsh-acp` 接入；
  具体锁定版本、升级政策与自动化探测见 [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)，
  adapter 接入细节见 [`docs/adapter-notes.md`](docs/adapter-notes.md)。
- **运行时**：Node.js ≥ 22.19（见 `package.json` engines）。
- **平台**：Linux / macOS / Windows（飞书 WebSocket 出站长连接，免公网服务器 / 域名 / 内网穿透）。
- 默认 adapter 为官方 **`@deepseek-ai/dsh-sdk-client`**（SDK JSON-RPC runtime，原生 session 续跑 +
  token 级流式事件）；`DSH_LARK_ADAPTER=acp` 切到官方 **ACP server**（审批卡）；`headless` 保留旧版
  子进程 fallback。首次启动自动在 `~/.dsh/profiles/dsh-lark`（或 `dsh-lark-acp`）创建 runtime profile。

- **DeepSeek Harness (`dsh`)**: verified against **dsh 0.1.0-rc.6** (2026-08-14: SDK JSON-RPC / ACP
  runtime handshake + real streaming task verification), connected through the official
  `@deepseek-ai/dsh-sdk-client` / `@deepseek-ai/dsh-acp`; see
  [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) for pinned versions, the upgrade policy and
  automated probing, and [`docs/adapter-notes.md`](docs/adapter-notes.md) for adapter details.
- **Runtime**: Node.js ≥ 22.19 (see `engines` in `package.json`).
- **Platform**: Linux / macOS / Windows (Feishu outbound WebSocket long connection; no public
  server, domain or tunneling required).
- The default adapter is the official **`@deepseek-ai/dsh-sdk-client`** (SDK JSON-RPC runtime with
  native session continuation and token-level streaming events); `DSH_LARK_ADAPTER=acp` switches
  to the official **ACP server** (approval cards); `headless` keeps the legacy subprocess
  fallback. On first start the bot creates the runtime profile at
  `~/.dsh/profiles/dsh-lark` (or `dsh-lark-acp`).

## 配置 | Configuration

- 本地配置：`~/.dsh-lark/config.json`
- 状态根目录可用 `DSH_LARK_HOME` 覆盖
- 环境变量统一使用 `DSH_LARK_*` 前缀
- 模板见 [`.env.example`](.env.example)

- Local config: `~/.dsh-lark/config.json`
- The state root can be overridden with `DSH_LARK_HOME`
- Environment variables use the `DSH_LARK_*` prefix
- Template: [`.env.example`](.env.example)

会话运行在 Git 仓库中时，会自动在 `~/.dsh-lark/profiles/<profile>/worktrees/<scope>/` 创建隔离 worktree，并复制项目级 `AGENTS.md`。

When the session runs inside a Git repository, an isolated worktree is created at
`~/.dsh-lark/profiles/<profile>/worktrees/<scope>/` and a project-level `AGENTS.md` is copied in.

每个飞书 scope 默认保存最近 40 条对话消息（可用 `/retention` 或 `DSH_LARK_RETENTION_MSGS`
调整）；超出保留窗口的消息自动归档到 `~/.dsh-lark/profiles/<profile>/archives/`（Markdown +
JSONL，目录本身是 Git 仓库，每次归档独立 commit），支持 `/archive` 手动归档与保留策略清理。
SDK 模式下 dsh 原生 session 续跑，headless 模式则把历史注入下一次 prompt 实现近似记忆。

Each Feishu scope keeps the last 40 conversation messages by default (adjustable with
`/retention` or `DSH_LARK_RETENTION_MSGS`); messages beyond the retention window are archived to
`~/.dsh-lark/profiles/<profile>/archives/` (Markdown + JSONL inside a Git repository, one commit
per archive), and `/archive` exports the full session on demand. The SDK mode continues the native
dsh session, while headless mode approximates memory by injecting history into the next prompt.

当前核心环境变量：

Core environment variables:

| 变量 Variable | 默认值 Default | 说明 Description |
| :--- | :--- | :--- |
| `DSH_LARK_HOME` | `~/.dsh-lark` | 本地状态根目录<br>Local state root directory |
| `DSH_LARK_TENANT` | `feishu` | `feishu` 或 `lark`<br>`feishu` or `lark` |
| `DSH_LARK_WORKSPACE` | 未设置 | 新会话默认工作目录<br>Default working directory for new sessions |
| `DSH_LARK_DSH_COMMAND` | `自动发现` | dsh 启动命令；通常无需设置<br>dsh launch command; usually not needed |
| `DSH_LARK_DSH_ARGS` | `自动发现` | dsh 启动参数，逗号分隔；通常无需设置<br>dsh launch args, comma-separated; usually not needed |
| `DSH_LARK_ADAPTER` | `sdk` | `sdk`（默认）/ `acp`（审批）/ `headless`（legacy）<br>`sdk` (default) / `acp` (approval) / `headless` (legacy) |
| `DSH_LARK_PROVIDER` | `deepseek-official` | 模型 provider<br>Model provider |
| `DSH_LARK_MODEL` | `deepseek-v4-flash` | 默认模型<br>Default model |
| `DSH_LARK_MAX_TOKENS` | 未设置 | SDK agent 每请求输出 token 上限<br>Per-request output token cap for SDK agents |
| `DSH_LARK_ACCESS_DEFAULT_DENY` | `false` | 无白名单时拒绝私聊<br>Reject private chats when no allowlist is configured |
| `DSH_LARK_EVENT_FRESHNESS_MS` | `600000` | 过期消息拒绝窗口（0 关闭）<br>Stale-message rejection window (0 disables) |
| `DSH_LARK_RUN_TIMEOUT_MS` | `300000` | 单次运行墙钟超时<br>Wall-clock timeout for a single run |
| `DSH_LARK_STOP_GRACE_MS` | `5000` | SIGTERM 后等待优雅退出再 SIGKILL 的宽限期<br>Grace period after SIGTERM before SIGKILL |
| `DSH_LARK_RETENTION_MSGS` | `40` | 每个 scope 保留的消息条数（0=全部保留）<br>Messages kept per scope (0 keeps everything) |
| `DSH_LARK_ARCHIVE_MAX` | `50` | 每个 scope 最多保留的归档数（0=不清理）<br>Max archives kept per scope (0 disables pruning) |
| `DSH_LARK_ARCHIVE_MAX_AGE_DAYS` | `90` | 归档最大保留天数（0=不清理）<br>Max archive age in days (0 disables pruning) |

启动时会自动查找本机常见的 `@deepseek-ai/dsh` 安装位置。只有自动发现失败或需要指定特殊 profile 时，才需要设置这两个变量。

On startup the bot auto-discovers common local `@deepseek-ai/dsh` installations. Set these two
variables only when auto-discovery fails or a special profile is required.

## 权限与数据 | Permissions & Data

本工具在**本机**运行，安装前请知悉它会访问：

This tool runs **locally**; before installing, be aware that it accesses:

- **飞书凭据**：PersonalAgent 应用的 `app_id` / `app_secret`，明文写入本机 `~/.dsh-lark/config.json`（文件权限 600）。
- **文件系统**：读取 / 写入你通过 `/cd`、`/ws` 指定的工作目录（含执行 shell 命令、修改文件）。
- **网络**：向飞书开放平台建立 WebSocket 出站长连接收发消息；向 DeepSeek API 发送任务上下文。
- **进程**：spawn 本机 `dsh` runtime 子进程（`dsh-sdk-jsonrpc-server` / `dsh-acp` profile）执行 agent 任务。
- **dsh 配置**：`/model` `/providers` `/provider` `/key` 命令按 dsh 官方存储协议读写
  `~/.dsh/settings.yaml` 与 `~/.dsh/.credentials.yaml`（仅管理员可写；settings 只存 `apiKeyEnv`
  引用，凭据文件权限 0600、目录 0700，字面密钥不进入 settings 或聊天记录）。

- **Feishu credentials**: the PersonalAgent app `app_id` / `app_secret`, stored in plaintext at
  `~/.dsh-lark/config.json` (file mode 600).
- **File system**: reads / writes the working directories you choose with `/cd` and `/ws`
  (including running shell commands and modifying files).
- **Network**: an outbound WebSocket long connection to the Feishu open platform for messages, and
  task context sent to the DeepSeek API.
- **Processes**: spawns local `dsh` runtime subprocesses (`dsh-sdk-jsonrpc-server` / `dsh-acp`
  profiles) to run agent tasks.
- **dsh configuration**: `/model` `/providers` `/provider` `/key` read / write
  `~/.dsh/settings.yaml` and `~/.dsh/.credentials.yaml` using the official dsh storage protocol
  (admin-only writes; settings keep only `apiKeyEnv` references; credentials file mode 0600,
  directory 0700; literal keys never enter settings or chat history).

所有数据仅在本机与飞书、DeepSeek 之间流转，不收集、不上传任何遥测。密钥不会提交进仓库（见 `.gitignore`）。

All data flows only between this machine, Feishu and DeepSeek; nothing is collected or uploaded
as telemetry. Keys are never committed to the repository (see `.gitignore`).

## 排障 | Troubleshooting

先运行 `dsh-lark-bot doctor`，它会检查 profile、工作目录，并对当前 adapter 做真实可用性探测
（`sdk` / `acp` / `headless` 对应 runtime 的初始化握手）。

Run `dsh-lark-bot doctor` first; it checks the profile and working directory and performs a real
availability probe for the current adapter (`sdk` / `acp` / `headless` runtime handshake).

常见问题：

Common issues:

- **bot 静默 / 长连接失败**：查看 stderr 上的 JSONL 日志，关注 `channel` 与 `channel-command` 类别；SDK 会自动重连。
- **agent 无响应**：发送 `/status` 查看当前 scope、cwd 和 active run；发送 `/stop` 终止当前任务；超过 `DSH_LARK_RUN_TIMEOUT_MS` 时看门狗会自动终止。
- **首次扫码失败**：确认本机时间准确、网络可访问飞书开放平台；已拿到 App ID/Secret 时可用 `--app-id` / `--app-secret` 跳过扫码。

- **Silent bot / long-connection failure**: check the JSONL logs on stderr, focusing on the
  `channel` and `channel-command` categories; the SDK reconnects automatically.
- **Unresponsive agent**: send `/status` to view the scope, cwd and active run; send `/stop` to
  terminate the current task; the watchdog terminates it automatically after
  `DSH_LARK_RUN_TIMEOUT_MS`.
- **First QR binding fails**: make sure the local clock is accurate and the Feishu open platform
  is reachable; with an existing App ID/Secret you can skip scanning via `--app-id` /
  `--app-secret`.

以后台服务方式运行时，日志写入 `~/.dsh-lark/profiles/<profile>/logs/bot.log`（JSON Lines，
stdout 与 stderr 合并）；当前进程的 stderr 仍为 JSON Lines。

When running as a background service, logs go to `~/.dsh-lark/profiles/<profile>/logs/bot.log`
(JSON Lines, stdout and stderr merged); the current process's stderr is still JSON Lines.

## 开发 | Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm ci:local
pnpm release:check   # ci:local + 上游一致性检查 | ci:local + upstream consistency check
pnpm compat:probe    # 临时 DSH_HOME 安装锁定版 dsh，跑真实 SDK 握手 | installs pinned dsh into a temp DSH_HOME and runs a real SDK handshake
pnpm dsh:upstream    # 对比 npm 上游 stable 与锁定矩阵 | compares npm upstream stable with the pinned matrix
```

开发规范见 [`AGENTS.md`](AGENTS.md)，模块契约见 [`docs/API.md`](docs/API.md)，架构见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。
兼容矩阵的升级政策与自动化见 [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)。

See [`AGENTS.md`](AGENTS.md) for the development workflow, [`docs/API.md`](docs/API.md) for
module contracts, and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the architecture. See
[`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) for the compatibility matrix, upgrade policy
and automation.

发布双包（`dsh-lark-bot` 与 `dsh-feishu-bot` 共享同一份 dist / 版本 / 依赖）：

Publishing both packages (`dsh-lark-bot` and `dsh-feishu-bot` share the same dist / version /
dependencies):

```bash
pnpm publish:dual:dry-run
pnpm publish:dual
```

`scripts/publish-dual-packages.mjs` 从根 `package.json` 生成两份仅 `name` / `bin` 不同的发布清单，避免两份源码漂移。GitHub tag `v*` 会触发 [`release.yml`](.github/workflows/release.yml) 自动发布两个 npm 包并创建 Release。

`scripts/publish-dual-packages.mjs` generates two publish manifests from the root
`package.json`, differing only in `name` / `bin`, so the two copies never drift. A GitHub tag
`v*` triggers [`release.yml`](.github/workflows/release.yml) to publish both npm packages and
create a Release automatically.

同一份 dist 还会以 `@plutokeating/dsh-lark-bot` 和 `@plutokeating/dsh-feishu-bot` 发布到 GitHub Packages，便于在 GitHub Packages 页面查看。

The same dist is also published to GitHub Packages as `@plutokeating/dsh-lark-bot` and
`@plutokeating/dsh-feishu-bot`, viewable on the GitHub Packages page.

## 许可与安全 | License & Security

- **许可证**：GNU Affero General Public License v3.0（见 `LICENSE`）。
- **安全报告**：如发现安全漏洞，请通过 GitHub Security Advisory 私下报告，勿公开 issue。
- **安全模型**：默认拒绝、密钥脱敏、路径 containment、SSRF 防护、过期事件拒绝与交互工具
  默认禁用——详见 [`SECURITY.md`](SECURITY.md)。

- **License**: GNU Affero General Public License v3.0 (see `LICENSE`).
- **Security reports**: report vulnerabilities privately via GitHub Security Advisory; do not
  open a public issue.
- **Security model**: default-deny, secret redaction, path containment, SSRF protection, stale
  event rejection and default-disabled interactive tools — see [`SECURITY.md`](SECURITY.md).

## 文档 | Documentation

> 接手本项目的工程师：**先读 [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) 和 [`docs/RESEARCH.md`](docs/RESEARCH.md)**，即可完整理解项目诉求与来龙去脉，无需线下沟通。
> Engineers taking over this project: **read [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) and [`docs/RESEARCH.md`](docs/RESEARCH.md) first**.

| 文档 Doc | 内容 Content |
| :--- | :--- |
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | 完整项目诉求、产出预期、规范与约束<br>Complete requirements, outputs & specifications |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | 调研报告：官方现状、参考项目、可行性、技术差异<br>Research: official status, references, feasibility |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 架构分层与目录映射<br>Architecture layering & directory mapping |
| [`docs/API.md`](docs/API.md) | 模块接口与契约<br>Module interfaces & contracts |
| [`docs/QUICK_START.md`](docs/QUICK_START.md) | 安装与快速开始<br>Install & quick start |
| [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) | 兼容矩阵、升级政策与自动化<br>Compatibility matrix, upgrade policy & automation |
| [`docs/MANUAL.md`](docs/MANUAL.md) | 完整用户手册<br>Complete user manual |
| [`docs/adapter-notes.md`](docs/adapter-notes.md) | dsh adapter 接入说明（接口 / 落点 / 路线）<br>How to plug the dsh adapter |
| [`docs/ECOSYSTEM.md`](docs/ECOSYSTEM.md) | 生态兼容与交付标准（实现工程师必读）<br>Ecosystem & delivery standards (for engineers) |
| [`docs/roadmap.md`](docs/roadmap.md) | 路线图与里程碑<br>Roadmap & milestones |
| [`docs/PLAN.md`](docs/PLAN.md) | 主线开发计划与验收标准<br>Development plan & acceptance criteria |
| [`SECURITY.md`](SECURITY.md) | 安全模型与报告渠道<br>Security model & reporting |
| [`AGENTS.md`](AGENTS.md) | AI Agent 开发工作流规范<br>AI agent workflow spec |

## 架构 | Architecture

> 详见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for details.

```
飞书 / Lark ──WebSocket 长连接──▶ bridge/ ──▶ session/ ──▶ workspace/ ──▶ adapters/ ──▶ dsh ──▶ DeepSeek V4
```

核心思路：**飞书通道与 agent 后端解耦**。桥接层复刻 `lark-channel-bridge` 的成熟做法（WebSocket 长连接 + 流式卡片 + 会话路由），agent 后端通过 adapter 抽象，默认挂接官方 DeepSeek Harness SDK（`DSH_LARK_ADAPTER=sdk`），可选 ACP 审批模式与 legacy headless。

The core idea: **decouple the Feishu channel from the agent backend**. The bridge layer follows the battle-tested `lark-channel-bridge` approach (WebSocket long-connection + streaming cards + session routing); the agent backend is abstracted behind an adapter, defaulting to the official DeepSeek Harness SDK (`DSH_LARK_ADAPTER=sdk`), with an optional ACP approval mode and the legacy headless fallback.

## 目录结构 | Directory Structure

| 目录 Dir | 职责 Responsibility |
| :--- | :--- |
| `src/bridge/` | 飞书通道接入（消息、卡片、媒体）<br>Feishu channel integration |
| `src/onboard/` | 首次扫码创建 / 绑定 PersonalAgent 应用<br>First-run QR onboarding |
| `src/session/` | 会话路由、排队、访问控制<br>Session routing, queueing, access control |
| `src/workspace/` | 项目工作区、git worktree 隔离与规则注入<br>Project workspace, git worktree isolation & rule injection |
| `src/adapters/` | agent 后端适配器（sdk 默认 / acp 审批 / headless legacy）<br>Agent backend adapters (sdk / acp / headless) |
| `src/card/` | 流式卡片状态与渲染<br>Streaming card state & rendering |
| `src/bot/` | 运行注册、消息排队、审批/问答注册表<br>Run registry, queueing, approval/question registries |
| `src/commands/` | 斜杠命令（/cd /ws /new …）<br>Slash commands |
| `src/cli/` | CLI 入口与 start / status / restart / stop / doctor 命令<br>CLI entry & service commands |
| `src/config/` | profile / 配置 / 访问白名单 / dsh 配置管理<br>Profile, config, access & dsh config management |
| `src/core/` | 结构化日志<br>Structured logging |
| `src/media/` | 附件下载与文本注入<br>Attachment download & text injection |
| `src/platform/` | 跨平台原子写入<br>Cross-platform atomic writes |
| `src/service/` | 后台服务管理（systemd / launchd / 计划任务 / 便携 supervisor）<br>Background service management |
| `docs/` | 架构、路线图等文档<br>Architecture, roadmap & docs |
| `reference/` | 参考研究用的克隆仓库（不提交）<br>Cloned reference repos (not committed) |

## 路线图 | Roadmap

见 [`docs/roadmap.md`](docs/roadmap.md) | See [`docs/roadmap.md`](docs/roadmap.md).

## 参考项目 | References

| 项目 Project | 说明 About |
| :--- | :--- |
| [`zarazhangrui/lark-coding-agent-bridge`](https://github.com/zarazhangrui/lark-coding-agent-bridge) | 飞书 ↔ Claude Code / Codex 桥接，本项目的直接参照<br>Feishu ↔ Claude Code / Codex bridge; the direct reference for this project |
| [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) | DeepSeek Harness（`dsh`），agent 后端<br>DeepSeek Harness (`dsh`), the agent backend |
| [`grinev/opencode-telegram-bot`](https://github.com/grinev/opencode-telegram-bot) | OpenCode 的 Telegram 手机端，另一参照<br>Telegram mobile client for OpenCode; another reference |

## 免责声明 | Disclaimer

> [!NOTE]
> 本项目为非官方社区工具，与 DeepSeek、字节跳动 / 飞书（Lark）无关联，亦未获得其背书。DeepSeek Harness、Feishu / Lark 及相关商标归各自权利人所有。
>
> This is an unofficial community tool, not affiliated with or endorsed by DeepSeek or ByteDance / Feishu (Lark). DeepSeek Harness, Feishu / Lark and related trademarks belong to their respective owners.
