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
| **一键安装部署** | 一行命令 `npx dsh-lark-bot@latest setup --profile <name>` 装进 dsh profile，`dsh --profile <name>` 启动并首次扫码；桥接引擎作为 dsh 标准插件在 dsh 进程内运行 |
| **飞书原生体验** | 流式卡片、交互按钮、图片 / 文件、文档评论、富文本回复，全程双语 |
| **完整项目工作区管理** | 多项目隔离、git worktree / 分支、项目级规则注入、上下文持久化、任务调度、沙箱隔离（核心差异化能力） |
| **可长期维护** | 工程化目录树、完善文档、CI、AGENTS.md 工作流规范 |

---

## 4. 核心功能需求 · Core Functional Requirements

### 4.1 桥接（bridge）
- 通过飞书/Lark **WebSocket 长连接**（`@larksuite/channel` + PersonalAgent 应用）收发消息，免公网服务器、免域名、免内网穿透。
- 私聊直接发消息、群聊 `@bot`、话题 / thread、文档评论均可触发。
- **流式过程卡**：Card JSON 2.0 原生折叠面板实时更新阶段、耗时、工具名与状态；原始 thinking、
  工具输入输出、草稿正文和底层错误不得进入卡片正文、兼容快照或消息预览。平台拒绝折叠组件时
  自动回退具有同一隐私边界的 legacy 流式卡。
- **最终回答**：正常完成后作为独立 Markdown 消息发送，继承 reply/thread 路由；过程卡失败不能
  阻断最终投递，最终消息发送失败时把回答正文回填卡片且不丢失会话记录。
- 图片 / 文件：下载到本地后交给 agent 处理。

> 状态说明：私聊、群聊 `@bot`、话题（topic）已实现；**文档评论**与**富文本回复**为规划中能力，
> 当前版本未实现。

### 4.2 会话管理（session）
- 私聊始终独立；群聊默认按 topic/thread 隔离。管理员可用
  `/isolation group|topic|member` 切换整群共享、话题独立或成员独立，策略按 chat 持久化；
  切换不迁移或删除旧 scope，会话可在切回后继续，旧运行的停止 / 审批 / 问答动作仍可达。
  成员任务卡按入队 scope 显示发送者 open_id，不受排队期间的策略切换影响。
- 排队合并：连续消息合并处理；运行中的消息排队到下一轮。
- 消息可靠性（issue #28）：普通 agent 消息必须以 messageId 幂等、先原子写 profile 级任务账本再
  进入内存队列；启动自动重放 queued，遗留 running 标记 interrupted 并保留安全 checkpoint，
  不自动重跑可能已有外部副作用的任务。`/jobs` 按 scope + workspace 对账/显式重试，`/status` 与
  重连提示显示统计。保证仅覆盖 bridge 已接收并落盘的事件，不宣称恢复平台从未投递的消息。
- 中断命令：`/new` 只打断并清空当前 workspace 的任务；`/stop` 仍可打断 scope 内任务。
  `/cd`、`/ws use` 切换前中断旧 workspace 的 active run，但其 native session、transcript、指标与归档保留。
- 会话续跑 `/resume`；`/status` 以可原位刷新的卡片展示工作区、有效模型、session、active runs、
  版本、真实 context used/limit/percentage、累计 input/output/cache token 与待审批/提问/计划数。
  上游不可得字段必须显示“暂无”，不得估算；pending 只统计当前 workspace 的 session/run，成员 scope 状态卡只允许 owner 刷新。
- 管理员可在飞书使用 `/doctor` 生成可下载诊断文件：版本/平台、非敏感配置计数、当前 workspace
  运行与账本摘要、服务状态、当前 bridge 进程内有界最近结构化事件（不读取共享 dsh 宿主 stdout）；
  不含凭据、消息正文或 transcript，内存生成、
  上传前再次脱敏，失败明确回执。
