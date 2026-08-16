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
| P5 | 后台服务化（开机自启 + 自动重启） | ⛔ 0.7.0 移除（唯一路径收敛为 dsh bundle 内嵌运行，守护由 dsh 宿主负责） |
| P6 | 模型 / provider / 凭据管理（飞书命令） | ✅ 完成（0.5.0） |
| P7 | 兼容矩阵与自动化（单一事实来源 / 上游雷达 / 真实探测） | ✅ 完成（0.5.1） |
| P8 | 会话 / 任务归档（保留窗口 + 文件 / Git 归档） | ✅ 完成（0.6.0） |
| P13 | 唯一安装-部署-使用路径：dsh profile bundle 内嵌运行 | ✅ 完成（0.7.0） |
| P14 | 安全网守护（issue #6）：独立于 dsh 进程的飞书救援通道 + 仅核心安全模式自愈 | ✅ 完成（0.8.0） |
| P15 | 安全模式实时可见性：SDK 流式引擎优先 + headless 活动卡回退、超时 / 停止 / 忙碌回执、正常模式排队回执与卡住提示 | ✅ 完成（0.10.0） |

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
- [x] dsh profile bundle（`dsh.bundle.patch` + `./plugin` / `./invariant` 导出 + `dsh plugin add` 实测）
- [x] 空闲超时看门狗（持续无活动事件才终止，活跃任务不被误杀）
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
6. ⛔ 后台服务化：0.7.0 移除——唯一路径收敛为 dsh profile bundle，桥接引擎在 dsh 进程内运行，守护由 dsh 宿主负责
7. ✅ 模型 / provider / 凭据管理（0.5.0）：`/model` `/providers` `/provider` `/key`，读写 dsh 官方配置
8. ✅ 兼容矩阵与自动化（0.5.1）：`dsh-compat.ts` 单一事实来源 + 上游雷达 + CI 真实探测 + 升级手册
9. ✅ scope 内并行 run 与异步任务队列（0.6.0）
10. ✅ 多角色 Agent（0.6.0）：`/role save|set|clear|list|show|remove`
11. ✅ 出站 @ 提及与跨会话通知（0.6.0）：`/notify` + `lark_notify` 工具 + 回环回调服务
12. ✅ dsh profile bundle（0.6.0）：`dsh plugin --profile <name> add dsh-lark-bot` 实测通过
13. ⏳ 定时任务 / workflow 编排（等待上游能力接入）
14. ⏳ 稳定发布下一版本
    - ✅ 0.6.0：P8 归档 / P9 并行 / P10 角色 / P11 出站通知 / P12 dsh bundle
15. ✅ 安全网守护（issue #6）：`src/guardian/` 独立进程 + 心跳 + 仅核心安全模式 +
    `/safemode` 控制信号 + `guardian install|uninstall|status|run`；`setup` 默认安装守护
    （`--no-guardian` 可跳过）

## 9. P14 安全网守护 · 验收标准（issue #6）

- [x] 独立存活：守护为与 dsh / Cordis 无耦合的最小进程，系统级常驻（systemd user unit /
      LaunchAgent / Windows 启动项），不导入任何 dsh 代码。
- [x] 静默守护：dsh 正常运行时（心跳新鲜或有 `--profile <name>` 进程）不连接飞书、不抢占通道。
- [x] 接收飞书控制信号：曾观察到 dsh 在线后，dsh 下线（心跳过期 + 无进程）时守护接管同一 bot
      的飞书长连接，接收 `/safemode` 系列命令；仅管理员可触发。
- [x] 仅核心重启：`/safemode` 创建 `~/.dsh/profiles/<profile>-safe`（仅 `dsh-base` +
      `dsh-headless`，无第三方插件），并以 `--dump-config` 探测通过后进入安全模式。
- [x] 受限对话自愈：安全模式下普通消息经 `dsh --profile <safe> "<prompt>"` 与 dsh 核心逐条
      对话（历史上下文拼接），支持定位 / 修复 / 禁用损坏插件；`/safemode plugins` 列出插件。
- [x] 可退出、可回退：`/safemode exit` 以 detached 方式重启完整 profile 并交还飞书通道；
      全程不删除用户已有会话 / 工作区数据（恢复后原数据仍在）。
- [x] 无需命令行：安装后全流程（接管 → 安全模式 → 自愈 → 退出恢复）只在飞书会话内完成。

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

1. **dsh profile bundle 即产品形态**（0.7.0 定稿）：`dsh.bundle.patch` →
   `cordis.patch.yml`，`dsh-lark-bot/plugin` 在 dsh 进程内运行完整桥接引擎
   （`startBridgeEngine`），`lark_notify` 作为标准工具行装载；CLI 只保留
   `setup`（唯一安装命令）/ `doctor` / `upgrade`（一键彻底升级，issue #10）/ 隐藏 `run`。不再存在「独立后台服务 vs dsh 插件」
   双路径。`AgentAdapter` 抽象保留，agent 后端可换。
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
| P0-3 | `src/adapters/dsh/sdk-runtime.ts`：解析 / 确保 `dsh-lark-sdk` SDK runtime profile（bundle `dsh-base` + `dsh-sdk-jsonrpc-server` overlay） | 本地真实握手通过 ✅ |
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
- 目标：核心模块测试/源码比 ≥ 1:1；`pnpm test` 全绿（现状：218 用例，含 3 门控真实 runtime
  E2E，2026-08-16）。

### 8.7 P2：License 决策项

- 报告建议 AGPL → MIT 重议。**License 属于所有者法律决策**：本计划不擅自变更 LICENSE，仅在
  README / roadmap / PLAN 中记录决策状态；`homepage` 已配置，无需新增。

## 9. P5 后台服务化（0.7.0 已移除）· Background service (removed)

0.7.0 按最终需求「一行命令 + 一个扫码 + dsh 标准插件加载」收敛唯一路径：删除独立后台服务层
（`src/service/`、`start/status/restart/stop/supervise`），桥接引擎改为 dsh profile bundle
插件在 dsh 进程内运行，常驻 / 守护 / 重启由 dsh 宿主负责。历史 P5 验收项（systemd /
launchd / 计划任务 / supervisor / 环境快照）全部随该层移除。
