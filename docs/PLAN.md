# 开发计划 · Development Plan

> 当前主线执行计划与验收标准。状态随开发进度持续更新。

## 1. 阶段总览

| 阶段 | 目标 | 状态 |
| --- | --- | --- |
| P0 | 仓库、文档、CI、脚手架 | ✅ 完成 |
| P1 | 飞书 bot + dsh 单会话往返 | ✅ 完成 |
| P2 | 项目工作区管理 | ✅ 完成（SDK 原生 session 已接入） |
| P3 | 审批、调度、沙箱 | 🚧 进行中（ACP 审批卡已接入） |
| P4 | npm / GitHub Packages 发布 | ✅ 完成 |
| P5 | 后台服务化（开机自启 + 自动重启） | ✅ 完成 |
| P6 | 模型 / provider / 凭据管理（飞书命令） | ✅ 完成（0.5.0） |
| P7 | 兼容矩阵与自动化（单一事实来源 / 上游雷达 / 真实探测） | ✅ 完成（0.5.1） |
| P8 | 会话 / 任务归档（保留窗口 + 文件 / Git 归档） | ✅ 完成（0.6.0） |

## 2. P1 验收标准

- [x] 首次扫码创建 PersonalAgent 应用
- [x] 私聊消息进入 dsh（SDK runtime / headless）
- [x] 返回流式卡片
- [x] `final_text` 正确渲染
- [x] 会话记忆最近 40 条
- [x] 会话保留窗口可配置 + 超窗自动归档（`SessionArchive`，Markdown + JSONL + Git commit）
- [x] 图片 / 文本文件附件处理
- [x] `/new` `/cd` `/ws` `/status` `/resume` `/stop` `/timeout` `/help`
- [x] 真实飞书账号连续两轮 E2E 验收

## 3. P2 验收标准

- [x] `/cd` 与 `/ws` 工作目录切换
- [x] git worktree 隔离
- [x] 项目级 `AGENTS.md` 注入
- [x] 命名工作区最近使用索引
- [x] 工作空间导航卡片
- [x] `SessionStore.fork` 复制历史
- [x] dsh 原生 session fork / resume / replay（`@deepseek-ai/dsh-sdk-client` `session(id)` + JSONL 持久化）

## 4. P3 验收标准

- [x] 用户 / 群聊访问白名单
- [x] `/invite user|admin|group|list|remove`
- [x] scope 内运行跟踪与 `/stop`（全部 / 定向终止）
- [x] scope 内并行 run（`ActiveRuns` 多 run / `PendingQueue` 并发上限 / `/concurrency`）
- [x] 多角色 Agent（`RoleStore` + `/role` 命令：persona / 模型 / 工具指引 / 角色规则）
- [x] 出站 @ 提及与跨会话通知（`SendOptions.mentions` + `ScopeDirectory` + `lark_notify` 工具）
- [x] 墙钟超时看门狗
- [x] 卡片审批（ACP `session/request_permission` + 审批卡）
- [x] 问答卡（单选 / 多选 / 自由文本）
- [x] 异步任务队列（scope 内并行 run + 消息批量合并；workflow 编排仍待上游能力）
- [ ] 沙箱调度与 workflow 编排
- [x] 会话 / 任务归档（`/archive`、`/retention`、自动保留策略）

## 5. P4 验收标准

- [x] npm 双包发布
- [x] GitHub Packages scoped 双包发布
- [x] GitHub Release 自动创建
- [x] 全局安装 smoke test
- [x] 完整用户手册

## 6. 当前执行顺序

1. ✅ 完成 P1 真实飞书 E2E
2. ✅ 接入官方 `@deepseek-ai/dsh-sdk-client`（原生 session + 流式事件），替换 headless 子进程
3. ✅ 基于 ACP `session/request_permission` 实现卡片审批（ACP adapter 模式）
4. ✅ 安全模块（SECURITY.md + 脱敏 / SSRF / 路径 containment / 默认拒绝 / UTF-8 安全截断）
5. ✅ 三档可变卡片 + thinking 流式展示
6. ✅ 后台服务化：`start` 安装后台服务并加入开机自启，退出 / 崩溃自动重启；`status` / `restart` / `stop`
7. ✅ 模型 / provider / 凭据管理（0.5.0）：`/model` `/providers` `/provider` `/key`，读写 dsh 官方配置
8. ✅ 兼容矩阵与自动化（0.5.1）：`dsh-compat.ts` 单一事实来源 + 上游雷达 + CI 真实探测 + 升级手册
9. ✅ scope 内并行 run 与异步任务队列（0.6.0）
10. ✅ 多角色 Agent（0.6.0）：`/role save|set|clear|list|show|remove`
11. ✅ 出站 @ 提及与跨会话通知（0.6.0）：`/notify` + `lark_notify` 工具 + 回环回调服务
12. ⏳ 定时任务 / workflow 编排（等待上游能力接入）
13. ⏳ 稳定发布下一版本

