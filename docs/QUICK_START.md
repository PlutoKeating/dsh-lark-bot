# 快速开始 · Quick Start

> 本文描述 dsh-lark-bot 面向最终用户的安装与首次使用流程。

## 1. 前置条件

- Node.js ≥ 22.19
- 已安装 DeepSeek Harness（`dsh`）并配置 `DEEPSEEK_API_KEY`
- 一个飞书 / Lark 账号

## 2. 安装

```bash
npm install -g dsh-lark-bot
# 也可以安装飞书命名版本
npm install -g dsh-feishu-bot
# 或开发阶段：
git clone git@github.com:PlutoKeating/dsh-lark-bot.git
cd dsh-lark-bot
pnpm install
pnpm build
pnpm start
```

两个 npm 包的代码、版本、依赖与 dist 完全一致，只是包名与命令名不同；日常使用任选其一即可。

## 3. 首次启动

```bash
dsh-lark-bot start
# 或
dsh-feishu-bot start
```

1. 终端显示二维码。
2. 使用飞书 App 扫码。
3. 选择或创建 PersonalAgent 应用。
4. 绑定成功后，bot 发送欢迎卡片到私聊。
5. 直接发送消息即可开始使用；群聊中需要 `@bot`。

在 Git 仓库中工作时，bot 会为每个会话自动创建独立 git worktree；非 Git 目录则直接使用你指定的目录。

如果已经有一个 PersonalAgent 应用，也可以跳过扫码：

```bash
dsh-lark-bot start \
  --app-id cli_xxx \
  --app-secret <secret> \
  --tenant feishu
```

## 4. 常用命令

| 命令 | 作用 |
| --- | --- |
| `/new` | 开始新会话 |
| `/cd <path>` | 切换工作目录并重置会话 |
| `/ws list` | 查看命名工作空间 |
| `/ws save <name>` | 保存当前工作空间 |
| `/ws use <name>` | 切换到命名工作空间 |
| `/status` | 查看当前状态 |
| `/resume` | 查看当前会话最近上下文 |
| `/stop` | 终止当前任务 |
| `/timeout [N|off|default]` | 查看或设置当前会话运行超时 |
| `/density [compact|standard|detailed]` | 查看或设置卡片密度 |
| `/ask <问题>` | 发送结构化问答卡（回答写入会话上下文） |
| `/invite user|admin|group <id>`、`/invite list`、`/invite remove user|group <id>` | 管理访问白名单 |
| `/help` | 查看命令帮助 |

启动后如发现异常，先运行 `dsh-lark-bot doctor` 检查 profile、工作目录和本机 dsh 可用性。

默认 backend 为官方 `@deepseek-ai/dsh-sdk-client`（`DSH_LARK_ADAPTER=sdk`）：首次启动会自动在
`~/.dsh/profiles/dsh-lark` 创建 SDK JSON-RPC runtime profile（bundle `dsh-base` +
`dsh-sdk-jsonrpc-server`），需要本机可用 `pnpm`。审批场景可切换
`DSH_LARK_ADAPTER=acp`（`~/.dsh/profiles/dsh-lark-acp`，审批卡通过 ACP
`session/request_permission` 一问一答）；`headless` 保留旧版子进程 fallback。

bot 会为每个飞书 scope 保存最近 40 条对话，`/new` 会清空当前 scope 的会话记忆。

发送图片时，bot 会先下载到本地 media 目录；发送文本类文件时，会把文件内容注入给 dsh 处理。

## 5. 本地状态

- 配置文件：`~/.dsh-lark/config.json`
- 会话状态：`~/.dsh-lark/profiles/<profile>/sessions.json`
- 工作空间：`~/.dsh-lark/profiles/<profile>/workspaces.json`
- Git worktree：`~/.dsh-lark/profiles/<profile>/worktrees/`
- 运行日志：当前输出到 stderr JSON Lines；`~/.dsh-lark/profiles/<profile>/logs/` 为后续文件日志保留目录

可通过 `DSH_LARK_HOME` 修改状态根目录；`DSH_LARK_RUN_TIMEOUT_MS` 控制单次运行墙钟超时，`DSH_LARK_STOP_GRACE_MS` 控制优雅退出宽限期。
