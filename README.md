<h1 align="center">dsh-lark-bot</h1>

<p align="center">🌏 英文版：[README_EN.md](README_EN.md)</p>

<p align="center">
  <strong>把 DeepSeek Harness 装进飞书 / Lark</strong> · 扫码 30 秒 · 手机指挥本机 coding agent
</p>

<p align="center">
  <strong>⚡ 唯一「dsh 崩溃后飞书里还叫得应」的桥接方案</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Feishu%20%2F%20Lark-3370FF" alt="Platform">
  <img src="https://img.shields.io/badge/agent-DeepSeek%20Harness-4D6BFE" alt="Agent">
  <img src="https://img.shields.io/badge/runtime-Node.js%20%E2%89%A5%2022-339933" alt="Node">
  <img src="https://img.shields.io/badge/License-AGPLv3-blue" alt="License">
  <img src="https://img.shields.io/badge/status-released-blue" alt="Status">
  <a href="https://dshfind.com/zh/plugins/PlutoKeating/dsh-lark-bot?ref=badge"><img src="https://dshfind.com/api/badge/PlutoKeating/dsh-lark-bot?lang=zh" alt="dshfind"></a>
  <a href="https://dshbase.com/zh/plugins/dsh-lark-bot"><img src="https://dshbase.com/badges/dsh-lark-bot.svg" alt="dshbase 实测可装"></a>
  <a href="https://dsh-plugin.org/plugins/plutokeating/dsh-lark-bot"><img src="https://dsh-plugin.org/badges/listed.svg" alt="Listed on dsh-plugin.org"></a>
  <a href="https://github.com/PlutoKeating/dsh-lark-bot/releases"><img src="https://img.shields.io/github/v/release/PlutoKeating/dsh-lark-bot?sort=semver&label=latest%20release" alt="Latest release"></a>
  <a href="https://github.com/PlutoKeating/dsh-lark-bot/commits/main"><img src="https://img.shields.io/github/commits-since/PlutoKeating/dsh-lark-bot/v0.7.0?label=commits%20since%20v0.7.0" alt="Commits since v0.7.0"></a>
</p>

<p align="center">
  🌐 官网落地页 <a href="https://dsh-lark-bot.arr2018.dpdns.org">dsh-lark-bot.arr2018.dpdns.org</a>
  · 备用 <a href="https://plutokeating.github.io/dsh-lark-bot/">GitHub Pages</a>
</p>

> **✅ 一句话：** 让 **DeepSeek Harness** 成为你飞书里的一员——在手机、群聊、话题里指挥本机 coding
> agent，把对话、任务、卡片和**项目工作区**收进同一个协作流。**关键词**：`deepseek harness 连接飞书` ·
> `deepseek 飞书机器人` · `手机远程用 deepseek harness` · `dsh 飞书` · `dsh lark bridge`。