## 7. 当前阻塞 · Current blocker

- ~~`dsh-type-meta` 404 阻塞~~：**已复核并解除**（2026-08-14）。当前 npm registry 上
  `@deepseek-ai/dsh-sdk-client@0.1.0-rc.6` / `@deepseek-ai/dsh-acp@0.1.0-rc.6` 的真实依赖链为
  `@deepseek-ai/cordis@^4.0.1`、`dsh-llm` / `dsh-session` / `dsh-invariants` / `dsh-sdk-protocol` / `dsh-user-approval` 等，
  **全部已发布且可安装**，`dsh-type-meta` 已不在依赖链中（详见第 8 节验证记录）。
- 本地验证：`dsh --profile dsh-lark`（bundle `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-sdk-jsonrpc-server` overlay）
  已成功完成 `initialize` / `session/prompt` / `shutdown` 真实握手，`assistant/chunk` 流式事件可实时消费。

---

## 8. 战略执行计划（2026-08-14 第三方调研复核后）

> 依据第三方产品调研官的战略分析（复用官方组件 > 借鉴竞品 > 自研），结合本仓库真实代码 / 配置 / 依赖链复核结论，制定并执行以下计划。

### 8.1 关键决策

1. **不转 cordis 插件形态**：保留独立 CLI 桥接形态，但预留未来可选 cordis 形态的钩子（`AgentAdapter` 抽象已满足）。
2. **不再手写 headless JSON 协议**：默认 adapter 换为官方 `@deepseek-ai/dsh-sdk-client`（原生 session + JSON-RPC 协议 + 流式事件）。
3. **审批走官方 ACP**：SDK 协议目前未实现 server→client 请求（审批流），因此审批能力由 ACP adapter 模式提供
   （`@deepseek-ai/dsh-acp` + `@agentclientprotocol/sdk` 的 `ClientSideConnection` + `dsh-user-approval`）。
4. **唯一自研差异化**：git worktree 工作区管理 + AGENTS.md 注入 + 多 agent 抽象，继续投入。
5. **License 维持 AGPL-3.0**（所有者决策项，见 8.7）；`package.json.homepage` 已存在，无需新增。

### 8.2 P0：官方 SDK client 替换 headless（复用官方）

| # | 动作 | 验收 |
| --- | --- | --- |
| P0-1 | 验证 npm 依赖链（`dsh-type-meta` 404 已解除） | registry 实测通过 ✅ |
| P0-2 | 新增依赖 `@deepseek-ai/dsh-sdk-client@0.1.0-rc.6`、`@agentclientprotocol/sdk@0.25.1` | pnpm install 通过 ✅ |
| P0-3 | `src/adapters/dsh/sdk-runtime.ts`：解析 / 确保 `dsh-lark` SDK runtime profile（bundle `dsh-base` + `dsh-sdk-jsonrpc-server` overlay） | 本地真实握手通过 ✅ |
| P0-4 | `src/adapters/dsh/sdk-translate.ts`：SDK `session.event`（`assistant/chunk` / `tool/call` / `tool/result` / `assistant/message`）→ `AgentEvent` | 单元测试覆盖 |
| P0-5 | `src/adapters/dsh/sdk-adapter.ts`：`SdkDshAdapter`（按 cwd 管理 runtime 池 + `session(id)` 原生续跑 + `/stop` 关闭 runtime） | 单元测试 + 真实 runtime 探测 |
| P0-6 | 接线：`DSH_LARK_ADAPTER=sdk\|acp\|headless`（默认 sdk）、`start.ts` / `doctor` / `.env.example` | typecheck / test / build 通过 ✅ |

### 8.3 P0：卡片审批 + 问答卡（复用官方 + 借鉴竞品）

