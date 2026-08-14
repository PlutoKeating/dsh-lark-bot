# 项目诉求与需求文档 · Project Requirements

> 本文档是 **dsh-lark-bot** 项目的**唯一权威需求来源**，完整记录项目发起人 PlutoKeating 的项目诉求、产出预期、规范要求与技术决策。
>
> **接手本项目的工程师只需克隆仓库、阅读本文档，即可完整理解项目来龙去脉，无需任何线下沟通。** 所有此前对话中确定下来的需求、约束与决策，均已沉淀到本文档与 `docs/` 目录下。

---

## 1. 项目定位 · Project Positioning

**dsh-lark-bot** 是一个把 **DeepSeek Harness（`dsh`）** 接入飞书 / Lark 的轻量桥接机器人（bridge bot），复刻当年爆火的 OpenCode Telegram Bot / MiMoCode Telegram Bot 的体验，并在此基础上叠加**完整的项目工作区管理**。

一句话：**让 DeepSeek Harness 成为飞书里的一个 bot，在手机 / 群聊 / 话题里指挥本机 coding agent，把对话、任务、卡片和项目工作区都收进同一个协作流。**

---

## 2. 完整项目诉求（发起人原话整理）· Complete Requirements

以下是项目发起人 PlutoKeating 提出的核心诉求，按时间线整理：

1. **做一个把 DeepSeek Harness 接入飞书的 IM 插件**，定位类似于此前爆火的 `opencode-telegram-bot`、`mimocode-telegram-bot`、`cc-switch` 这类工具。
2. **结合该插件做到完整的项目工作区管理**（多项目、会话隔离、上下文持久化等）。
3. **目标产出**：一个可以 `clone` 仓库后**一键安装运行**，甚至可以直接**上架到 npm 源**、一条命令安装的程序。
4. **项目命名**：`dsh-lark-bot`。
5. **实现路线**：完全照搬 `lark-coding-agent-bridge` 的思路，**仅将 codex 后端换成 dsh（DeepSeek Harness）**，并加上完整的项目工作区管理。
6. **工程化要求**：
   - 严格管理项目目录架构，不允许内容散乱在根目录；克隆下来用于研究参考的仓库与文档，必须单独放在根目录的一个专门子目录（`reference/`）下。
   - 在根目录及必要的子目录位置创建 `.gitignore`，注重长期可持续维护。
   - 先创建合适的仓库目录架构树作为脚手架。
7. **开源规范**：
   - 采用 **AGPLv3.0** 协议（写入官方原文，不留 MIT 文本）。
   - README、仓库介绍、tags 严格使用**中英双语（先中文、后英文）**，格式参考发起人的 GitHub profile 页面。
   - README / 介绍 / tags 均需包含关键词：`dsh`、`deepseek`、`deepseek harness`、`feishu`、`lark`、`bridge`、`bot`。
   - tags 额外包含：`typescript`、`chatbot`、`messaging`、`deepseek-harness`、`dsh-plugin`。
8. **工作流规范**：项目根目录必须有 `AGENTS.md`（内容来自发起人的私有 gist，是约束 AI Agent 开发的规范），不是本机 Hermes 的 AGENTS.md。

---

## 3. 产出预期 · Expected Outputs

| 目标 | 说明 |
| :--- | :--- |
| **一键安装运行** | `clone` 后一条命令即可启动；最终上架 npm，`npx dsh-lark-bot`（或 `npm i -g dsh-lark-bot`）即可拉起 |
| **飞书原生体验** | 流式卡片、交互按钮、图片 / 文件、文档评论、富文本回复，全程双语 |
| **完整项目工作区管理** | 多项目隔离、git worktree / 分支、项目级规则注入、上下文持久化、任务调度、沙箱隔离（核心差异化能力） |
| **可长期维护** | 工程化目录树、完善文档、CI、AGENTS.md 工作流规范 |

---

## 4. 核心功能需求 · Core Functional Requirements

### 4.1 桥接（bridge）
- 通过飞书/Lark **WebSocket 长连接**（`@larksuite/channel` + PersonalAgent 应用）收发消息，免公网服务器、免域名、免内网穿透。
- 私聊直接发消息、群聊 `@bot`、话题 / thread、文档评论均可触发。
- **流式卡片**：文本与工具调用实时更新在同一张卡片上。
- **COT 过程消息**：可选先发过程消息再发最终答案。
- 图片 / 文件：下载到本地后交给 agent 处理。

> 状态说明：私聊、群聊 `@bot`、话题（topic）已实现；**文档评论**与**富文本回复**为规划中能力，
> 当前版本未实现。

### 4.2 会话管理（session）
- 每个 chat / topic / thread / 文档评论 → 独立 session，互不串扰。
- 排队合并：连续消息合并处理；运行中的消息排队到下一轮。
- 中断命令：`/new`、`/cd`、`/ws use`、`/stop` 可打断当前任务。
- 会话续跑 `/resume`、状态查询 `/status`。

### 4.3 项目工作区管理（workspace，核心差异化）
- `/cd <path>` 切换工作目录；`/ws save/use/list/remove` 管理命名工作区。
- **git worktree / 分支隔离**：每个会话绑定独立工作区，互不串改。
- **项目级规则注入**：每项目注入 AGENTS.md / dsh preset / cordis.yml。
- **上下文持久化**：append-only session log，支持 fork / resume / 回放。
- 多项目导航卡片。

