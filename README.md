<h1 align="center">dsh-lark-bot</h1>

<p align="center">🌏 <a href="README_EN.md">English</a> · 🌐 官网wiki <a href="https://dsh-lark-bot.arr2018.dpdns.org">dsh-lark-bot.arr2018.dpdns.org</a></p>

<p align="center">
  <strong>把 DeepSeek Harness 装进飞书</strong> · 扫码 30 秒 · 手机指挥本机 coding agent · 崩溃了飞书也照样回你
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
</p>

## 产品简介

让 DeepSeek Harness 成为你飞书里的一员，在手机、群聊、话题里直接指挥本机 coding agent。
走飞书 WebSocket 长连接，**不需要公网 IP、域名、服务器或内网穿透**；Linux / macOS / Windows 通用，Node.js ≥ 22。

---

## 快速开始

**前置**：本机已安装 DeepSeek Harness（`dsh`）并配置好 `DEEPSEEK_API_KEY`；Node.js ≥ 22.19；一个飞书 / Lark 账号。

```bash
npx dsh-lark-bot@latest setup --profile dsh-lark   # ① 一键安装（装进 dsh profile + 默认装「安全网守护」）
dsh --profile dsh-lark                              # ② 启动
```

③ 首次启动终端打印二维码 → 飞书 App 扫码创建或选择 PersonalAgent 应用 → 绑定后直接私聊发消息；群聊 / 话题默认 `@bot`。

- **已有应用**可跳过扫码：`DSH_LARK_APP_ID=cli_xxx DSH_LARK_APP_SECRET=<secret> DSH_LARK_TENANT=feishu dsh --profile dsh-lark`。
- **升级**：`npx dsh-lark-bot@latest upgrade --profile dsh-lark --yes`。

> **不用碰命令行**：管理员直接在飞书发 `/upgrade` 即可。

---

## 核心能力

**全网独家**

- **安全网守护**：dsh 崩溃后飞书仍会回复你，`/safemode` 进入仅核心安全模式直接自愈；重启后自动恢复排队任务，`/jobs` 可显式重试。多数桥接方案是「串行单聊 + 崩溃就失联」。
- **多机器人可信交接**：`bot add` 增加独立实例，可信机器人在同群真实 @ 交接，连续协作有上限。
- **完善的工作区与会话管理**：每会话自动创建隔离 git worktree 项目工作区；`/session` 浏览 / 绑定会话，`/archive` + `/retention` 自动归档与清理，会话列表不会烂掉。
- **完善的版本管理机制**：管理员直接在飞书发 `/upgrade` 后台更新、验证并重载；有新版本才提醒，不打断当前工作。
- **dsh Web 可视化设置**：官方 Settings → Plugins 页面点选工作目录、模型、并行数、提醒，不用背环境变量。

**其他核心能力**

- **并行多任务**：同一群聊同时跑多个任务、会话隔离。
- **多角色 Agent**：`/role` 切换或指派 PM / 开发 / 文档等角色，各带人设、模型偏好与规则。
- **对话内管理模型与密钥**：一张 `/config` 卡片切换供应商、热更新密钥，不用离开飞书。
- **快速 / 平衡 / 深度模式**：`/mode` 一键选任务强度，下一轮生效且不打断当前任务。
- **关键任务先拍板**：`lark_request_plan_approval` 先出完整计划，再批准或附意见继续规划。
- **跨会话通知 + @人**：A 群跑完任务主动推送到 B 群 / 私聊并 @ 你。
- **通知转发到常用 IM（纯通知）**：把完成 / 失败 / 审批与突发 / 故障通知，经 `/channels` 配置后单向推送到 Telegram / 企业微信群机器人等；只推送、无入站交互，飞书仍是唯一完整交互平台，未配置时行为不变。**`/channels add --qr <wechat|qq|telegram>` 让用户在飞书会话里收到二维码图片，用对应 IM 扫码即创建并绑定通知渠道。**

> 流式过程卡以飞书原生折叠面板实时展示阶段、耗时与工具状态。

## 命令速览

命令帮助、状态与卡片均中英文；`/help` 为全量权威清单，全部命令见 [`docs/MANUAL.md`](docs/MANUAL.md)。

