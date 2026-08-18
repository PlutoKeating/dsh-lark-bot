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

**dsh-lark-bot 把遥控器装进你的飞书**：在私聊、群聊、话题里直接指挥本机 dsh coding agent，流式卡片实时看思考与工具调用；任务完成主动推送到你所在的任何群并 @ 你；即使 dsh 崩溃下线，飞书里依然叫得应——发 `/safemode` 进入仅核心安全模式，直接在聊天里定位问题、重启引擎。**这是唯一“dsh 挂了你不会失联”的桥接方案。**

**适合谁**：在飞书 / Lark（私聊、群聊、话题）里指挥本机 dsh coding agent 的开发者与团队，尤其是需要多项目隔离、角色分工、并行任务与会话归档的协作场景。

## 能做什么

**基础能力**：

- 私聊、群聊、话题（thread）里指挥本机 dsh coding agent，图片 / 文本文件直接发给 bot 即可；
- 流式卡片实时展示思考、工具调用与结果，支持交互按钮（停止 / 审批 / 问答卡）；
- Git 仓库内为每个会话自动创建隔离 worktree 项目工作区，多项目互不干扰。

**六项全网独有组合**：

- 🆘 **Guardian 安全网守护——“永远叫得应”**：DSH 崩溃后飞书仍会回复你，`/safemode` 进入仅核心安全模式直接重启。
- 👥 **多角色 Agent——“一个机器人，一整个团队”**：`/role` 切换或指派 PM / 开发 / 文档等角色，每个角色独立人设、模型偏好与规则。
- ⚡ **并行多任务——“不用排队”**：同一群聊同时跑多个任务、会话隔离；其他方案只能串行排队。
- 🗂 **会话归档与清理——“会话列表不会烂掉”**：`/archive` 归档旧任务、`/retention` 配置自动保留策略。
- 📣 **跨会话主动通知 + @人——“活干完了它会来找你”**：A 群跑完任务主动推送到 B 群 / 私聊并 @ 你。
- 🔑 **对话内管理模型和密钥——“不用离开飞书”**：`/providers` `/provider` `/key` 直接查看、切换供应商、热更新密钥。

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

`setup` 自动完成：定位本机 dsh → 预批准 pnpm 构建策略 → 标准 `dsh plugin add` → 默认安装「安全网守护」系统服务，一条命令完成全部安装。

> **无需公网 IP / 域名 / 服务器 / 内网穿透**（飞书 WebSocket 出站长连接），Linux / macOS / Windows 通用。
> 已有 PersonalAgent 应用时可跳过扫码（见「配置」）：`DSH_LARK_APP_ID=cli_xxx DSH_LARK_APP_SECRET=<secret> DSH_LARK_TENANT=feishu dsh --profile dsh-lark`
> 升级同样一条命令：`npx dsh-lark-bot@latest upgrade --profile dsh-lark --yes`

## 完整使用方式

### 常用命令

在飞书里向 bot 发送普通消息即可开始工作，常用命令：

| 命令 | 作用 |
| --- | --- |
| `/new` `/reset` | 开始新会话|
| `/newg <群名>` | 自动新建群聊（拉你入群）并开新会话，当前会话保留|
| `/cd <path>` | 切换工作目录并重置会话|
| `/ws list` | 查看命名工作空间|
| `/ws save <name>` | 保存当前工作空间|
| `/ws use <name>` | 切换到命名工作空间|
| `/ws remove <name>` | 删除命名工作空间|
| `/status` | 查看当前状态|
| `/resume` | 查看当前会话最近上下文|
| `/stop` | 终止当前任务|
| `/timeout [N\|off\|default]` | 查看或设置当前会话运行超时|
| `/concurrency [N\|default]` | 查看或设置当前 scope 并行任务数（默认 2）|
| `/role list`、`/role show <id>` | 查看角色列表 / 详情|
| `/role set <id>`、`/role clear` | 为当前 scope 绑定 / 解除角色|
| `/role save <id> <name> [--persona 文案] [--model <id>] [--tools <csv>] [--rules 文案]` | 创建 / 更新角色（管理员）|
| `/role remove <id>` | 删除角色（管理员）|
| `/notify <scope\|chatId> <text>` | 跨会话发送通知（管理员）|
| `/notify list` | 查看 bridge 已注册的 scope|
| `/retention [N\|default]` | 查看或设置保留消息条数（超出自动归档）|
| `/archive [note]`、`/archive list [N]`、`/archive clean` | 手动归档 / 查看 / 清理会话记录|
| `/density [compact\|standard\|detailed]` | 查看或设置卡片密度|
| `/model`、`/providers`、`/provider`、`/key` | 打开交互式管理卡片（BotFather 式多轮向导；选择用按钮、填写用卡片输入、写入前确认）|
| `/model use <id>` | 热切换当前会话模型（下一轮生效，无需重启）|
| `/model default <id>` | 写入 dsh 默认模型 `agent-default-model`（管理员）|
| `/model add\|remove <provider> <modelId>` | 添加 / 删除 provider 的模型（管理员）|
| `/provider add\|update\|remove <id>` | 管理 provider（管理员；deepseek-official 与自定义 pi-ai）|
| `/key set\|remove\|list <引用名>` | 管理 dsh 凭据（set / remove 需管理员）|
| `/ask <问题>` | 发送问答卡，回答写入会话上下文|
| `/invite user\|admin\|group <id>`、`/invite list`、`/invite remove user\|group <id>` | 管理访问白名单（写操作需管理员）|
| `/help` | 查看帮助|

