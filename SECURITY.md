# 安全说明 · Security

> dsh-lark-bot 把本机 DeepSeek Harness（`dsh`）暴露给飞书 / Lark IM。本文件说明威胁模型、
> 默认安全姿态与报告渠道。Security model for a bridge that exposes a local coding agent to Feishu / Lark.

## 官方分发渠道 · Official distribution channels

- **唯一官方仓库**：<https://github.com/PlutoKeating/dsh-lark-bot>
- **唯一官方 npm 包**：`dsh-lark-bot`（同源双包 `dsh-feishu-bot`），维护者 `plutokeating`
- **唯一安装命令**：`npx dsh-lark-bot@latest setup --profile dsh-lark`
- **Releases 资产**：仅两个 npm tarball（`dsh-lark-bot-<ver>.tgz` / `dsh-feishu-bot-<ver>.tgz`），
  **从不发布 Windows/macOS 可执行文件**
- **校验承诺**：自本文档更新后的下一个 Release 起，每个发布资产随附 `<asset>.sha256` 校验文件；
  安装/使用前请核对 SHA-256，不一致即视为被篡改，请勿安装并报告
- **假冒识别**：任何以本项目名义提供“下载即运行”二进制（尤其 .exe）、或使用仿冒仓库名/包名的分发
  渠道均为**假冒 / 恶意来源**——请勿下载或运行，并截图按下方报告渠道反馈
- **取证存档**：假冒仓库 `tarraencompassing61/dsh-lark-bot` 的取证与处置约定见
  `docs/security/2026-08-17-impostor-repo-evidence/`
- **持续监控**：`pnpm security:monitor`（假冒仓库活动 / npm 仿冒包 / 相似包名抢注），建议每周运行或挂 cron

## 威胁模型 · Threat model

- **凭据泄露**：飞书 `app_id` / `app_secret`、DeepSeek API key、会话内容可能在日志、卡片或进程环境中出现。
- **越权访问**：未授权用户 / 群聊驱动本机 coding agent 执行命令、读写文件。
- **路径逃逸 / 符号链接逃逸**：附件、worktree、`/cd` 相关路径穿越到 bot 状态目录之外。
- **SSRF**：agent 或桥接层被诱导访问内网 / 环回地址。
- **消息重放 / 过期事件**：旧消息或重复事件被当作新指令处理。
- **交互工具不可达**：`ask_user_question`、终端类工具在 IM 场景下无法回达，应默认禁用。
- **救援通道被滥用**：dsh 下线后由守护接管飞书通道，若控制信号无鉴权，任何能私聊 bot 的人
  都能触发安全模式或重启完整 profile。

## 安全姿态 · Security posture

1. **默认拒绝**：
   - 群聊 / 话题普通消息必须 `@bot` 才响应；channel 以 `requireMention: false` 把事件交给
     bridge，由 bridge 在匹配 pending 问答卡回复后执行 mention gate。只有精确回复问答卡可免 @。
   - 配置了白名单后，私聊切换为 allowlist 模式（`dmMode: 'allowlist'`）。
   - 可通过 `DSH_LARK_ACCESS_DEFAULT_DENY=1` 在无白名单时也拒绝私聊（默认关闭以兼容首次扫码绑定）。
2. **密钥脱敏**：结构化日志按字段名（`secret/token/password/api_key`）脱敏；
   自由文本日志与卡片文本对 `Bearer …`、`sk-…`、`api_key=…` 做正则脱敏（`src/config/security.ts`）。
3. **路径 containment**：媒体下载目标、git worktree 目标必须落在各自根目录内
   （realpath 校验，拒绝符号链接逃逸，`isPathWithin`）。
4. **UTF-8 安全截断**：附件文本、卡片摘要按字节截断且不切断多字节字符（`truncateUtf8Safe`）。
5. **过期事件拒绝**：消息时间戳超出窗口即拒绝（`isEventFresh`）。
6. **SSRF 防护**：仅允许 http(s) 公网地址；环回、私有、链路本地、CGNAT、IPv6 ULA 全部拒绝
   （`isSafeHttpUrl`）。
7. **交互工具默认禁用**：SDK / ACP runtime profile 禁用 `user-questions`；
   `DEFAULT_DENIED_INTERACTIVE_TOOLS` 提供工具级黑名单。
8. **审批**：ACP 模式下敏感操作通过 `session/request_permission` 以飞书审批卡一问一答；
   run 结束 / dispose 时所有挂起审批卡结算为拒绝（`src/bot/approvals.ts`）。
   SDK / ACP / Web agent 对较大或高风险动作还会通过 `lark_request_plan_approval` 暂停；同一 turn
   未批准时 pre-execute 策略拒绝写入、删除、移动、命令执行与 `run_code`。完整计划发到当前飞书
   会话，只有卡片批准后才继续；继续规划会把可选文字意见返回 agent。run/callback 结束时只取消
   所属 session 的挂起门禁。该门禁是人机确认层，不替代 dsh sandbox 或 ACP 的逐工具权限审批。
