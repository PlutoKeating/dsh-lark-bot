# DeepSeek Harness 连接飞书（dsh-lark-bot 桥接插件）

> 本文是面向 runoob.com「DeepSeek Harness 教程」栏目的投稿文章（原创），
> 配套可直接粘贴进 runoob 投稿编辑器的 HTML 版本见 `docs/runoob-deepseek-harness-feishu-tutorial.html`。

## 为什么要把 DeepSeek Harness 装进飞书

DeepSeek Harness（`dsh`）是 DeepSeek 开源的 AI Agent 运行框架，采用「一切皆插件」的架构，默认提供
Web UI（`http://127.0.0.1:3080`）。使用官方 Web UI 时，你通常需要坐在电脑前打开浏览器才能指挥
agent 干活。如果你在通勤路上、开会间隙，想用手机给本机 agent 发一句话让它跑测试、改代码、查文档，
就需要一个 IM 入口。

`dsh-lark-bot` 正是这样一个开源桥接插件：它把本机的 DeepSeek Harness 接入飞书 / Lark，
**扫码 30 秒绑定**，之后在飞书私聊、群聊、话题里发消息即可指挥本机 coding agent。它使用飞书
WebSocket 长连接（出站），**不需要公网 IP、域名、服务器或内网穿透**，代码始终只在本机运行。

## 准备工作

| 项目 | 要求 |
| --- | --- |
| Node.js | ≥ 22.19 |
| DeepSeek Harness | 已安装 `dsh` 并配置 `DEEPSEEK_API_KEY` |
| 飞书 / Lark | 一个可扫码登录的账号 |
| 网络 | 可访问飞书开放平台（大陆网络可直接使用） |
| 公网条件 | 不需要公网 IP / 域名 / 服务器 / 内网穿透 |

## 安装（一条命令）

`dsh-lark-bot` 以标准 dsh profile bundle 交付，安装命令：

```bash
npx dsh-lark-bot@latest setup --profile dsh-lark
```

`setup` 会自动完成：定位本机 dsh → 预批准 pnpm 构建策略 → 执行标准
`dsh plugin --profile dsh-lark add dsh-lark-bot@<版本>`，并默认同时安装「安全网守护」
（系统级常驻进程，dsh 全部下线后飞书救援入口仍存活；不需要时加 `--no-guardian`）。

## 启动并扫码绑定

```bash
dsh --profile dsh-lark
```

首次启动（无凭据时）终端会打印二维码：

1. 用飞书 / Lark App 扫码；
2. 选择或创建 PersonalAgent 应用；
3. 绑定成功后，桥接引擎在 dsh 进程内运行，并向私聊发送欢迎卡片；
4. 私聊直接发消息即可，群聊 / 话题中需要 `@bot`。

已有 PersonalAgent 应用时，可在启动命令中提供凭据跳过扫码：

```bash
DSH_LARK_APP_ID=cli_xxx DSH_LARK_APP_SECRET=<secret> DSH_LARK_TENANT=feishu \
  dsh --profile dsh-lark
```

## 基本使用

在飞书里给机器人发普通消息即可开始工作，常用命令：

命令帮助、状态/错误提示和交互卡片内置中文 / English：同一张 Card JSON 2.0 群卡会按每位读者的
客户端语言显示，普通 Markdown/toast 降级则中英并列。agent 回答和用户原文不会被自动翻译。

| 命令 | 作用 |
| --- | --- |
| `/new` `/reset` | 开始新会话 |
| `/cd <path>` | 切换到该目录的独立会话（切回可继续） |
| `/ws list` `/ws save <name>` `/ws use <name>` | 查看 / 保存 / 切换命名工作空间 |
| `/status` | 查看可刷新状态卡、上下文/token 用量、待处理卡与任务账本 |
| `/jobs [list|show <消息ID>|retry <消息ID>]` | 对账任务状态、查看 checkpoint、显式重试中断/失败任务 |
| `/stop` | 终止当前任务 |
| `/concurrency [N]` | 查看或设置当前 scope 并行任务数（默认 2） |
| `/role list` `/role set <id>` | 查看角色 / 为当前 scope 绑定角色 |
| `/notify <scope|chatId> <text>` | 跨会话发送通知（管理员） |
| `/archive` `/archive list` | 归档 / 查看会话记录 |
| `/model use <id>` | 热切换当前会话模型（下一轮生效） |
| `/key set|remove|list` | 管理 dsh 凭据 |
| `/help` | 查看命令帮助 |

会话按 `scope + workspace` 保存；`/cd` / `/ws use` 会中断旧工作区仍在运行的任务，但不删除上下文，
A → B → A 会恢复 A。只有 `/new` / `/reset` 清空当前工作区。状态 pending 与归档操作也只属于当前
workspace；Git 项目 worktree 按 scope + 项目路径分别创建，旧版 worktree 核验真实 owning repo 后，
会话与旧自动归档归回该项目并迁移，
若当前指针已到另一项目则保留旧树并另建新树，未提交文件不会被覆盖。

## 核心能力

### 安全网守护：dsh 崩溃后飞书仍叫得应

DSH 进程崩溃后，其他方案的机器人会变成「死号」，只能回服务器手动重启。`dsh-lark-bot` 默认安装的
守护进程独立于 dsh 运行，一旦检测到 dsh 下线或无法启动，会自动接管飞书通道：

- `/safemode`：进入仅核心安全模式（只加载官方 `dsh-base` + `dsh-headless`，不加载第三方插件），
  在飞书里逐条对话定位、修复损坏的插件；