飞书消息中的图片会下载到本地 media 目录并传给 dsh；文本类文件会读取内容并注入任务上下文。

**`/newg <群名>`**：自动新建私密群、拉发送者入群并回复群链接——新群即新 scope / 新会话，当前会话不受影响。需应用具备 `im:chat` 与 `im:chat.members:write_only` 权限。

同一 scope（私聊 / 群聊 / 话题）默认 **2 个任务并行**（`DSH_LARK_SCOPE_CONCURRENCY` 或 `/concurrency` 调整）：多条消息以独立 run 并行推进，每个 run 使用独立 dsh session 与 runId；`/status` 查看全部运行中的 run，`/stop` 一次性终止。

**多角色 Agent**：管理员用 `/role save <id> <name> --persona <文案> [--model <id>] [--tools <csv>] [--rules <文案>]` 定义 PM / 开发 / 文档等角色，`/role set <id>` 绑定到当前 scope；每个 run 携带角色 persona 与规则，角色模型低于每会话 `/model use`。角色定义持久化在 `~/.dsh-lark/profiles/<profile>/roles.json`。

**出站 @ 提及与跨会话通知**：`/notify <scope|chatId> <text>` 可向其他会话推送汇报（管理员）；agent 侧内置 `lark_notify` dsh 工具（SDK / ACP runtime 均可装配），任务完成后主动向其他群 / 话题发消息并 @ 成员。回调走 127.0.0.1 本地端口 + 随机 token，不暴露公网。

**任务中向你提问（问答卡）**：agent 需要你拍板、确认或补充信息时，通过 `lark_ask_user` 工具弹**问答卡**（单选 / 多选 / 自由文本），回答后任务自动继续，等待期间运行超时看门狗暂停。（与 `/ask` 的“你主动提问”方向相反。）

审批卡与问答卡提交后会立即显示成功提示、发送一条终态确认并撤回原卡，避免按钮仍停留在聊天中造成“未生效”的误解；确认或撤回失败不会影响已经提交给 agent 的审批结果或答案。

**安全网守护**：独立于 dsh 进程、系统级常驻的最小守护进程（systemd / LaunchAgent / Windows 启动项），默认随 `setup` 安装。dsh 正常时静默；dsh 下线或无法 boot（如第三方插件破坏 profile 组合）时自动接管飞书通道，无需命令行即可自救：

- `/safemode`：进入**仅核心安全模式**（仅 `dsh-base` + `dsh-headless` 官方核心，**不加载第三方插件**），优先 SDK 流式引擎、失败回退 headless，直接在聊天里定位 / 修复 / 禁用损坏插件；
- `/safemode plugins`：列出故障 profile 的插件清单；`/safemode status`：查看状态；`/safemode stop`：终止当前安全任务（或点卡片 ⏹）；`/safemode exit`：重启完整 profile 并交还通道。

安全模式任务有**空闲超时**（`DSH_LARK_GUARDIAN_SAFE_TIMEOUT_MS`，默认 10 分钟，仅持续无活动事件才终止），超时 / 失败都给出明确终态。安装：

```bash
# 随 setup 默认安装；已安装后也可单独安装 / 重装：
dsh-lark-bot guardian install --dsh-profile dsh-lark
```
不需要时 `setup --no-guardian` 跳过；单独卸载用 `dsh-lark-bot guardian uninstall`。

### 模型 / Provider / 凭据管理