### 4.4 审批与安全（approval & security）
- 用户白名单 + 访问控制（`/invite user/admin/group`）。
- 逐操作审批（卡片按钮回调 / 命令式确认兜底）。
- 沙箱隔离（dsh 自带 sandbox capability，含 landlock）。
- 幂等看门狗 `/timeout`（agent 无输出 N 分钟自动 kill）。

### 4.5 任务调度（scheduling）
- 异步任务队列，长任务不阻塞事件回调。
- 定时任务 / 依赖编排（dsh 自带 workflow capability）。

> 状态说明：当前仅有单 scope 运行锁与消息排队（`PendingQueue`）；
> **异步任务队列 / 定时任务 / workflow 编排**属于 P3 待办，尚未实现。

### 4.6 模型 / provider / 凭据管理（已实现，0.5.0）

- `/model`：查看当前会话模型、dsh 默认模型与可用模型列表；`/model use <id>` 按会话热切换
  （下一轮生效），`/model default <id>` 写入 dsh `agent-default-model`，`/model reset` 清除覆盖。
- `/providers`：查看 dsh 已配置 providers / 模型 / 凭据状态。
- `/provider add|update|remove <id>`：管理 `deepseek-official` 与自定义 pi-ai provider
  （协议白名单 `openai-completions` / `openai-responses` / `anthropic-messages`）。
- `/model add|remove <provider> <modelId>`：增删 provider 的模型目录。
- `/key set|remove|list <引用名>`：读写 `~/.dsh/.credentials.yaml`。
- 实现约束：与 dsh Web **Settings → Models** 同一存储协议（`~/.dsh/settings.yaml` +
  `~/.dsh/.credentials.yaml`，`patchNode` 叶子 diff、`<file>.lock` 写锁、原子替换、凭据文件
  0600 / 目录 0700）；settings 只存 `apiKeyEnv` 引用，字面密钥不进 settings 与聊天记录；
  除查看类命令外均为管理员操作；密钥值永不回显。

---

## 5. 规范与约束 · Specifications & Constraints

| 类别 | 约束 |
| :--- | :--- |
| **协议** | AGPLv3.0（官方原文，见根目录 `LICENSE`） |
| **语言** | 中英双语，先中文后英文 |
| **运行时** | Node.js ≥ 22.19（`package.json` engines） |
| **后端 agent** | DeepSeek Harness（`dsh`），默认官方 SDK client（`@deepseek-ai/dsh-sdk-client`），ACP 审批可选，headless legacy |
| **关键词** | README / 介绍 / tags 含 `dsh`、`deepseek`、`deepseek harness`、`feishu`、`lark`、`bridge`、`bot` |
| **tags** | `typescript`、`chatbot`、`lark`、`feishu`、`deepseek`、`deepseek-harness`、`dsh-plugin`、`messaging`、`bot`、`bridge`、`dsh` |
| **目录结构** | 参考克隆仓库统一放 `reference/`（不提交，仅跟踪 `reference/.gitignore` 与 `reference/README.md` 两个元文件） |
| **工作流** | 遵循根目录 `AGENTS.md`（发起人私有 gist 的规范） |
| **生态交付** | 满足 `docs/ECOSYSTEM.md`（package.json / README 九章节 / 风险披露 / DSH 版本声明 / 兼容性自检） |
| **代码变更** | 所有源码改动走 coding agent CLI（MiMoCode 等），不直接手写源码 |

---

## 6. 技术决策 · Technical Decisions

详见 [`ARCHITECTURE.md`](ARCHITECTURE.md) 与 [`RESEARCH.md`](RESEARCH.md)，核心结论：

1. **飞书通道与 agent 后端解耦**——桥接层复刻 `lark-channel-bridge` 成熟做法，agent 后端通过 adapter 抽象。
2. **dsh 为默认后端**，通过 ACP（Agent Client Protocol）或 JSON-RPC 接入；可切换 claude / codex / opencode。
3. **工作区管理是核心差异化**——会话绑定 git worktree + 项目规则注入 + 上下文持久化。
4. **注意**：dsh 与 claude/codex 接口不同（官方提供 SDK client / ACP server / headless 三种接入形态，
   后者是常驻交互式 REPL），所以「换 dsh」不是 1:1 替换，需重写 agent adapter 层。当前实现：
   **默认 SDK client**（原生 session + 流式 thinking/text）、**ACP 审批模式**、**headless legacy**，
   三者都收敛到同一 `AgentEvent` 契约，飞书层无需感知差异。

---

## 7. 路线图 · Roadmap

见 [`roadmap.md`](roadmap.md)（P0 脚手架 → P1 MVP → P2 工作区 → P3 审批/调度 → P4 npm 发布 →
P5 后台服务 → P6 模型/凭据管理 → P7 兼容自动化）。

---

## 8. 相关文档索引 · Document Index

| 文档 | 内容 |
| :--- | :--- |
| [`README.md`](../README.md) | 项目概览（双语） |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 架构分层与目录映射 |
| [`adapter-notes.md`](adapter-notes.md) | dsh adapter 接入说明（接口 / 落点 / 路线） |
| [`ECOSYSTEM.md`](ECOSYSTEM.md) | 生态兼容与交付标准（实现工程师必读） |
| [`RESEARCH.md`](RESEARCH.md) | 调研报告（官方现状、参考项目、可行性、技术差异） |
| [`roadmap.md`](roadmap.md) | 路线图与里程碑 |
| [`../AGENTS.md`](../AGENTS.md) | AI Agent 开发工作流规范 |
| [`../reference/`](../reference/) | 参考克隆仓库（不提交） |