| 命令 | 作用 |
| --- | --- |
| `/config` | 模型 / Provider / 凭据管理卡片（`/model`、`/provider(s)`、`/key` 为同一张卡的别名） |
| `/new` `/reset` | 开始新会话 |
| `/status` | 查看状态卡（工作区 / 模型 / session / run / token / 任务账本） |
| `/mode`（`/effort`） | 选择快速 / 平衡 / 深度任务强度 |
| `/cd <path>` | 切到该目录的独立会话 |
| `/ws list\|save\|use\|remove` | 管理命名工作空间 |
| `/jobs [list\|show\|retry]` | 对账并重试排队/运行/失败/中断任务 |
| `/session`、`/session bind` | 浏览 / 显式绑定 DSH session |
| `/role list\|show\|set\|clear` | 查看 / 绑定角色 |
| `/notify <scope\|chatId> <text>` | 跨会话发送通知（管理员） |
| `/notifications [show\|off\|on …]` | 配置完成 / 失败 / 审批提醒（`sinks=` 转发到其他 IM 渠道） |
| `/channels [list\|show\|add\|accept\|remove\|enable\|disable …]` | 管理出站通知渠道（管理员）；`add --qr <wechat\|qq\|telegram>` 扫码即建 |
| `/stop` | 终止当前任务 |
| `/upgrade` | 自更新（管理员） |
| `/doctor` | 生成脱敏诊断包（管理员） |
| `/help` | 查看命令清单 |

---

