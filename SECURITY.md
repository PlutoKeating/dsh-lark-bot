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

## 数据与凭据 · Data & credentials

- 本地配置 `~/.dsh-lark/config.json` 以 `0600` 权限写入。
- 飞书凭据明文保存在本机配置文件；日志与卡片不输出真实密钥。
- 后台服务把 `DEEPSEEK_API_KEY`、`DSH_LARK_*`、`PATH` 等环境快照到
  `~/.dsh-lark/service/service.env`（`0600`）；systemd / launchd 单元文件中的 `EnvironmentFile`
  只引用该文件，不内联密钥。
- 后台运行日志写入 `~/.dsh-lark/profiles/<profile>/logs/bot.log`（JSON Lines，密钥字段脱敏后输出）。
- 所有数据仅在本机、飞书开放平台与 DeepSeek API 之间流转；无遥测。

## 报告渠道 · Reporting

发现安全漏洞请通过 GitHub Security Advisory 私下报告，**不要**公开 issue。
