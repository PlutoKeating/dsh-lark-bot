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

## 2. 首次启动 · First start

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

## 3. 飞书内命令 · In-chat commands

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
| `/timeout [N|off|default]` | 查看或设置运行超时 |
| `/density [compact|standard|detailed]` | 查看或设置卡片密度 |
| `/ask <问题>` | 发送问答卡，回答写入会话上下文 |
| `/invite user|admin|group <id>` | 添加白名单 |
| `/invite list` | 查看白名单 |
| `/invite remove user|group <id>` | 移除白名单 |
| `/help` | 查看帮助 |

## 4. 会话与工作区 · Sessions & workspaces

- 每个飞书私聊、群聊、话题对应独立 scope。
- 每个 scope 保存最近 40 条对话；SDK 模式使用 dsh 原生 session 续跑，headless 模式把历史
  注入下一次 prompt 作为近似上下文。
- 工作目录是 Git 仓库时，自动创建独立 git worktree，避免多会话互相污染。
- 非 Git 目录直接使用指定目录。
- 项目根目录有 `AGENTS.md` 时，会注入到 worktree。

## 5. 权限 · Permissions

- 首次扫码创建者自动写入白名单。
- 使用 `/invite user <open_id>` 允许用户私聊。
- 使用 `/invite group <chat_id>` 允许群聊。
- 使用 `/invite admin <open_id>` 设为管理员。
- 白名单非空时，飞书 SDK 启用 DM / group allowlist。

## 6. 诊断与排障 · Diagnostics

```bash
dsh-lark-bot doctor
```

会检查：

- profile 是否可读
- 访问白名单用户数 / 群聊数
- 工作目录是否存在
- adapter 模式与 dsh 是否真实可用（`sdk` / `acp` / `headless` 对应 runtime 探测）

运行日志当前输出到 stderr JSON Lines。

## 7. 卸载 · Uninstall

```bash
npm uninstall -g dsh-lark-bot
rm -rf ~/.dsh-lark
```

## 8. 环境变量 · Environment

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