- **会话 / 任务归档**（0.6.0，issue #31 增强）：`/archive [note]` 把完整会话导出为 Markdown + JSONL
  并直接上传当前聊天（归档目录为独立 Git 仓库，每次归档单独 commit）；上传失败保留本地文件，
  `/archive send <id> [scope|chatId]` 可按当前 scope + workspace 重发，管理员可转发到已登记会话。
  `/retention [N|default]` 调整每 scope + workspace 保留窗口，
  超窗消息自动归档；`/archive list` 查看、`/archive clean` 只按当前 workspace 的保留策略清理
  （`DSH_LARK_ARCHIVE_MAX` / `DSH_LARK_ARCHIVE_MAX_AGE_DAYS`）。

### 4.3 项目工作区管理（workspace，核心差异化）
- `/cd <path>` 切换工作目录；`/ws save/use/list/remove` 管理命名工作区；同一 scope 按 canonical cwd
  保存独立 session，A → B → A 会恢复 A 的 native session 与上下文。
- **git worktree / 分支隔离**：worktree 由 scope + 项目路径共同派生，不同项目互不串改；旧 scope-only
  worktree 先核验 owning repo 并把会话、旧 retention 归档归回真实项目，匹配时 Git 原位迁移，
  不匹配时保留旧树并另建新树。
- **项目级规则注入**：每项目注入 AGENTS.md / dsh preset / cordis.yml。
- **上下文持久化**：append-only session log，支持 fork / resume / 回放。
- **自然问答续接**：等待问答卡期间可提交表单或直接回复卡片；回复按 card messageId、topic 与 member owner 精确路由，单选/多选也接受自由文本补充，答案到达后原 agent turn 自动继续。
- 多项目导航卡片。

### 4.4 审批与安全（approval & security）
- 用户白名单 + 访问控制（`/invite user/admin/group`）。
- 逐操作审批（issue #24）：默认 SDK / Web 以 `tools/pre-execute` 强制门禁 + dsh rc.8 `approval/request` answerer，ACP 通过
  `session/request_permission`；统一提供“允许执行一次 / 拒绝”卡，展示执行内容和理由。等待暂停
  所属 run 的 idle watchdog，无固定截止；拒绝作为工具结果返回 agent 而非终止整个任务。
- 关键任务计划门禁（issue #18）：完整计划先作为普通消息发出，再用带可选文字意见的卡片批准执行
  或继续规划；决定回写原 agent turn，等待期间按 session 暂停 idle watchdog；当前 turn 未批准时
  runtime pre-execute 策略拒绝写入、删除、移动、命令执行与 `run_code`。
- 沙箱隔离（dsh 自带 sandbox capability，含 landlock）。
- 空闲超时看门狗 `/timeout`（agent 持续 N 分钟无输出 / 无活动事件自动终止；活跃的流式任务
  不会被误杀）。

### 4.5 任务调度（scheduling）
- 异步任务队列（0.6.0）：同一 scope 默认 2 个 run 并行（`/concurrency` /
  `DSH_LARK_SCOPE_CONCURRENCY` 调整，1 为严格串行），消息批量合并后以独立 run 推进，
  互不阻塞事件回调；并行 run 使用独立 dsh session 与 runId，`/status` / `/stop` 覆盖全部。
- 持久任务 receipt（issue #28）：`jobs.json` 以 0600 原子快照保存最小消息/routing/workspace 与
  queued/running/terminal 状态，checkpoint 不含隐藏推理或工具参数；终态最多保留 500 条。
- 定时任务 / 依赖编排（dsh 自带 workflow capability）：规划中，依赖上游能力接入。

> 状态说明：**scope 内并行 run 与异步任务队列已实现（0.6.0）**；定时任务 / workflow 编排
> 属于后续迭代，等待上游能力接入。

### 4.6 模型 / provider / 凭据管理（已实现，0.5.0）

- `/model`：查看当前会话模型、dsh 默认模型与可用模型列表；`/model use <id>` 按会话热切换
  （下一轮生效），`/model default <id>` 写入 dsh `agent-default-model`，`/model reset` 清除覆盖。
- `/providers`：查看 dsh 已配置 providers / 模型 / 凭据状态。
- `/provider add|update|remove <id>`：管理 `deepseek-official` 与自定义 pi-ai provider
  （协议白名单 `openai-completions` / `openai-responses` / `anthropic-messages`）。