> **⚠️ 仅认准官方渠道**：唯一官方仓库 [PlutoKeating/dsh-lark-bot](https://github.com/PlutoKeating/dsh-lark-bot)，
> 唯一官方 npm 包 `dsh-lark-bot` / `dsh-feishu-bot`（维护者 `plutokeating`）。本项目**从不提供 .exe 或
> “下载即运行”的安装包**，任何以此名义分发的页面 / 仓库均为**假冒 / 恶意来源**。官方安装唯一命令：
> `npx dsh-lark-bot@latest setup --profile dsh-lark`。详见文末「安全提醒」。

## 常见问题

**Q: DeepSeek Harness 怎么接入飞书？**
**A:** 装好 Node ≥ 22 与 dsh（已配 `DEEPSEEK_API_KEY`）后，执行 `npx dsh-lark-bot@latest setup --profile dsh-lark`，再 `dsh --profile dsh-lark` 扫码绑定即可；私聊直接发消息，群聊 / 话题默认 `@bot`。

**Q: 需要公网 IP、域名或服务器吗？**
**A:** 不需要。飞书走 WebSocket 长连接（出站），本机在 NAT 后面也能用，免公网服务器、免域名、免内网穿透。

**Q: 和别的 DeepSeek Harness 飞书插件有什么区别？**
**A:** 功能组合最全——安全网守护、并行多任务、多角色 Agent、多机器人交接、持久任务对账、会话归档、跨会话通知、dsh Web 可视化设置、对话内模型 / 密钥管理、执行模式、计划门禁、飞书内自更新。标准 dsh profile bundle，`setup` 是唯一安装路径。

**Q: 会不会有假冒版本？**
**A:** 唯一官方仓库 / npm 包见上方「仅认准官方渠道」；本项目从不提供 `.exe` 或“下载即运行”安装包，任何分发 exe 的都是假冒来源。

---

## 兼容性

- **DeepSeek Harness（`dsh`）**：已验证 **0.1.0-rc.8**（2026-08-25），经官方 `@deepseek-ai/dsh-sdk-client` / `dsh-acp` 接入；锁定版本与升级政策见 [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)。
- **运行时**：Node.js ≥ 22.19；**平台**：Linux / macOS / Windows。adapter 默认 `sdk`（原生续跑 / 流式 / 图片块），可切 `acp` / `headless` / `web`。

## 配置说明

- **推荐**：本机 dsh Web → **Settings → Plugins → dsh-lark-bot**，直接查看 / 修改服务区域、App ID、App Secret、工作目录、默认模型、并行数、adapter 与提醒；App Secret 只写不回显。
- 也可用 `/config`、`/providers`、`/provider`、`/key` 在飞书内核验供应商 / 模型 / 凭据并写操作（仅管理员）。
- 环境变量统一 `DSH_LARK_*` 前缀，状态根目录为 `~/.dsh-lark`，模板见 [`.env.example`](.env.example)；完整环境变量矩阵见 [`docs/MANUAL.md`](docs/MANUAL.md) §9。

> 行为细节（崩溃对账、会话隔离、计划门禁、逐操作审批、多机器人交接、安全网守护等）见 [`docs/FEATURES.md`](docs/FEATURES.md)；
> 权限与数据见 [`docs/MANUAL.md`](docs/MANUAL.md) §6 与 [`SECURITY.md`](SECURITY.md)。

## 安全与许可

- **许可证**：GNU AGPL-3.0（见 [`LICENSE`](LICENSE)）。开源可自托管，个人 / 内部使用免费；**商用 / SaaS / 闭源二开需另行授权**。
- **安全**：默认拒绝、密钥脱敏、路径 containment、SSRF 防护、过期事件拒绝、交互工具默认禁用——见 [`SECURITY.md`](SECURITY.md)；安全漏洞请走 GitHub Security Advisory 私下报告。

## 升级与卸载

```bash
npx dsh-lark-bot@latest upgrade --profile dsh-lark --yes   # 升级（或飞书内管理员 /upgrade）
```

- **禁用**：启动 profile 前导出 `DSH_LARK_DISABLED=1`（插件保留但停止桥接引擎）。
- **卸载**：`dsh plugin --profile dsh-lark remove dsh-lark-bot`；本地状态（配置 / 会话 / 归档 / 角色）留在 `~/.dsh-lark`。

---

## 关于项目

- **开发**：`pnpm install && pnpm typecheck && pnpm test && pnpm build`；生态交付标准见 [`docs/ECOSYSTEM.md`](docs/ECOSYSTEM.md)，AI Agent 工作流见 [`AGENTS.md`](AGENTS.md)。双包发布 `pnpm publish:dual`（`dsh-lark-bot` + `dsh-feishu-bot`，共享 dist）。
- **作者**：**PlutoKeating**（[主页](https://github.com/PlutoKeating)）。
- **协作者**：[zhuguangjun2002](https://github.com/zhuguangjun2002) · [chensimo1992-sys](https://github.com/chensimo1992-sys) · [estelledc](https://github.com/estelledc) · [fredjiangyysx](https://github.com/fredjiangyysx) · [Geoffrey-hougaojie](https://github.com/Geoffrey-hougaojie) · [hellxiaoao](https://github.com/hellxiaoao) · [koprivnikarurnaa-oss](https://github.com/koprivnikarurnaa-oss) · [Normanyin](https://github.com/Normanyin) · [pancong0711](https://github.com/pancong0711) · [qvivp](https://github.com/qvivp)。
- **文档**：`QUICK_START`（安装/快速开始）· `MANUAL`（完整手册+命令+环境变量）· `FEATURES`（能力行为细节）· `COMPATIBILITY`· `ARCHITECTURE`· `API`· `roadmap`。

## 社区与生态

| 平台 | 状态 |
| :--- | :--- |
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | ✅ 已收录（[#1408](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/1408)） |
| [awesome-dsh-plugins](https://github.com/AdamPlatin123/awesome-dsh-plugins) | ✅ 已收录 · 运行级可用 |
| [dshfind](https://dshfind.com/zh/plugins/PlutoKeating/dsh-lark-bot) | ✅ 已收录 |
| [dshbase](https://dshbase.com/zh/plugins/dsh-lark-bot) | ✅ 已收录 · 实测可装 |
| [dsh-plugin.org](https://dsh-plugin.org/zh/plugins/plutokeating/dsh-lark-bot) | ✅ 已收录 · 官方源已核验 |
| [omdsh-dev/community](https://github.com/orgs/omdsh-dev/discussions/11) | ✅ 收录申请通过 · 讨论活跃 |

## 安全提醒

> 2026-08-17 发现假冒仓库 **`tarraencompassing61/dsh-lark-bot`**：非 fork 重新上传、114 个 commit 中
> 113 个作者为 PlutoKeating、删除全部 CI、关闭 Issues、Releases 为 0，却以“下载 Windows exe 双击运行”的
> README 冒充官方分发。**本项目从不提供 exe，任何此类下载均为假冒 / 恶意来源。**
>
> 取证存档：[`docs/security/2026-08-17-impostor-repo-evidence/`](docs/security/2026-08-17-impostor-repo-evidence/README.md) ·
> 官方下载渠道：[`docs/DOWNLOAD.md`](docs/DOWNLOAD.md) · 持续监控：`pnpm security:monitor`

## 免责声明

> 本项目为非官方社区工具，与 DeepSeek、字节跳动 / 飞书（Lark）无关联，亦未获得其背书。DeepSeek Harness、Feishu / Lark 及相关商标归各自权利人所有。
