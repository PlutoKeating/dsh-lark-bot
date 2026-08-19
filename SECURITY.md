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
8. **审批**：默认 SDK / Web 宿主在 `tools/pre-execute` 强制阻断高风险调用并通过 dsh rc.8
   `approval/request` 回调，ACP 使用 `session/request_permission`。按隔离 scope 持久化的
   `ask/allow/deny` 策略（0600，失败回滚且不报成功）决定弹一次性卡、自动放行或直接拒绝；只有管理员可修改，
   显式目标仅限当前 chat 内 scope，`deny`
   会在聊天中明确告知。该策略只作用于逐工具审批，不跳过后续独立的计划门禁；run 结束或 callback
   断连只结算所属 session 的挂起请求。legacy headless 无工具回调，因此不宣称受该策略保护。
   SDK / ACP / Web agent 对较大或高风险动作还会通过 `lark_request_plan_approval` 暂停；同一 turn
   未批准时 pre-execute 策略拒绝写入、删除、移动、命令执行与 `run_code`。完整计划发到当前飞书
   会话，只有卡片批准后才继续；继续规划会把可选文字意见返回 agent。run/callback 结束时只取消
   所属 session 的挂起门禁。该门禁是人机确认层，不替代 dsh sandbox 或 ACP 的逐工具权限审批。
9. **管理操作鉴权**：飞书会话内对 dsh 配置与访问白名单的写操作（`/model default`、
   `/model add|remove`、`/provider add|update|remove`、`/key set|remove`、`/invite user|admin|group`
   与 `/invite remove …`）、`/permission ask|allow|deny`、`/replies set|default`，以及群聊会话隔离模式写操作（`/isolation group|topic|member`）仅管理员可执行；首个扫码绑定的 operator 自动成为管理员，之后由现有
   管理员经 `/invite admin <open_id>` 添加（`/invite list` 为只读、开放）。查看类命令
   （`/model`、`/providers`、`/key list`）开放。`/doctor` 因包含本机运行状态与最近日志，仅管理员可执行。
10. **本地回调隔离**：`lark_notify`、`lark_send_file`、`lark_ask_user`、`lark_request_plan_approval` 与
    `approval/request` answerer 的回调
    服务只绑定 `127.0.0.1`，每次启动生成随机
    token 鉴权（不落盘、不进日志），请求体限 1MB；`/notify` 与角色 / 配置写命令同为管理员操作。
    文件回传不信任 runtime 自报 cwd：bridge 以 native session 反查 scope/workspace，只允许该
    workspace、该 scope 实际 worktree/归档与实例日志内的 realpath 普通文件；以 no-follow 打开后
    在同一文件句柄复核文件身份并有界读取，拒绝竞态 / symlink 越界、非法文件名和默认超过
    20 MiB 的文件；agent 工具目标固定为该 session 的原 chat/thread。归档跨会话转发仅管理员可用。
    主动通知偏好默认关闭；普通用户只能为当前 scope 设置当前目标，跨会话目标要求管理员且必须已在
    `ScopeDirectory` 登记。偏好文件为 0600，提醒发送失败不回写或改变 durable job 终态。
    回复合并与近似去重默认关闭；`reply-policies.json` 为 0600 且写失败回滚。近似去重只在同发送者、
    同 immutable scope + workspace 与有限时间窗内生效，并对短文本要求规范化精确相等，降低误拦截
    其他成员或不同项目任务的风险；命中时向原消息明确回执。
11. **多机器人 peer 鉴权与防循环**：只有 `fleet.json` 中已启用且 identity 唯一的 bot open_id，
    在群内真实 @ 当前 bot 时才可交接；未知 bot、未 @、system/anonymous 消息拒绝。bot 文本不进入
    slash-command 管理管线。连续交接由跨进程 `handoffs.json` 原子计数、按 messageId 去重，超过
    `DSH_LARK_BOT_HANDOFF_MAX` fail closed；只有通过 freshness 检查的真人消息能重置计数。fleet、
    handoff 与共享 `config.json` 写入均使用原子 owner 目录 + 唯一 token 子文件的 lease 锁并心跳续租；
    回收/释放只删除精确 token，再对空目录 `rmdir`，不会误删替代 owner。dead-owner / 遗弃 lease
    仍可回收。附加实例拒绝无法隔离广播 session 的共享 `web` adapter。
12. **安全网守护（默认随 `setup` 安装）**：
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
- 卡片语言由飞书/Lark 客户端根据 Card JSON 2.0 的 `zh_cn` / `en_us` variant 本地选择；bridge
  不读取、不推断也不持久化成员 locale。无法 per-viewer 选择的 Markdown/toast 直接并列中英文。