- `/model add|remove <provider> <modelId>`：增删 provider 的模型目录。
- `/mode [quick|balanced|deep]`（兼容 `/effort`）：通过大白话双语卡片或文字命令选择当前 scope 的执行强度；默认 balanced，按 scope 持久化，`/status` 展示。每个 run 启动时固化模式，切换只影响下一轮，不中断已有任务或上下文；任何模式都不得降低权限与计划审批要求。
- `/key set|remove|list <引用名>`：读写 `~/.dsh/.credentials.yaml`。
- 实现约束：与 dsh Web **Settings → Models** 同一存储协议（`~/.dsh/settings.yaml` +
  `~/.dsh/.credentials.yaml`，`patchNode` 叶子 diff、`<file>.lock` 写锁、原子替换、凭据文件
  0600 / 目录 0700）；settings 只存 `apiKeyEnv` 引用，字面密钥不进 settings 与聊天记录；
  除查看类命令外均为管理员操作；密钥值永不回显。

### 4.7 多角色 Agent（multi-role agents，0.6.0）

- `/role save <id> <name> [--persona <文案>] [--model <id>] [--tools <csv>] [--rules <文案>]`
  定义角色（管理员）；`/role set <id>` / `/role clear` 按 scope 绑定 / 解除。
- 角色指令（persona / 工具指引 / 角色规则）随每次 run 的 prompt 注入，无需重启 runtime；
  模型优先级：每会话 `/model use` > 角色 `--model` > profile 偏好 > dsh 默认 > 环境默认。
- 角色定义持久化在 `~/.dsh-lark/profiles/<profile>/roles.json`（0600）。
- 设计取舍：不采用「每角色独立 dsh runtime profile」——那会与 scope 内并行 run 冲突
  （单个 runtime 无法同时承载多个 persona），prompt 注入 + 每请求 model 参数是可与并行
  协同共存的完整方案。

### 4.8 出站 @ 提及与跨会话通知（outbound notify，0.6.0）

- 出站契约 `SendOptions { replyTo?, mentions?, threadId? }`：`mentions` 以
  `MentionTarget { userId, name? }` 表达，桥接层自动拼接 `<at>` 提及标记。
- `ScopeDirectory`（`<profile>/scopes.json`）持久化 scope → chat/thread/最近入站 messageId 映射；
  `/notify <scope|chatId> <text>`（管理员）与 `/notify list`。
- agent 侧 `lark_notify` dsh 工具（SDK / ACP runtime 自动装配）：`text` / `scope` /
  `chat_id` / `mention_user_ids`；经 `http://127.0.0.1:<随机端口>/notify` + 每启动随机 token
  回调 bridge（仅回环，不监听公网，token 不落盘）。

### 4.8.1 主动通知偏好（issue #33）

- Web profile 默认关闭；管理员可在 dsh Web 为无 scope 覆盖的会话设置 `completed` 或 `all`。
  `/notifications on` 按当前 immutable scope 显式覆盖，事件可选任务完成、失败与审批等待，可配置
  @ open_id 和审批等待 N 分钟后的一次性提醒；`show` 查看、`off` 显式关闭、`default` 恢复 Web
  默认，`/status` 可见。
- 普通用户只能把提醒发到当前 scope；管理员可选择 `ScopeDirectory` 已登记的 scope/chat。偏好以
  0600 atomic write 持久化，写失败回滚，重启不丢。
- 完成/失败只在 durable job 终态落盘后发送一次；SDK/Web 与 ACP 工具审批均启动/取消 reminder。
  通知失败不改变任务终态；Web 默认与 scope 覆盖均为关闭时不产生额外消息。

### 4.8.2 回复流量控制与近似去重（issue #34）

- 默认保持即时逐条回复；profile 管理员或当前群的群主/群管理员通过 `/replies set merge=N batch=N interval=N dedupe=N` 按 immutable
  scope 配置，所有成员可查看，`default` 恢复默认，`/status` 展示有效值。
- 最终回答在合并窗口内聚合；每条消息最多包含配置数量的任务答案，超出部分在 bridge 进程存活期间
  保留内存队列并遵守批次最小间隔，不因批量上限丢弃答案。单任务兼容原 reply/thread anchor；
  合并任务保留 thread 并标出各原 messageId。