配置以 dsh 官方方式持久化（与 dsh Web **Settings → Models** 同一存储协议），改动下一请求生效、无需重启：

- **交互式管理卡片**：`/providers`（或 `/provider`、`/model`、`/key`）打开管理卡片，按
  BotFather 式的多轮向导完成增删改查——能选择的用按钮点选（API 协议、provider、模型、凭据引用），
  需要填值的用卡片输入（ID、Base URL、模型列表、密钥值），写入前有确认卡，随时可取消。
- `/model use <id>`：按会话热切换模型（下一轮生效）；`/model default <id>`：写入 dsh 默认模型。
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
  own-package 链接重指到新版本（避免下次启动重新预置）。

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

**A:** 功能组合最全：安全网守护、多角色 Agent、并行多任务、会话归档、跨会话主动通知、对话内模型 / 密钥管理六项合一；标准 dsh profile bundle，`npx dsh-lark-bot@latest setup` 一条命令安装，无需独立 Docker / 后台服务。

**Q: 项目从哪下载？会不会有假冒版本？**

**A:** 唯一官方仓库是 [github.com/PlutoKeating/dsh-lark-bot](https://github.com/PlutoKeating/dsh-lark-bot)，唯一官方 npm 包是 `dsh-lark-bot` / `dsh-feishu-bot`（维护者 `plutokeating`）。本项目从不提供 .exe 或“下载即运行”的安装包；任何以项目名义分发 exe 的仓库或页面都是假冒来源，请勿运行（详见文末「假冒仓库警告」）。

---

## 关键词

`dsh` · `deepseek` · `deepseek harness` · `feishu` · `lark` · `bridge` · `bot` ·
`chatbot` · `messaging` · `qrcode` · `typescript` · `feishu-bot` · `lark-bot` ·
`dsh-plugin` · `deepseek-harness` · `im-bridge` · `ai-agent` · `workspace` · `self-healing`

## 兼容性

- **DeepSeek Harness（`dsh`）**：已验证 **dsh 0.1.0-rc.6**（最后验证 2026-08-15：SDK JSON-RPC / ACP runtime 握手 +
  真实任务流式验证），通过官方 `@deepseek-ai/dsh-sdk-client` / `@deepseek-ai/dsh-acp` 接入；
  具体锁定版本、升级政策与自动化探测见 [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)，
  adapter 接入细节见 [`docs/adapter-notes.md`](docs/adapter-notes.md)。
- **运行时**：Node.js ≥ 22.19（见 `package.json` engines）。
- **平台**：Linux / macOS / Windows（飞书 WebSocket 出站长连接，免公网服务器 / 域名 / 内网穿透）。
- 默认 adapter 为官方 **`@deepseek-ai/dsh-sdk-client`**（SDK JSON-RPC runtime，原生 session 续跑 +
  token 级流式事件）；`DSH_LARK_ADAPTER=acp` 切到官方 **ACP server**（审批卡）；`headless` 保留旧版
  子进程 fallback；`DSH_LARK_ADAPTER=web` 驱动**本地 dsh web agent**（`session.prompt` +
  `/api/events.mux`，网页端成为唯一写者，从根上消除多写者会话损坏）。首次启动自动在
  `~/.dsh/profiles/dsh-lark-sdk`（或 `dsh-lark-acp`）创建 runtime profile。

## 已知限制

- ACP 模式会话每次全新（上游限制，无续跑）；SDK 协议暂无 mid-turn cancel，`/stop` 会关闭
  对应 runtime 并自动重建。
- 桥接引擎作为 dsh 插件在 dsh 进程内运行，agent 执行使用官方 dsh SDK runtime 子进程
  （嵌套 runtime 是有意取舍，用于按工作区隔离的 runtime 池与 scope 内并行 run）。
  唯一的进程级例外是默认安装的「安全网守护」——它独立于 dsh / Cordis 常驻，仅在 dsh
  下线后接管飞书通道，正常运行时保持静默。
- 飞书文档评论、富文本回复为规划中能力，尚未实现。
- pnpm ≥ 10 的构建脚本策略由 `setup` 自动处理；手动 `dsh plugin add` 时若报
  `ERR_PNPM_IGNORED_BUILDS`，按官方指引在 profile 的 `pnpm-workspace.yaml` 加
  `allowBuilds: { protobufjs: true }` 后重试。

## 配置

- 本地配置：`~/.dsh-lark/config.json`
- 状态根目录可用 `DSH_LARK_HOME` 覆盖
- 环境变量统一使用 `DSH_LARK_*` 前缀
- 模板见 [`.env.example`](.env.example)
- 敏感项：`DSH_LARK_APP_SECRET`、`DEEPSEEK_API_KEY` 等凭据只保存在本机配置 / 环境中，日志与
  卡片自动脱敏，仓库只提交 `.env.example` 模板。

会话运行在 Git 仓库中时，会自动在 `~/.dsh-lark/profiles/<profile>/worktrees/<scope>/` 创建隔离 worktree，并复制项目级 `AGENTS.md`。

每个飞书 scope 默认保存最近 40 条对话消息（可用 `/retention` 或 `DSH_LARK_RETENTION_MSGS`
调整）；超出保留窗口的消息自动归档到 `~/.dsh-lark/profiles/<profile>/archives/`（Markdown +
JSONL，目录本身是 Git 仓库，每次归档独立 commit），支持 `/archive` 手动归档与保留策略清理。
SDK 模式下 dsh 原生 session 续跑，headless 模式则把历史注入下一次 prompt 实现近似记忆。

当前核心环境变量：

| 变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `DSH_LARK_HOME` | `~/.dsh-lark` | 本地状态根目录|
| `DSH_LARK_TENANT` | `feishu` | `feishu` 或 `lark`|
| `DSH_LARK_WORKSPACE` | 未设置 | 新会话默认工作目录|
| `DSH_LARK_DSH_COMMAND` | `自动发现` | dsh 启动命令；通常无需设置|
| `DSH_LARK_DSH_ARGS` | `自动发现` | dsh 启动参数，逗号分隔；通常无需设置|
| `DSH_LARK_ADAPTER` | `sdk` | `sdk`（默认）/ `acp`（审批）/ `headless`（legacy）/ `web`（本地 dsh web agent，单写者）|
| `DSH_LARK_PROVIDER` | `deepseek-official` | 模型 provider|
| `DSH_LARK_MODEL` | `deepseek-v4-flash` | 默认模型|
| `DSH_LARK_MAX_TOKENS` | 未设置 | SDK agent 每请求输出 token 上限|
| `DSH_LARK_WEB_URL` | `http://127.0.0.1:3080` | `web` 适配器：本地 dsh web agent 的 base URL|
| `DSH_LARK_WEB_PUSH` | `true` | `web` 适配器：网页端回合完成时推送到飞书并自动切换会话映射（`0` 关闭）|
| `DSH_LARK_ACCESS_DEFAULT_DENY` | `false` | 无白名单时拒绝私聊|
| `DSH_LARK_EVENT_FRESHNESS_MS` | `600000` | 过期消息拒绝窗口（0 关闭）|
| `DSH_LARK_GROUP_NO_AT` | `false` | 开启已登记群聊的无 @ 历史轮询；要求 `im:message.group_msg` 权限和非空 `allowed_users` |
| `DSH_LARK_GROUP_POLL_MS` | `3000` | 无 @ 群消息轮询间隔（毫秒，最小 1000）|
| `DSH_LARK_RUN_TIMEOUT_MS` | `300000` | 单次运行空闲超时：持续无活动事件才终止（活跃任务不会被误杀）|
| `DSH_LARK_STOP_GRACE_MS` | `5000` | SIGTERM 后等待优雅退出再 SIGKILL 的宽限期|
| `DSH_LARK_SCOPE_CONCURRENCY` | `2` | 每个 scope 的并行任务数（1=严格串行）|
| `DSH_LARK_RETENTION_MSGS` | `40` | 每个 scope 保留的消息条数（0=全部保留）|
| `DSH_LARK_ARCHIVE_MAX` | `50` | 每个 scope 最多保留的归档数（0=不清理）|
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
- **文件系统**：读取 / 写入你通过 `/cd`、`/ws` 指定的工作目录（含执行 shell 命令、修改文件）。
- **网络**：向飞书开放平台建立 WebSocket 出站长连接收发消息；向 DeepSeek API 发送任务上下文。
- **可选群消息历史**：仅当 `DSH_LARK_GROUP_NO_AT=true` 时，轮询曾经通过事件登记的群聊 / 话题；只处理启动后的、未删除的白名单真人消息，并与实时事件按 message ID 去重。该模式会让 bot 读取群内未 @ 它的消息，需管理员授予 `im:message.group_msg` 权限并确认符合团队隐私政策。
- **本地回调**：运行 `lark_notify` 工具时，dsh runtime 子进程通过 `127.0.0.1` 随机端口 +
  每启动随机 token 回调 bridge 进程（仅本机回环，不监听公网）。
- **进程**：spawn 本机 `dsh` runtime 子进程（`dsh-sdk-jsonrpc-server` / `dsh-acp` profile）执行 agent 任务。
- **dsh 配置**：`/model` `/providers` `/provider` `/key` 命令按 dsh 官方存储协议读写
  `~/.dsh/settings.yaml` 与 `~/.dsh/.credentials.yaml`（仅管理员可写；settings 只存 `apiKeyEnv`
  引用，凭据文件权限 0600、目录 0700，字面密钥不进入 settings 或聊天记录）。
- **安全网守护（默认随 `setup` 安装）**：系统级常驻进程，读取 `~/.dsh-lark/config.json` 中的飞书
  凭据；dsh 下线时接管同一 bot 的飞书长连接并扫描本机进程（仅 `ps` 命令行，不读内存）；
  `/safemode` 时创建仅官方核心的 dsh profile（headless 或 SDK JSON-RPC runtime，均无第三方插件）
  并逐条执行任务；SDK 引擎会以官方 `dsh-sdk-jsonrpc-server` 子进程提供实时流式事件。

所有数据仅在本机与飞书、DeepSeek 之间流转，不收集、不上传任何遥测。密钥不会提交进仓库（见 `.gitignore`）。

## 排障

先运行 `dsh-lark-bot doctor`，它会检查 profile、工作目录，并对当前 adapter 做真实可用性探测
（`sdk` / `acp` / `headless` 对应 runtime 的初始化握手）；启用无 @ 群消息后，还会使用一个已登记群聊探测历史消息权限。

常见问题：

- **bot 静默 / 长连接失败**：查看 stderr 上的 JSONL 日志，关注 `channel` 与 `channel-command` 类别；SDK 会自动重连。
- **agent 无响应**：发送 `/status` 查看当前 scope、cwd 和 active run；发送 `/stop` 终止当前任务；持续无响应超过 `DSH_LARK_RUN_TIMEOUT_MS` 时看门狗会自动终止（空闲超时，活跃任务不会被误杀）。
- **首次扫码失败**：确认本机时间准确、网络可访问飞书开放平台；已拿到 App ID/Secret 时可用 `--app-id` / `--app-secret` 跳过扫码。

桥接引擎日志以 JSON Lines 输出到 stderr（由 dsh 宿主进程捕获；`logs/bot.log` 是 0.6.0
独立服务时代的遗留路径，0.7.0 起不再写入）；dsh 宿主日志走 dsh 自己的日志体系。

**回滚**：`dsh plugin --profile dsh-lark remove dsh-lark-bot` 后重装固定版本即可
（如 `dsh plugin --profile dsh-lark add dsh-lark-bot@0.6.0`）；`~/.dsh-lark` 状态独立于插件
本体，升级 / 回滚不会丢失配置与会话。

## 开发

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm check:publish-bundle   # 校验 dist 与全部 exports/bin 入口一致（发布前防线）
pnpm ci:local
pnpm release:check   # ci:local + 上游一致性检查
pnpm compat:probe    # 临时 DSH_HOME 安装锁定版 dsh，跑真实 SDK 握手
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

核心思路：**飞书通道与 agent 后端解耦**。桥接层复刻 `lark-channel-bridge` 的成熟做法（WebSocket 长连接 + 流式卡片 + 会话路由），agent 后端通过 adapter 抽象，默认挂接官方 DeepSeek Harness SDK（`DSH_LARK_ADAPTER=sdk`），可选 ACP 审批模式与 legacy headless。

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
| `src/card/` | 流式卡片状态与渲染|
| `src/bot/` | 运行注册、消息排队、审批/问答注册表|
| `src/commands/` | 斜杠命令（/cd /ws /new …）|
| `src/cli/` | CLI 入口：`setup`（唯一安装命令）/ `doctor`（诊断）/ `upgrade`（一键升级）/ 隐藏 `run`|
| `src/upgrade/` | 一键升级（issue #10）：版本探测、升级状态、运行检测、guardian/profile 重启助手、runtime 链接修复|
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

> 本项目的社区收录 / 推荐状态，随提交的更新请求持续维护。截至 v0.15.1（2026-08-17 复核）：

| 平台 | 状态 | 说明 |
| :--- | :--- | :--- |
| [awesome-dsh-plugins](https://github.com/AdamPlatin123/awesome-dsh-plugins) | ✅ 已收录 · 运行级可用| 社区榜单标注 `✅ 运行级可用`（agent 实测通过）；收录条目 v0.8.0 经 [PR #127](https://github.com/AdamPlatin123/awesome-dsh-plugins/pull/127) 合并，榜单行同步 [issue #139](https://github.com/AdamPlatin123/awesome-dsh-plugins/issues/139) 已关闭；**v0.15.1 数据刷新 [PR #230](https://github.com/AdamPlatin123/awesome-dsh-plugins/pull/230) 已提交 · 待合并**|
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | 📨 收录 PR 已提交 · 待合并| 7.2k+ star 的社区插件精选大榜（`dsh-plugin` 生态流量入口）；收录 PR [#1408](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/1408) 已提交，合并后回填状态|
| [dshfind](https://dshfind.com/zh/plugins/PlutoKeating/dsh-lark-bot) | ✅ 已收录 · 详情页在线| 条目名称修正 [issue #2](https://github.com/hikariming/dshfind/issues/2) 已关闭；**v0.15.1 数据刷新请求 [#6 跟进评论](https://github.com/hikariming/dshfind/issues/6#issuecomment-5317081509) 已提交 · 待维护方处理**；顶部徽章 / 展示卡来自 dshfind|
| [dshbase](https://dshbase.com/zh/plugins/dsh-lark-bot) | ✅ 已收录 · 实测可装| 中文插件目录（收录 1771+ 插件），自动化 CI 实测 `dsh plugin add` 可装可启动，标注 `✅ 已验证 · 实测可装`；顶部徽章来自 dshbase|
| [omdsh-dev/community](https://github.com/orgs/omdsh-dev/discussions/11) | ✅ 收录申请通过 · 讨论活跃| `[Plugin]` 收录申请（Discussion #11）已通过并持续维护，最新更新说明 v0.10.2；**v0.15.1 更新说明已备妥，待人工粘贴（org 级 discussion 不支持 API）**|

**更新请求进度（截至 2026-08-17 复核）**：

- awesome-dsh-plugins 收录条目 v0.8.0：[#127](https://github.com/AdamPlatin123/awesome-dsh-plugins/pull/127) — ✅ 已合并；榜单行同步：[#139](https://github.com/AdamPlatin123/awesome-dsh-plugins/issues/139) — ✅ 已关闭
- awesome-dsh-plugin 大榜收录：[#1408](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/1408) — 📨 已提交（2026-08-17，v0.15.0 数据；v0.15.1 [跟进评论](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/1408#issuecomment-5317081726) 已提交）
- dshfind 条目名称修正 + v0.8.0 刷新：[#2](https://github.com/hikariming/dshfind/issues/2) — ✅ 已关闭；v0.10.1 刷新：[#6](https://github.com/hikariming/dshfind/issues/6) — 📨 待处理（v0.15.1 [跟进评论](https://github.com/hikariming/dshfind/issues/6#issuecomment-5317081509) 已提交）
- omdsh-dev/community 收录：[Discussion #11](https://github.com/orgs/omdsh-dev/discussions/11) — ✅ 通过，讨论活跃（最新更新说明 v0.10.2）；v0.15.1 更新说明 — 📨 已备妥，待人工粘贴
- 平台数据刷新（v0.14.0 → v0.15.1）— ✅ 已恢复提交（2026-08-17）：awesome-dsh-plugins [PR #230](https://github.com/AdamPlatin123/awesome-dsh-plugins/pull/230) · dshfind [#6 跟进](https://github.com/hikariming/dshfind/issues/6#issuecomment-5317081509) · omdsh 说明备妥

**亮点跟进**（六项独家能力与 issue #6 设计实现）：

- awesome-dsh-plugins 榜单行同步（仓库描述 → 最新）与 agent-test 报告名称异常：[#139](https://github.com/AdamPlatin123/awesome-dsh-plugins/issues/139) — 📨 已提交（维护方已确认，等待渲染周期同步）
- dshfind 详情页补「对话内管理模型和密钥」亮点：[#2 跟进评论](https://github.com/hikariming/dshfind/issues/2#issuecomment-5301019067) — 📨 已提交
- omdsh 六项独家亮点补充（含 Guardian 设计实现）：[Discussion #11 亮点评论](https://github.com/orgs/omdsh-dev/discussions/11#discussioncomment-18026370) — 📨 已提交

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