- `/safemode plugins`：列出故障 profile 已安装的插件清单；
- `/safemode status`：查看守护 / dsh / 安全模式状态；
- `/safemode exit`：退出安全模式，守护重启完整 profile 并把飞书通道交还。

全程不需要命令行，dsh 恢复后守护自动回归静默。

### 可选：让正常 profile 登录自启

安装完成后执行 `dsh-lark-bot service install --profile dsh-lark`，即可由 systemd user /
LaunchAgent / Windows 登录计划任务托管同一个标准 dsh profile；用 `service status`、
`service logs -f`、`service restart|stop|start|uninstall` 运维。它不是第二套桥接引擎，guardian
与升级流程也会优先复用该服务，避免重复启动。机器睡眠期间不能收消息，恢复网络后自动重连并提示。

### 多角色 Agent：一个机器人，一整个团队

用 `/role save` 定义 PM / 开发 / 文档等角色（persona、模型偏好、工具指引、角色规则），
再用 `/role set <id>` 绑定到当前 scope。每个角色有持久化的人设与规则。

### 多机器人 @ 交接：一个群，多个独立 Agent

用 `dsh-lark-bot bot add reviewer --model gateway/review-model` 增加独立 PersonalAgent 实例；
每个实例有自己的模型、凭据、服务与上下文。把实例加入同一群后，只有登记为可信 peer 的 bot
通过真实 @ 才能交接任务；连续 bot 回合默认最多 6 次，真人消息会重置，避免无限互聊。
`bot list|status|remove` 用于查看和移除实例；移除时保留 session/worktree/archive 数据。
附加实例使用 SDK/ACP（或 legacy headless）；共享 Web agent 的广播流无法隔离 session，因此不支持 Web adapter。

### 并行多任务：不用排队

同一群里可以同时跑多个任务，各自会话隔离（默认 2 个并行，`/concurrency` 可调），
连续发来的多条消息会以独立 run 并行推进。

### 崩溃后任务可对账

普通任务先写入本机 `jobs.json`（0600）再排队。进程重启后 queued 自动恢复；已经 running 的任务
转为 interrupted 并保留最后安全 checkpoint，不会自动重复可能已有副作用的命令。用 `/jobs show`
核对后再 `/jobs retry`。这只保证 bridge 已经接收并落盘的消息；断网期间平台未投递的事件无法恢复。

### 会话归档与清理

`/archive` 归档旧任务、`/retention` 配置自动保留策略，长期使用会话列表也不会越积越多。

### 跨会话主动通知

Agent 在 A 群跑完任务，可以主动发消息到 B 群或私聊并 `@` 你（内置 `lark_notify` dsh 工具），
而不是「你问它答」。

### 对话内管理模型和密钥

`/model`、`/providers`、`/provider`、`/key` 直接在聊天里查看、切换供应商、热更新密钥，
全程不离开飞书；密钥写入 `~/.dsh/.credentials.yaml`（0600），不在聊天记录中显示。

## 安全性说明

- 数据只在本机、飞书与 DeepSeek 之间流转，不收集、不上传任何遥测；
- 密钥不写入仓库，访问白名单用 `/invite` 管理；
- 项目从不提供 Windows `.exe` 或「下载即运行」的安装包，任何以项目名义分发 exe 的页面或仓库
  均为假冒 / 恶意来源，请认准官方渠道（见文末链接）。

## 升级与卸载

```bash
# 升级（v0.12.0+ 推荐）：升级包 + 守护 + 升级后验证
npx dsh-lark-bot@latest upgrade --profile dsh-lark --yes

# 卸载
dsh plugin --profile dsh-lark remove dsh-lark-bot
```

## 常见问题

**扫码失败？** 确认本机时间准确、网络可访问飞书开放平台；已有 App ID/Secret 时可用
`--app-id` / `--app-secret` 跳过扫码。

**机器人静默 / 长连接失败？** 查看 stderr 上的 JSONL 日志（关注 `channel` 类别），
SDK 会自动重连；也可先运行 `dsh-lark-bot doctor` 检查 profile 与本机 dsh 可用性。

**agent 无响应？** 发送 `/status` 查看 scope、cwd、模型、active run、真实 context/token 指标和
待审批/提问/计划（未知值显示“暂无”，卡片可原位刷新）；`/stop` 终止当前任务；
持续无响应超过 `DSH_LARK_RUN_TIMEOUT_MS` 时看门狗会自动终止（空闲超时，活跃任务不会被误杀）。

**高风险操作如何确认？** 默认 SDK 已内置逐操作门禁：执行命令、修改/删除文件等动作前会弹
“允许执行一次 / 拒绝”卡，显示理由和参数。等待期间任务不会 idle timeout；拒绝后 agent 会收到
结果并改用安全方案。群聊成员能看到卡片内容，敏感命令请在私聊处理。

**dsh 崩溃了怎么办？** 直接发 `/safemode`，守护会拉起仅核心安全模式，修复后 `/safemode exit` 恢复。

## 参考链接

- GitHub 仓库：https://github.com/PlutoKeating/dsh-lark-bot
- npm 包：https://www.npmjs.com/package/dsh-lark-bot（同源双包 `dsh-feishu-bot`）
- 项目文档：https://github.com/PlutoKeating/dsh-lark-bot/tree/main/docs
- 落地页：https://dsh-lark-bot.arr2018.dpdns.org
- DeepSeek Harness：https://github.com/deepseek-ai/deepseek-harness