- messageId 继续由 durable ledger 精确幂等；启用近似去重后，仅比较同发送者、同 scope + workspace、
  配置时间窗内的规范化正文，短文本只做规范化精确匹配，高相似长文本明确提示后不执行。
- 策略以 0600 atomic write 持久化，失败回滚且不报成功，重启不丢。

### 4.8.3 结果文件直接回传（outbound files，issue #31）

- SDK / ACP / Web agent 自动获得 `lark_send_file(path, file_name?)`；目标由当前 native session
  固定为原 chat/thread，不允许模型指定其他会话。
- bridge 只读取当前 workspace、当前 scope 的实际执行 worktree、当前 scope 归档和实例日志中的
  realpath 普通文件；runtime cwd 仅解析相对路径，不能扩大允许根。路径包含检查必须统一平台路径
  别名，并从最深已存在祖先解析尚未创建的后代。拒绝 symlink 越界、目录、不安全
  文件名与默认超过 20 MiB 的文件，失败作为结构化工具结果返回。
- 回调沿用 127.0.0.1 + 每启动随机 token；文件内容不进入 JSON 请求，bridge 校验后直接通过
  channel 二进制上传能力发送。

### 4.8.4 多机器人实例与交接（multi-bot handoff，issue #25）

- `bot add|list|status|remove` 管理独立 bridge profile、dsh profile、PersonalAgent 身份和用户服务；
  每个实例的模型、provider、凭据、session、scope、worktree 与 archive 相互隔离。
- 只有已登记启用 peer 的 bot 事件且真实 @ 当前 bot 时才接受交接；peer 身份由飞书 `open_id`
  精确匹配，不信任消息正文伪造。运行 prompt 只暴露登记 peer 的准确 mention 身份。
- 同 chat 连续 bot 回合由跨进程共享计数器限制（默认 6），按 messageId 去重；任何新鲜真人消息
  重置计数，超过上限只提示一次并停止继续调度。
- `fleet.json` / `handoffs.json` 使用 owner-only 持久化与可回收 lease 锁，不存密钥；每个实例
  使用独立 DSH_HOME 隔离 provider/model catalog/credentials/runtime profiles；删除实例保留其
  session/worktree/archive 数据以便恢复。额外实例不扩大 guardian 的单主实例救援边界。
- 附加实例只允许 `sdk` / `acp` / legacy `headless`；创建与启动均拒绝 `web`，避免多个 watcher
  消费同一个 Web agent 广播流而把 session 事件写入错误实例。

### 4.8.5 scope 工具权限策略（issue #30）

- `/permission ask|allow|deny [scope]` 按隔离 scope 管理逐工具审批策略；查询开放，修改仅管理员；
  管理员可指定当前 chat 内的 member/topic scope，跨 chat 目标拒绝。
- 默认 `ask`；`allow` 自动返回一次性允许，`deny` 自动返回拒绝并向原聊天/话题明确说明。
- 策略以 0600 文件持久化，写成功后才确认，失败回滚；重启不丢，并在 `/status` 展示当前有效值。
- SDK/Web `/approval` 与 ACP 原生 permission 共用同一策略语义；计划审批仍独立强制执行。
- legacy headless 不具备工具回调，不纳入策略执行保证。

### 4.9 dsh profile bundle（唯一安装-部署-使用路径）

- `package.json` 声明 `dsh.bundle.patch` → `./cordis.patch.yml`，可用
  `dsh plugin --profile <name> add dsh-lark-bot` 标准安装，或一行
  `npx dsh-lark-bot@latest setup --profile <name>`（自动预批准 pnpm 构建策略后执行标准
  `dsh plugin add`；实测通过）。
- `./plugin`：cordis 插件 `dsh-lark-bot`，profile 启动时**进程内**运行完整桥接引擎
  （`startBridgeEngine`）并注册 `ctx.larkBridge`（status / stop / start）；首次启动无凭据时
  打印二维码完成一次性绑定；`DSH_LARK_DISABLED=1` 时保持停止（插件仍作为标准插件加载）。
