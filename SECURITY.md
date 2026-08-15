# 安全说明 · Security

> dsh-lark-bot 把本机 DeepSeek Harness（`dsh`）暴露给飞书 / Lark IM。本文件说明威胁模型、
> 默认安全姿态与报告渠道。Security model for a bridge that exposes a local coding agent to Feishu / Lark.

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
   - 群聊 / 话题必须 `@bot` 才响应（传输层强制，`requireMention: true`）。
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
9. **管理操作鉴权**：飞书会话内对 dsh 配置的写操作（`/model default`、`/model add|remove`、
   `/provider add|update|remove`、`/key set|remove`）仅管理员可执行（管理员由
   `/invite admin <open_id>` 定义）；查看类命令（`/model`、`/providers`、`/key list`）开放。
10. **本地回调隔离**：`lark_notify` 工具的回调服务只绑定 `127.0.0.1`，每次启动生成随机
    token 鉴权（不落盘、不进日志），请求体限 1MB；`/notify` 与角色 / 配置写命令同为管理员操作。
11. **安全网守护（默认随 `setup` 安装）**：
    - 守护是独立于 dsh / Cordis 的最小进程，只读取本地状态与进程命令行（`ps`，不读内存），
      不导入任何 dsh 代码、不监听公网端口；
    - dsh 在线时守护**不连接飞书**（同 app 长连接仅允许单连接，避免抢占正常通道）；仅在
      「曾观察 dsh 在线 且 心跳过期 + 无 dsh 进程」时接管通道；
    - 控制信号默认拒绝：仅管理员（`access.admins`，无管理员时回退 `allowedUsers`）可触发
      `/safemode` 系列命令，未授权消息静默丢弃；
    - 过期事件复用 `DSH_LARK_EVENT_FRESHNESS_MS` 窗口拒绝；
    - 心跳 / 守护状态文件以 `0600` 写入；安全模式仅挂载官方核心 bundle（`dsh-base` +
      `dsh-headless`），不加载任何第三方插件，避免把故障面带进救援通道。

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

## 报告渠道 · Reporting

发现安全漏洞请通过 GitHub Security Advisory 私下报告，**不要**公开 issue。