> **⚠️ 仅认准官方渠道：** 唯一官方仓库 [PlutoKeating/dsh-lark-bot](https://github.com/PlutoKeating/dsh-lark-bot)，
> 唯一官方 npm 包 `dsh-lark-bot`（同源双包 `dsh-feishu-bot`，维护者 `plutokeating`）。本项目**从不提供
> Windows 可执行文件（.exe）**，也没有任何“下载即运行”的安装包——任何以本项目名义提供
> exe / “下载后双击运行”的页面均为**假冒 / 恶意来源**。官方安装唯一命令：
> `npx dsh-lark-bot@latest setup --profile dsh-lark`。仿冒取证与完整声明见文末「假冒仓库警告」。

---

## 它是什么（AEO / 可被直接引用的答案）

- **是什么**：一个把 DeepSeek Harness（`dsh`）接入飞书 / Lark 的**开源桥接插件**，扫码即用。
- **怎么连飞书**：安装后首次启动扫码即可，走**飞书 WebSocket 出站长连接**，**不需要公网 IP、域名、服务器或内网穿透**。
- **为什么选它**：飞书功能**最全**——流式卡片、项目工作区、并行任务、多角色 Agent、多机器人交接、崩溃后持久对账、对话内模型/密钥管理、计划门禁、飞书内自更新，以及唯一「dsh 崩溃后飞书仍叫得应」的安全网守护。
- **是否免费**：开源、可自托管，个人/内部使用免费（GNU AGPL-3.0；商用 / SaaS / 闭源二开需另行授权）。

---

## 30 秒上线

**前置**：本机已安装 DeepSeek Harness（`dsh`）并已配置 `DEEPSEEK_API_KEY`；Node.js ≥ 22.19；
一个飞书 / Lark 账号。dsh 才是 agent 本体，本插件是它的遥控器。

```bash
# ① 一键安装（无需先全局安装任何东西；自动装进 dsh profile，并默认同时安装「安全网守护」）
npx dsh-lark-bot@latest setup --profile dsh-lark

# ② 启动
dsh --profile dsh-lark
```

③ 首次启动终端打印二维码 → 飞书 / Lark App 扫码创建或选择 PersonalAgent 应用 → 绑定后私聊直接发消息；群聊 / 话题默认 `@bot`，也可显式开启受白名单保护的无 @ 模式。

> [!IMPORTANT]
> **让按钮生效的关键一步：** 卡片按钮（计划门禁 / 审批 / 问答）按 Card JSON 2.0 的
> `behaviors.callback` 协议发送，扫码向导会显式申请 `card.action.trigger` 回调能力。若你的应用是在
> 旧版本向导中创建的，请在飞书开放平台的 **事件与回调 → 回调配置** 中启用“卡片回调”后**重新发布**，
> 否则消息收发正常但按钮点击不会送达 bot。

`setup` 自动完成：定位本机 dsh → 预批准 pnpm 构建策略 → 标准 `dsh plugin add` → 默认安装「安全网守护」系统服务，一条命令完成全部安装。

- **无需公网 IP / 域名 / 服务器 / 内网穿透**（飞书 WebSocket 出站长连接），Linux / macOS / Windows 通用。
- **已有 PersonalAgent 应用**时可跳过扫码：`DSH_LARK_APP_ID=cli_xxx DSH_LARK_APP_SECRET=<secret> DSH_LARK_TENANT=feishu dsh --profile dsh-lark`；或用 `npx dsh-lark-bot@latest setup` 后再以 `--app-id` / `--app-secret` 启动。
- **全局安装了 `dsh-lark-bot`** 的话，`setup` 等价于 `dsh-lark-bot setup`（`npx` 路径无需全局安装）。
- **升级**同样一条命令：`npx dsh-lark-bot@latest upgrade --profile dsh-lark --yes`；也可在飞书内由管理员发 `/upgrade`。

---

## 能做什么（十二项全网独有组合，一眼看清）

| # | 能力 | 一句话 |
| --- | --- | --- |
| 🆘 | **安全网守护** | dsh 崩溃后飞书仍回复你；`/safemode` 进入仅核心安全模式直接自愈 —— **全生态唯一** |
| ⚡ | **并行多任务** | 同一群同时跑多个任务、会话隔离；其他方案只能串行排队 |
| 👥 | **多角色 Agent** | `/role` 切换/指派 PM / 开发 / 文档等角色，各带人设、模型偏好与规则 |
| 🤝 | **多机器人交接** | `bot add` 加独立实例，可信机器人在同群真实 @ 交接，连续协作有硬上限 |
| 🧾 | **崩溃后可对账** | 消息先写持久任务账本再入队；重启恢复排队项，`/jobs` 显式重试 |
| 🗂 | **会话归档与清理** | `/archive` 归档、`/retention` 配置自动保留策略 |
| 📣 | **跨会话主动通知 + @人** | A 群跑完任务主动推送到 B 群 / 私聊并 @ 你 |
| ⚙️ | **dsh Web 可视化设置** | 在官方 Settings → Plugins 页面点选应用、工作目录、模型、并行数、提醒，不用背环境变量 |
| 🔑 | **对话内管理模型和密钥** | 一张 `/config` 卡片查看、切换供应商、热更新密钥，不用离开飞书 |
| 🎚️ | **快速 / 平衡 / 深度模式** | `/mode` 按 scope 持久选择，下一轮生效且不打断当前任务 |
| 🔄 | **飞书内自更新** | 管理员 `/upgrade` 更新、验证并重载；`/new` 只在新版时短暂提醒 |
| 🧭 | **关键任务先拍板** | `lark_request_plan_approval`：完整计划先单独发出，再用卡片批准或附意见继续规划 |

+ 每会话自动创建隔离 git worktree 项目工作区；流式过程卡以飞书原生折叠面板实时展示；完成后最终回答单独发送。

## 常用命令（高频优先；`/help` 为全量权威清单）

bot 自带的命令帮助、状态、错误提示与交互卡片均提供中文 / English。Card JSON 2.0 在各文本组件使用飞书
原生 `i18n_content`，同一张群卡按每位读者客户端语言显示；Markdown/toast 与旧客户端降级同时显示中英文；
agent 最终回答和用户原文保持原样。

| 命令 | 作用 |
| --- | --- |
| `/new` `/reset` | 开始新会话 |
| `/config` | **模型 / Provider / 凭据 管理卡片**（`/model`、`/provider(s)`、`/key` 为同一张卡片的别名） |
| `/status` | 查看可刷新状态卡（工作区 / 模型 / session / run / context / token / pending / 任务账本） |
| `/mode`（兼容 `/effort`） | 选择快速 / 平衡 / 深度执行模式（下一轮生效） |
| `/cd <path>` | 切到该工作目录的独立会话 |
| `/ws list\|save\|use\|remove` | 管理命名工作空间 |
| `/jobs [list\|show\|retry]` | 对账并显式重试排队/运行/失败/中断任务 |
| `/session`、`/session bind` | 浏览 / 显式绑定 DSH session（`web` adapter） |
| `/role list\|show\|set\|clear` | 查看 / 绑定角色 |
| `/notify <scope\|chatId> <text>` | 跨会话发送通知（管理员） |
| `/notifications [show\|off\|on …]` | 配置当前 scope 的完成 / 失败 / 审批提醒 |
| `/stop` | 终止当前任务 |
| `/upgrade` | 检查更新并由 Guardian 后台更新、验证、重载（管理员） |
| `/doctor` | 生成脱敏诊断包并作为文件发送（管理员） |
| `/help` | 查看当前版本权威命令清单 |

> 更多命令（`/newg` `/ws` `/timeout` `/permission` `/isolation` `/archive` `/density` `/replies`
> `/retention` `/invite` `/ask` `/language` `/secret` `/safemode` …）见 [`docs/MANUAL.md`](docs/MANUAL.md)。
> 模型/Provider/凭据的**文字子命令**（`/model use|default|add|remove`、`/provider add|update|remove`、
> `/key set|remove|list`、`/secret status|set|remove`）是为无卡片 / headless 环境与脚本化 / 管理员保留的
> 备选路径，见 [`docs/MANUAL.md`](docs/MANUAL.md) §模型 / Provider / 凭据管理。

---

## FAQ（常见问题）

**Q: DeepSeek Harness 怎么接入飞书？**
**A:** 装好 Node.js ≥ 22 与 dsh（已配 `DEEPSEEK_API_KEY`）后，执行 `npx dsh-lark-bot@latest setup --profile dsh-lark`，再 `dsh --profile dsh-lark` 扫码绑定即可。私聊直接发消息；群聊 / 话题默认 `@bot`。

**Q: 需要公网 IP、域名或服务器吗？**
**A:** 不需要。飞书通道走 WebSocket 长连接（出站连接），本机在 NAT 后面也有，免公网服务器、免域名、免内网穿透。

**Q: 和别的 DeepSeek Harness 飞书插件（如 harness-lark）有什么区别？**
**A:** 功能组合最全：安全网守护 / 多角色 Agent / 多机器人可信交接 / 并行多任务 / 持久任务对账 / 会话归档 / 跨会话主动通知 / dsh Web 可视化设置 / 对话内模型与密钥管理 / 执行模式 / 关键任务计划门禁 / 飞书内自更新十二项合一；标准 dsh profile bundle，`setup` 是唯一安装路径；可选 `service install` 只负责把同一 profile 交给 OS 常驻，不是第二套运行时。

**Q: 项目从哪下载？会不会有假冒版本？**
**A:** 唯一官方仓库 [github.com/PlutoKeating/dsh-lark-bot](https://github.com/PlutoKeating/dsh-lark-bot)，唯一官方 npm 包 `dsh-lark-bot` / `dsh-feishu-bot`（维护者 `plutokeating`）。本项目从不提供 .exe 或“下载即运行”安装包；任何以项目名义分发 exe 的仓库或页面都是假冒来源（详见文末「假冒仓库警告」）。

---

## 兼容性

- **DeepSeek Harness（`dsh`）**：已验证 **dsh 0.1.0-rc.8**（最后验证 2026-08-22），通过官方
  `@deepseek-ai/dsh-sdk-client` / `@deepseek-ai/dsh-acp` 接入；锁定版本、升级政策与自动化探测见
  [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)，adapter 细节见 [`docs/adapter-notes.md`](docs/adapter-notes.md)。
- **运行时**：Node.js ≥ 22.19；**平台**：Linux / macOS / Windows。
- **adapter**：默认官方 **`@deepseek-ai/dsh-sdk-client`**（原生 session 续跑、token 级流式事件、
  attachment 原生图片块）；`DSH_LARK_ADAPTER=acp` 切官方 ACP server（协议原生审批）；`headless` 为 legacy
  子进程 fallback；`web` 驱动本地 dsh web agent（单写者，根除多写者会话损坏）。

## 已知限制

- ACP 模式会话每次全新（上游限制，无续跑）；SDK 协议暂无 mid-turn cancel，停止会关闭该 run 所属隔离
  runtime 并自动重建，不关闭其他 scope 或并发 run。SDK 只在当前 bridge 进程仍持有同一 live runtime 时
  原生续接；进程重启、停止或模型切换后会新建 session 并回放 transcript，避免把旧 ID 交给新 runtime。
- 桥接引擎作为 dsh 插件在 dsh 进程内运行，agent 执行使用官方 SDK runtime 子进程（嵌套 runtime 是有意取舍，
  用于按 scope + workspace 隔离取消域与并行 run）。唯一进程级例外是默认安装的「安全网守护」。
- 飞书文档评论、富文本回复为规划中能力，尚未实现。
- pnpm ≥ 10 构建脚本策略由 `setup` 自动处理；手动 `dsh plugin add` 报 `ERR_PNPM_IGNORED_BUILDS` 时，
  在 profile 的 `pnpm-workspace.yaml` 加 `allowBuilds: { protobufjs: true }` 后重试。

## 配置概览

**推荐**：打开本机 dsh Web → **Settings → Plugins → dsh-lark-bot**，直接查看 / 修改服务区域、App ID、
App Secret、工作目录、默认模型、每会话并行数、adapter 与默认提醒；App Secret 只写不回显；改动按项热更新，
连接类配置安全停止旧 generation 后自动重连。没有 Web 设置服务时，下列飞书命令与环境变量仍可用。

- 本地配置：`~/.dsh-lark/config.json`；状态根目录可用 `DSH_LARK_HOME` 覆盖；环境变量统一 `DSH_LARK_*` 前缀。
- 敏感项（`DSH_LARK_APP_SECRET`、`DEEPSEEK_API_KEY` 等）只保存在本机配置 / 环境中，日志与卡片自动脱敏；
  仓库只提交 [`.env.example`](.env.example) 模板。

核心环境变量（完整表见 [`.env.example`](.env.example) 与 [`docs/MANUAL.md`](docs/MANUAL.md) §9）：

| 变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `DSH_LARK_TENANT` | `feishu` | `feishu` 或 `lark` |
| `DSH_LARK_WORKSPACE` | 未设置 | 新会话默认工作目录 |
| `DSH_LARK_ADAPTER` | `sdk` | `sdk` / `acp` / `headless` / `web` |
| `DSH_LARK_MODEL` | 未设置 | 默认模型；可由 dsh `agent-default-model` 提供 |
| `DSH_LARK_SCOPE_CONCURRENCY` | `2` | 每个 scope 的并行任务数（`1`=严格串行） |
| `DSH_LARK_RUN_TIMEOUT_MS` | `300000` | 单次运行空闲超时（活跃任务不会被误杀） |
| `DSH_LARK_RETENTION_MSGS` | `40` | 每个 scope + workspace 保留消息条数 |
| `DSH_LARK_GROUP_NO_AT` | `false` | 处理白名单实时无 @ 消息并轮询已登记群聊历史 |
| `DSH_LARK_PLAN_GATE` | `strict` | `off` 关闭独立计划门禁（逐工具审批仍执行） |

会话在 Git 仓库中运行时，会自动为每个 scope 在 `~/.dsh-lark/profiles/<profile>/worktrees/<scope-slug>-<path-hash>/`
创建隔离 worktree 并复制项目级 `AGENTS.md`；升级时先核验旧 worktree 的 owning repo，原位迁移并保留分支与未提交文件。

> 详细的环境变量矩阵、权限数据、诊断与排障、深度功能行为见
> [`docs/MANUAL.md`](docs/MANUAL.md) · [`docs/FEATURES.md`](docs/FEATURES.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/API.md`](docs/API.md) · [`SECURITY.md`](SECURITY.md)。

---

## 权限与数据

本工具在**本机**运行。简要说明（完整版见 [`docs/MANUAL.md`](docs/MANUAL.md) §6 与 [`SECURITY.md`](SECURITY.md)）：

- **飞书凭据**：PersonalAgent 应用的 `app_id` / `app_secret` 明文写入本机 `~/.dsh-lark/config.json`（600）。
- **多机器人身份与消息**：`fleet.json` / `handoffs.json`（0600）保存实例与交接元数据，不保存密钥。
- **文件系统 / 网络**：读写你通过 `/cd`、`/ws` 指定的目录；向飞书开放平台建立 WebSocket 出站长连接，向 DeepSeek API 发送任务上下文。
- **诊断包**：`/doctor` 生成脱敏 Markdown 上传到原聊天 / 话题，不包含 App ID/Secret、凭据值、消息正文或 session transcript。
- **配置读写**：`/config`、`/providers`、`/provider`、`/key` 按 dsh 官方存储协议读写
  `~/.dsh/settings.yaml` 与 `~/.dsh/.credentials.yaml`（仅管理员可写；settings 只存 `apiKeyEnv` 引用，
  字面密钥不进入 settings 或聊天记录）。
- **安全网守护**：随 `setup` 默认安装，读飞书凭据，dsh 下线时接管并扫描本机进程（仅 `ps` 命令行，不读内存）。
- 所有数据仅在本机与飞书、DeepSeek 之间流转，不收集、不上传任何遥测。密钥不进入仓库（见 [`.gitignore`](.gitignore)）。

## 排障

先运行 `dsh-lark-bot doctor` 做真实可用性探测；无法接触终端时在飞书发 `/doctor` 获取脱敏诊断包。常见问题：

- **bot 静默 / 长连接失败**：`service status` + `service logs -f`（前台则看 stderr）；SDK 自动重连并在恢复后向最近活跃会话提示。系统睡眠期间不能收消息。
- **agent 无响应**：发 `/status` 看 scope / cwd / active run；发 `/stop` 终止；超过 `DSH_LARK_RUN_TIMEOUT_MS` 看门狗会自动终止（空闲超时）。
- **首次扫码失败**：确认本机时间准确、网络可访问飞书开放平台；已拿到 App ID/Secret 时用 `--app-id` / `--app-secret` 跳过扫码。

**回滚**：`dsh plugin --profile dsh-lark remove dsh-lark-bot` 后重装固定版本（如 `dsh-lark-bot@0.6.0`）；
`~/.dsh-lark` 状态独立于插件本体，升级 / 回滚不丢配置与会话。详见 [`docs/QUICK_START.md`](docs/QUICK_START.md)。

---

## 升级、禁用与卸载

**升级（推荐一行命令）**

```bash
npx dsh-lark-bot@latest upgrade --profile dsh-lark --yes
```

或完全不接触命令行：profile 管理员在飞书发送 `/upgrade`，确认卡由 Guardian 后台更新、修复 runtime
profiles、重启并验证，再回到原会话报告。`--check` 只报告版本 / 运行状态（零改动）；`--restart` 升级后
自动重启 guardian 与受管 profile；`--rollback` 回滚到上次升级前版本；`--no-guardian` 跳过守护升级。

- 插件本体也可重跑 `setup` 拉取最新版；CLI 可 `npm i -g dsh-lark-bot@latest`（用 `npx` 则无需全局安装）。

**禁用**：启动 profile 前导出 `DSH_LARK_DISABLED=1`（保持插件加载但停止桥接引擎）。

**卸载**

```bash
dsh plugin --profile dsh-lark remove dsh-lark-bot
```

卸载后 profile 不再加载本插件；本地状态（配置 / 会话 / 归档 / 角色）保留在 `~/.dsh-lark`，如需清除先备份再删除该目录。更多见 [`docs/QUICK_START.md`](docs/QUICK_START.md)。

---

## 关键词

`dsh` · `deepseek` · `deepseek harness` · `deepseek harness 连接飞书` · `deepseek 飞书机器人` · `feishu` · `lark` · `bridge` · `bot` · `chatbot` · `messaging` · `qrcode` · `typescript` · `feishu-bot` · `lark-bot` · `dsh-plugin` · `deepseek-harness` · `im-bridge` · `ai-agent` · `workspace` · `self-healing` · `remote-coding`

## 许可与安全

- **许可证**：GNU Affero General Public License v3.0（见 [`LICENSE`](LICENSE)）。**许可说明**：开源、欢迎自托管与个人/内部使用；**商用 / SaaS / 闭源二开需另行授权**。
- **版权归属**：源码版权归项目维护者所有，按 AGPL-3.0 授权；「DeepSeek」「飞书 / Lark」等商标归各自权利人所有。
- **安全报告**：安全漏洞请通过 GitHub Security Advisory 私下报告，勿公开 issue。安全模型（默认拒绝、密钥脱敏、路径 containment、SSRF 防护、过期事件拒绝与交互工具默认禁用）见 [`SECURITY.md`](SECURITY.md)。

## 更多（开发 / 作者 / 贡献者 / 目录 / 路线图 / 参考项目）

- **开发**：见 [`docs/ECOSYSTEM.md`](docs/ECOSYSTEM.md)（生态交付标准）与 [`AGENTS.md`](AGENTS.md)（AI Agent
  工作流）；构建 `pnpm install && pnpm typecheck && pnpm test && pnpm build`；发布用
  `pnpm publish:dual`（同源发布 `dsh-lark-bot` 与 `dsh-feishu-bot` 双包，dist 一致）。
- **架构**：飞书 / Lark ─WebSocket 长连接→ `bridge/` → `session/` → `workspace/` → `adapters/` → `dsh` → DeepSeek。
  核心思路是**飞书通道与 agent 后端解耦**；详见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。
- **目录结构**：`src/bridge/`（飞书通道）`src/onboard/`（扫码绑定）`src/session/`（会话路由）`src/workspace/`
  （git worktree 隔离）`src/adapters/`（sdk/acp/headless/web）`src/card/`（流式卡片与 Card 2.0 国际化）
  `src/bot/`（运行注册与策略）`src/commands/`（斜杠命令）`src/cli/`（setup/upgrade/service/bot）`src/guardian/`（安全网守护）。
- **作者**：**PlutoKeating**，专注自动化与开发者工具（[主页](https://github.com/PlutoKeating)）。致谢贡献者
  [koprivnikarurnaa-oss](https://github.com/koprivnikarurnaa-oss)（web 单写者 + 自愈 v2 + 守护自动重启）、
  [Normanyin](https://github.com/Normanyin)（`/newg` 自动建群）。
- **路线图**：[`docs/roadmap.md`](docs/roadmap.md)；**参考项目**：`zarazhangrui/lark-coding-agent-bridge` ·
  `deepseek-ai/deepseek-harness` · `grinev/opencode-telegram-bot`。

## 文档索引

接手项目先读 [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) 与 [`docs/RESEARCH.md`](docs/RESEARCH.md)。
其余：`QUICK_START`（安装/快速开始）· `MANUAL`（完整用户手册+命令+环境变量）· `FEATURES`（核心能力实现细节）·
`COMPATIBILITY`（兼容矩阵与升级政策）· `ADAPTER_NOTES`（adapter 接入）· `UPGRADE`（更新链路架构）·
`ECOSYSTEM`（生态交付标准）· `ARCHITECTURE` · `API` · `PLAN` · `roadmap`。

## 社区收录情况

<div align="center">
<a href="https://dshfind.com/zh/plugins/PlutoKeating/dsh-lark-bot?ref=badge"><img src="https://dshfind.com/api/card/PlutoKeating/dsh-lark-bot?lang=zh" alt="dshfind" width="440"></a>
</div>

截至 v0.15.9（2026-08-20 复核）：

| 平台 | 状态 | 说明 |
| :--- | :--- | :--- |
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | 📨 收录 PR 已提交 · 待合并 | 7.2k+ star 社区插件精选大榜（`dsh-plugin` 生态流量入口）；PR [#1408](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/1408) |
| [awesome-dsh-plugins](https://github.com/AdamPlatin123/awesome-dsh-plugins) | ✅ 已收录 · 运行级可用 | 榜单标注 `✅ 运行级可用`；v0.15.1 数据刷新 [PR #230](https://github.com/AdamPlatin123/awesome-dsh-plugins/pull/230) 待合并 |
| [dshfind](https://dshfind.com/zh/plugins/PlutoKeating/dsh-lark-bot) | ✅ 已收录 | 顶部徽章 / 展示卡来自 dshfind |
| [dshbase](https://dshbase.com/zh/plugins/dsh-lark-bot) | ✅ 已收录 · 实测可装 | 中文插件目录，自动化 CI 实测可装可启动 |
| [dsh-plugin.org](https://dsh-plugin.org/zh/plugins/plutokeating/dsh-lark-bot) | ✅ 已收录 · 官方源已核验 | 平台已下架冒名寄生仓库条目 |
| [omdsh-dev/community](https://github.com/orgs/omdsh-dev/discussions/11) | ✅ 收录申请通过 · 讨论活跃 | org 级 discussion 更新说明待人工粘贴 |

完整更新请求进度与历史见 [`docs/MARKETING.md`](docs/MARKETING.md)。

## 假冒仓库警告

> 2026-08-17 发现假冒仓库 **`tarraencompassing61/dsh-lark-bot`**：非 fork 重新上传、114 个 commit 中
> 113 个作者为 PlutoKeating、删除全部 CI、关闭 Issues、Releases 为 0，却以“下载 Windows exe 双击运行”的
> SEO 诱饵 README 冒充官方分发。**本项目从不提供 exe，任何此类下载均为假冒 / 恶意来源。**
>
> 取证存档：[`docs/security/2026-08-17-impostor-repo-evidence/`](docs/security/2026-08-17-impostor-repo-evidence/README.md) ·
> 官方下载渠道：[`docs/DOWNLOAD.md`](docs/DOWNLOAD.md) · 持续监控：`pnpm security:monitor`

## 免责声明

> 本项目为非官方社区工具，与 DeepSeek、字节跳动 / 飞书（Lark）无关联，亦未获得其背书。DeepSeek Harness、Feishu / Lark 及相关商标归各自权利人所有。