- `./invariant`：向宿主 `invariants` 注册表登记包归属（与官方 dsh-lark-channel 同契约）。
- `./notify`：`lark_notify` 工具插件，作为标准工具行装配到 host profile；执行时读取
  `DSH_LARK_NOTIFY_URL` / `DSH_LARK_NOTIFY_TOKEN`。
- `./file`：`lark_send_file` 工具插件，作为标准工具行装配到 host / SDK / ACP profile；读取
  `DSH_LARK_FILE_URL` / `DSH_LARK_NOTIFY_TOKEN`。
- `./approval`：rc.8 `approval/request` 的 terminal answerer；host 与默认 SDK profile 自动装配，
  读取 `DSH_LARK_APPROVAL_URL` / `DSH_LARK_NOTIFY_TOKEN`，ACP 不重复装配。
- `peerDependencies`：`@deepseek-ai/cordis: ^4.0.1`。
- 形态关系：**dsh profile bundle 即唯一运行时形态**——`dsh-lark-bot/plugin` 在 dsh
  进程内运行完整桥接引擎，`lark_notify` 为标准工具行；CLI 仅提供 `setup`（唯一安装命令）/
  `doctor` / 隐藏 `run`，并额外提供 guardian 与可选 `service` 生命周期命令。`service install`
  不恢复旧的独立 bridge engine，只把同一标准 dsh profile 注册为登录自启、异常自动重启的
  systemd user / LaunchAgent / Windows 计划任务（Linux fallback 为 XDG supervisor）；支持
  status/logs/restart/stop/start/uninstall。POSIX 环境快照和元数据为 0600，Windows 环境快照使用
  owner-only ACL；生命周期操作按 profile 加锁，启动前拒绝与现有前台 profile 并存。stop / uninstall
  持久化期望停止状态，guardian 不会擅自拉起；guardian / upgrade 优先复用受管服务防双实例；
  睡眠期间不可收消息，恢复重连后向最近活跃会话提示。

### 4.10 安全网守护（safety-net guardian，issue #6）

背景：dsh 基于 Cordis「一切皆插件」，任一第三方插件报错都可能让整个 profile boot 失败；桥接
引擎运行在 dsh 进程内，dsh 下线时飞书入口随之不可用。需求是在维持插件托管架构的前提下，
额外提供一个**独立于 dsh 进程、系统级常驻的最小「安全网守护」**，让用户在最坏情况下无需
接触命令行即可自救。

- **独立存活**：守护是与 dsh / Cordis 无耦合的最小 Node 进程（不导入任何 dsh 代码），以
  systemd user unit / LaunchAgent / Windows 启动项系统级常驻，由 `dsh-lark-bot guardian run`
  启动。
- **静默守护**：桥接引擎每 `DSH_LARK_HEARTBEAT_MS`（默认 5000）向
  `~/.dsh-lark/profiles/<bridge-profile>/guardian/heartbeat.json` 写心跳；守护在心跳新鲜或
  存在 `dsh --profile <name>` 进程时判定 dsh 在线，不连接飞书、不抢占通道（同 app 长连接
  仅允许单连接）。
- **接收飞书控制信号**：曾观察到 dsh 在线且 dsh 持续下线（心跳过期
  `DSH_LARK_GUARDIAN_STALE_MS`=15000 + 无进程）后，守护用桥接 profile 的凭据 / 白名单接管
  同一 bot 的飞书长连接，接收 `/safemode`、`/safemode status|plugins|stop|exit|help`；仅管理员
  （无管理员时回退白名单用户）可触发。
- **仅核心重启**：`/safemode` 创建 `~/.dsh/profiles/<profile>-safe`，bundles 仅为
  `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless`（官方核心，无第三方插件；两个 bundle
  从 dsh 安装自身的依赖闭包解析，无需 pnpm 安装），以 `dsh --profile <safe> --dump-config`
  探测通过后进入安全模式。进入时优先预置 `~/.dsh/profiles/<profile>-safe-sdk`（官方
  `dsh-base` + `dsh-sdk-jsonrpc-server`，无第三方插件、不挂载 bridge 回调工具），失败回退
  headless profile。