- 多机器人 registry `~/.dsh-lark/fleet.json` 只保存实例/profile 名与 bot open_id/name；共享
  `handoffs.json` 保存 chat id、最近 message id 和轮数（均 0600）。这些标识会让本机用户看到
  哪些机器人/群参与过交接；peer name/open_id 会进入每轮 agent prompt 并随任务上下文发送给
  当前模型 provider，以支持精确 @ 交接。交接内容仍发送到共享群，不构成消息隐私隔离。
- 每个额外实例的 dsh provider 设置与凭据位于独立
  `~/.dsh-lark/bots/<name>/dsh/{settings.yaml,.credentials.yaml}`；service env 快照标准 DeepSeek key
  与该实例配置中已引用的 credential 环境键。`bot remove` 删除 `.credentials.yaml` 与 service env，
  保留不含字面密钥的 settings/runtime session 以便恢复；其余 DSH_HOME 数据需由用户备份后手工清除。
- 桥接引擎始终在 dsh 宿主进程内运行。可选 `service install` 会将启动所需的
  `DSH_LARK_*`、运行路径及实际 provider `credentialRef` 环境键白名单快照到
  `~/.dsh-lark/service/<profile>.env`（POSIX 0600；Windows 用 `icacls` 移除继承并只授予当前用户）；macOS plist / Windows 计划任务不嵌入密钥，
  隐藏 runner 在启动时读取快照。敏感值不进日志与卡片；环境变更后需 `service restart` 刷新。
- 正常服务生命周期以 profile 级原子锁串行化；portable status 的 PID 必须同时匹配 Linux
  `/proc` starttime、`service-supervise` 命令和 profile 后才可发送信号，强制停止作用于已验证的
  独立进程组，避免 PID 复用误杀或遗留孤儿 dsh。stop/uninstall intent 会阻止 guardian 回拉。
- 桥接引擎日志以 JSON Lines 输出到 stderr（由 dsh 宿主进程捕获），密钥字段脱敏后输出；
- `/doctor` 诊断文件在内存生成并直接上传，不创建临时文件；仅包含非敏感配置计数、当前 workspace
  的运行摘要、服务状态与最多 64 KiB 的当前 bridge 进程内结构化事件；不读取共享 dsh 宿主 stdout。
  结构化事件只保留代码内固定枚举的 category/event 与固定数值字段，
  时间被规范化，所有其他字段名和值均丢弃，
  因而不含消息正文/transcript/凭据标识或值。
  导出前会再次对 Bearer、`sk-`、`api_key`、当前进程已知敏感环境值及主目录脱敏。群中上传的文件
  对群成员可见，因此命令仅限管理员，仍建议私聊生成并由发送者转发前复核。
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
  `sessions.json`（`0600`），并按 scope + canonical workspace cwd 隔离；最近 context 快照同时保存
  产生它的 native sessionId 与 canonical provider/model 身份，并可由
  `/status` 卡在身份匹配时展示。未知或身份不匹配字段不估算；member scope 的刷新动作
  校验 operator `open_id` 与 owner，但共享群里已发送的状态卡仍对群成员可见。
- bridge 接收的普通 agent 消息在入队前写入 `profiles/<profile>/jobs.json`（0600）：包含原始正文、
  附件/提及元数据、chat/thread/scope、workspace、状态及受控 checkpoint，最多保留 500 条终态记录。
  checkpoint 不含隐藏推理正文或工具参数；`/jobs` 展示先脱敏并按 scope + workspace 隔离。原始 prompt
  仍可能包含用户主动输入的密钥，安全边界与 `sessions.json` 相同。running 崩溃后只标记 interrupted，
  不自动重跑可能已有副作用的工具；显式 retry 会再次执行，用户必须先对账。
- 审批卡会把工具名、理由、调用标识及可取得的执行参数发送到当前会话；member scope 只限制谁能
  点击，并不隐藏卡片正文。涉及密钥、私有路径或敏感命令时应使用私聊。
- 群消息在底层 channel 进入 bridge 后执行 mention gate：普通群消息仍需 @bot（或管理员明确开启
  no-at 模式）；仅当 `replyToMessageId` 命中当前进程内 pending 问答卡时可免 @。文字答案必须属于
  同 chat/topic，member scope 还要求 sender `open_id` 等于 owner；拒绝的回复不会结算问题或进入任务队列。
  no-at 的实时事件与历史轮询都再次校验当前 `allowedUsers` / `allowedChats`。`scopes.json` 会保存
  每个 scope 最近一次入站 messageId，作为 topic 问答卡的 reply anchor。

## 报告渠道 · Reporting

发现安全漏洞请通过 GitHub Security Advisory 私下报告，**不要**公开 issue。