| # | 动作 | 验收 |
| --- | --- | --- |
| P0-7 | `src/adapters/dsh/acp-runtime.ts`：确保 `dsh-lark-acp` ACP runtime profile（`dsh-base` + `@deepseek-ai/dsh-acp` overlay，approval policy `ask`） | profile dump 通过 |
| P0-8 | `src/adapters/dsh/acp-adapter.ts`：`AcpDshAdapter`（`ClientSideConnection` + `newSession` + `requestPermission` → 审批回调） | 单元测试（mock ACP server） |
| P0-9 | `src/card/approval-card.ts`：审批卡（allow-once / reject-once 按钮） | 渲染测试 |
| P0-10 | `src/card/question-card.ts`：问答卡（单选 / 多选 / 自由文本） | 渲染 + 答案提取测试 |
| P0-11 | `src/bot/approvals.ts`：pending 审批注册表 + run 结束/dispose 时结算所有挂起审批卡 | 生命周期测试 |
| P0-12 | 桥接接线：`run-flow` 提供 `onApprovalRequest`（发卡 + 等待按钮）、`channel.ts` 处理 `cmd=approve` | 集成测试 |

### 8.4 P1：安全模块（借鉴 dsh-lark-bridge）

| # | 动作 | 验收 |
| --- | --- | --- |
| P1-1 | 新建 `SECURITY.md`（威胁模型 / 默认拒绝 / 传输层强制 / 报告渠道） | 文档 |
| P1-2 | `src/config/security.ts`：密钥脱敏（`Bearer`/`sk-` 正则）、SSRF 防护清单、路径 realpath containment、默认拒绝、UTF-8 安全截断、过期事件拒绝 | 单元测试 |
| P1-3 | 应用到 `media/attachments.ts`（containment + UTF-8 安全读取）、`workspace/git-worktree.ts`（containment）、`commands/index.ts`（/cd containment）、`bridge/channel.ts`（默认拒绝 + 过期事件）、`core/logger.ts`（增强脱敏） | 单元测试 |
| P1-4 | `DSH_LARK_ACCESS_DEFAULT_DENY`：无白名单时默认拒绝（可选，默认兼容 onboarding） | 测试 |

### 8.5 P1：三档可变卡片 + thinking 展示（借鉴 dsh-lark-bridge V2 + Roy-oss1）

| # | 动作 | 验收 |
| --- | --- | --- |
| P1-5 | `src/card/density.ts`：`compact / standard / detailed` 三档 | 测试 |
| P1-6 | `run-renderer.ts` 升级三档渲染；`run-state.ts` 增加 `usage` | 渲染测试 |
| P1-7 | thinking 流式展示（reasoning-delta → 思考中 → 折叠内容），SDK 路径天然 typewriter | 渲染测试 |
| P1-8 | `/density <compact\|standard\|detailed>` 命令 + profile 偏好 | 命令测试 |

### 8.6 P2：测试密度提升（借鉴 Roy-oss1）

- 新增模块全部配套单元测试（sdk-translate / sdk-adapter / sdk-runtime / acp-adapter / approval-card / question-card / approvals / security / density）。
- 目标：核心模块测试/源码比 ≥ 1:1；`pnpm test` 全绿（现状：137 用例 + 3 门控真实 runtime E2E，2026-08-14）。

### 8.7 P2：License 决策项

- 报告建议 AGPL → MIT 重议。**License 属于所有者法律决策**：本计划不擅自变更 LICENSE，仅在
  README / roadmap / PLAN 中记录决策状态；`homepage` 已配置，无需新增。

## 9. P5 后台服务化 · Background service delivery

| # | 动作 | 验收 |
| --- | --- | --- |
| P5-1 | `src/service/`：`ServiceManager` + 平台控制器（systemd / launchd / 计划任务 / 便携 supervisor） | 单元测试覆盖 |
| P5-2 | CLI 重构：`start` = 安装并启动后台服务；新增 `status` / `restart` / `stop`；隐藏 `run` / `supervise` | `pnpm typecheck` + 程序注册测试 |
| P5-3 | 开机自启：systemd `WantedBy=default.target`、launchd `RunAtLoad`、计划任务 AtLogOn、XDG autostart | 各平台配置生成测试 |
| P5-4 | 崩溃自愈：systemd `Restart=always`、launchd `KeepAlive`、计划任务 RestartCount、supervisor 重启循环 | 真实 systemd 端到端验证 ✅ |
| P5-5 | 环境快照：`DSH_LARK_*` / `DEEPSEEK_API_KEY` / `PATH` 写入 `service.env`（0600） | env-snapshot 测试 |
| P5-6 | 后台日志：`profiles/<profile>/logs/bot.log` | 端到端验证日志落盘 ✅ |
| P5-7 | 文档：README / QUICK_START / MANUAL / API / ARCHITECTURE / SECURITY 同步 | 文档审查 |