- **受限对话自愈（实时可见）**：安全模式下普通消息优先经 SDK 流式引擎执行——复用正常模式的
  `RunState` / `renderCard` / `streamCard`，以原生折叠面板实时展示思考、工具调用（含 web search）
  与 token 用量并单独发送最终回答；支持原生 `session(id)` 续跑；SDK 不可用时回退
  `dsh --profile <safe> "<prompt>"` 逐条对话（每 scope 最近 30 条上下文自动拼接，近似记忆），
  任务期间卡片仍实时显示“正在思考 / 已运行 Ns / 无响应 Ns”。任一模式都有空闲超时
  （`DSH_LARK_GUARDIAN_SAFE_TIMEOUT_MS`，默认 10 分钟：任务持续无活动事件才调用 `run.stop()`
  并渲染超时卡，活跃任务不会被误杀）、
  `/safemode stop` 与卡片 ⏹ 按钮可终止；同一 scope 同时只允许一个安全任务，忙碌时新消息立即
  回执；“/safemode plugins”执行 `dsh plugin --profile <name> list` 展示清单。
- **可退出、可回退**：`/safemode exit` 优先复用已安装的正常引擎 service，未安装时才 detached
  重启完整 profile；期望停止状态会阻止重启并让 guardian 留在安全模式。成功后短暂延迟、断开飞书
  连接并交还通道；守护状态持久化在 `~/.dsh-lark/guardian.json`（0600），重启不丢
  `profileSeenUp` / `mode`；全程不删除用户已有会话 / 工作区数据。
- **安全约束**：守护进程只读本地状态与进程命令行（`ps`），不读内存；控制命令默认拒绝未授权
  用户；过期事件复用 `DSH_LARK_EVENT_FRESHNESS_MS` 窗口拒绝；心跳 / 状态文件 0600。

### 4.11 Web 单写者适配器（web single-writer adapter，issue #8 / PR #9）

背景：多写者并发写同一会话日志会损坏 session；web 端（dsh web agent）与 bot 同时写导致
偶发 `id collision` 类损坏。需求是把 dsh web agent 作为每个会话的**唯一写者**，从根上根治。

- `DSH_LARK_ADAPTER=web`：驱动本地 dsh web agent（默认 `http://127.0.0.1:3080`，
  `DSH_LARK_WEB_URL` 可改），`session.prompt` 发起回合、`/api/events.mux` WebSocket 消费
  事件；网页端成为唯一写者，bot 只读 mux 事件并转发到飞书卡片。
- `SessionProjectionBridge`（`src/session/projection-bridge.ts`）：仅在用户通过 `/session` 明确确认后，
  将当前 canonical workspace 的一个非 subagent DSH session 独占绑定到当前飞书 scope。禁止
  follow-active、latest-activity-wins、WebUI/TUI resume 自动切换和全 scope 广播。
- 绑定前选择器不显示正文；确认卡必须披露 session 标题/ID、workspace、更新时间、回填数量、scope、
  替换或跨 scope 迁移。确认事务必须匹配披露时 owner，变化即重新确认；迁移后清除旧 scope 的兼容
  session mapping。私聊授权用户可操作，member 仅 owner，共享 group/topic 与跨 scope 迁移仅管理员。
- DSH session log 是唯一 transcript 真源。绑定后 history/live/catch-up 按单调 seq 投影；独占 claim
  与历史确认 cursor 分离，pending history 阻塞 live，cursor 仅在交付成功后原子持久化，失败由重启/
  重连补齐；新投影卡使用稳定 transport idempotency identity，保证崩溃恢复不重不乱。飞书 prompt 用
  可信 rpcId/message identity 与持久 turn 来源抑制回显。
- 历史以数量/字节双限 transcript 卡回填，仅 user/assistant；实时 assistant 使用独立 bot-owned 卡节流
  原位更新，未终态卡可跨重启继续更新，失败追加；tool/thinking 默认不展开，不编辑用户本人消息，
  不猜测 WebUI/TUI 来源。
- **自愈 v2**（`src/session/heal.ts`）：仅对真正损坏的会话日志归档（seq gap 类），
  id-collision 类保留历史；resume 失败时自动清绑定并以新会话重试，用户消息不丢。被拒绝的旧 run
  卡只显示中性的“正在恢复会话状态”，不得先暴露底层错误或在新会话重试成功前宣告恢复成功。