9. **管理操作鉴权**：飞书会话内对 dsh 配置与访问白名单的写操作（`/model default`、
   `/model add|remove`、`/provider add|update|remove`、`/key set|remove`、`/invite user|admin|group`
   与 `/invite remove …`），以及群聊会话隔离模式写操作（`/isolation group|topic|member`）仅管理员可执行；首个扫码绑定的 operator 自动成为管理员，之后由现有
   管理员经 `/invite admin <open_id>` 添加（`/invite list` 为只读、开放）。查看类命令
   （`/model`、`/providers`、`/key list`）开放。
10. **本地回调隔离**：`lark_notify`、`lark_ask_user` 与 `lark_request_plan_approval` 工具的回调
    服务只绑定 `127.0.0.1`，每次启动生成随机
    token 鉴权（不落盘、不进日志），请求体限 1MB；`/notify` 与角色 / 配置写命令同为管理员操作。
11. **安全网守护（默认随 `setup` 安装）**：
    - 守护是独立于 dsh / Cordis 的最小进程，只读取本地状态与进程命令行（`ps`，不读内存），
      不导入任何 dsh 代码、不监听公网端口；
    - dsh 在线时守护**不连接飞书**（同 app 长连接仅允许单连接，避免抢占正常通道）；仅在
      「曾观察 dsh 在线 且 心跳过期 + 无 dsh 进程」时接管通道；
    - 控制信号默认拒绝：仅管理员（`access.admins`，无管理员时回退 `allowedUsers`）可触发
      `/safemode` 系列命令，未授权消息静默丢弃；
    - 过期事件复用 `DSH_LARK_EVENT_FRESHNESS_MS` 窗口拒绝；
    - 心跳 / 守护状态文件以 `0600` 写入；安全模式仅挂载官方核心 bundle（headless：
      `dsh-base` + `dsh-headless`；SDK 流式优先：`dsh-base` + `dsh-sdk-jsonrpc-server`，
      均不挂载第三方插件与 bridge 回调工具），避免把故障面带进救援通道。

## 数据与凭据 · Data & credentials

- 本地配置 `~/.dsh-lark/config.json` 以 `0600` 权限写入。
- 飞书凭据明文保存在本机配置文件；日志与卡片不输出真实密钥。
- 桥接引擎在 dsh 宿主进程内运行，凭据与 `DSH_LARK_*` 环境直接随 dsh 进程提供，无独立服务
  环境快照文件；敏感值不进日志与卡片。
- 桥接引擎日志以 JSON Lines 输出到 stderr（由 dsh 宿主进程捕获），密钥字段脱敏后输出；
  `logs/bot.log` 是 0.6.0 独立服务时代的遗留路径，0.7.0 起不再写入。
- 聊天命令管理的 dsh 配置按官方存储协议写入：`~/.dsh/settings.yaml`（只存 `apiKeyEnv`
  引用，不落字面密钥）与 `~/.dsh/.credentials.yaml`（目录 0700、文件 0600）。bot 永不回显
  密钥值；群聊中粘贴密钥会对群成员可见，建议私聊使用或改用环境变量 / dsh Web 页面录入。
- 所有数据仅在本机、飞书开放平台与 DeepSeek API 之间流转；无遥测。
- 安全网守护相关文件：`~/.dsh-lark/guardian.json` 与
  `~/.dsh-lark/profiles/<profile>/guardian/heartbeat.json`（均 `0600`）；守护读取的飞书凭据
  来自 `~/.dsh-lark/config.json`（`0600`），日志按既有规则脱敏。
- 群聊隔离模式保存在 `~/.dsh-lark/profiles/<profile>/isolation.json`（`0600`）。成员模式会把
  飞书 `open_id` 作为 durable scope owner，因而该标识也会出现在对应 session、scope directory、
  worktree 与 archive 的本地索引或路径中，并显示在共享群的运行卡片上。成员模式隔离的是 agent
  上下文与会话数据，**不是群消息可见性**：任务输入、进度卡和回复仍发送到共享群，群内其他成员
  仍可看到；其他成员不能操作该 member scope 的停止、审批或问答卡，缺失 operator identity 时也
  拒绝操作。涉及私密内容时请改用私聊。
- adapter 实际上报的 input/output/cache token 与 context used/limit 保存在同一 profile 的
  `sessions.json`（`0600`）；最近 context 快照同时保存产生它的 native sessionId 与 canonical provider/model 身份，并可由
  `/status` 卡在身份匹配时展示。未知或身份不匹配字段不估算；member scope 的刷新动作
  校验 operator `open_id` 与 owner，但共享群里已发送的状态卡仍对群成员可见。
- 群消息在底层 channel 进入 bridge 后执行 mention gate：普通群消息仍需 @bot（或管理员明确开启
  no-at 模式）；仅当 `replyToMessageId` 命中当前进程内 pending 问答卡时可免 @。文字答案必须属于
  同 chat/topic，member scope 还要求 sender `open_id` 等于 owner；拒绝的回复不会结算问题或进入任务队列。
  no-at 的实时事件与历史轮询都再次校验当前 `allowedUsers` / `allowedChats`。`scopes.json` 会保存
  每个 scope 最近一次入站 messageId，作为 topic 问答卡的 reply anchor。

## 报告渠道 · Reporting

发现安全漏洞请通过 GitHub Security Advisory 私下报告，**不要**公开 issue。