### 4.12 一键彻底升级（one-command upgrade，issue #10）

背景：项目持续高频更新，旧用户（含 0.6.x 遗留形态）升级需手动分步（setup + 重启 + guardian
单独 install），且旧流程/旧版本易导致升级卡住（issue #7 触发）。需求是从当前版本起引入
**完善的版本维护机制与用户一键更新**。

- **一行命令**：`npx dsh-lark-bot@latest upgrade --profile <name> --yes`（旧版本无 upgrade
  命令，经 npx 拉取最新版执行，实现对任意旧用户的一行彻底更新）。
- **覆盖范围**：包本体（`dsh plugin add <name>@<latest>`）+ guardian（幂等重装并重启服务）+
  runtime profile（dsh-lark-sdk / dsh-lark-acp own-package 链接修复 + 陈旧 SDK/ACP 依赖
  即时重装）+ 升级后 `doctor` 验证。
- **运行中实例安全**：默认不中断运行中 dsh profile（只提示重启命令，配置 / 会话 / 凭据不受
  影响）；`--restart` 可选自动重启 guardian 与受管 profile。
- **可回滚 / 可重入**：每次变更记录 `~/.dsh-lark/upgrade-state.json`，`--rollback` 精确回滚到
  上一版本；重复执行幂等（已最新时跳过）。
- **离线 / 安全**：`--force` 离线时按当前版本重装；非交互环境不带 `--yes` 安全中止；
  `DSH_LARK_UPGRADE_REGISTRY` 支持镜像 registry。
- **飞书内自更新**：只有 profile admin 可发送 `/upgrade`；严格更新时返回绑定 scope + 发起人、
  十分钟有效的一次性确认/取消卡。确认后必须先以 0600 持久化精确 npm 版本和原 chat/thread 路由，
  再由独立于 bridge 生命周期的 Guardian worker 执行完整 `upgrade --restart`；取消零变更。重载后
  必须按实际运行版本协调中断状态，并向原路由至多成功回执一次；不得把 worker 原始输出发到飞书。
- **新会话提醒**：每次 `/new` / `/reset` best-effort 查询 npm；只有严格新版本时追加一条简短普通
  文本，已最新、关闭探测或网络失败均无额外行为，也不得影响新会话建立。

### 4.13 dsh Web 可视化配置（issue #36）

- 在官方 **Settings → Plugins → Plugin configuration** 提供 dsh-lark-bot 卡片，不要求 fork/rebuild
  Web；Host/browser 两半随同一个 npm 包交付，并以 `dsh-lark-bot` settings namespace 配对。
- 可查看/修改实际生效的服务区域、App ID、write-only App Secret、默认 workspace、默认模型、
  per-scope 并行默认值、adapter 与主动提醒默认值；扫码 profile 必须正确成为初始值。
- 每项使用中文说明和示例并标注生效时机。保存经官方 durable settings/revision fence 后，连接类
  字段串行停止旧 generation 并自动重连；模型、并行数和提醒安全热更新到后续任务/提醒，不得中断
  active run、出现双实例或把 secret 返回浏览器/日志。
- Bot 无响应与任务失败可在页面直接检查脱敏配置状态，并提供 `/status`、`/doctor` 深入诊断快捷入口；远程只读浏览器明确提示本机修改，
  settings seam 缺失时继续支持飞书命令与环境变量降级。

---

## 5. 规范与约束 · Specifications & Constraints

| 类别 | 约束 |
| :--- | :--- |
| **协议** | AGPLv3.0（官方原文，见根目录 `LICENSE`） |
| **语言** | bot 固定 UI 中英双语：Card JSON 2.0 按每位读者客户端语言显示，Markdown/toast 降级先中文后英文；agent/用户/工具内容保持原文 |
| **运行时** | Node.js ≥ 22.19（`package.json` engines） |
| **后端 agent** | DeepSeek Harness（`dsh`），默认官方 SDK client + rc.8 approval answerer，ACP 协议原生审批可选，headless legacy |
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
   **默认 SDK client**（原生 session + 流式 thinking/text + approval answerer）、**ACP 协议原生审批模式**、**headless legacy**，
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
