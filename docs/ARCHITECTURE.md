# 架构 · Architecture

> 本文件描述 dsh-lark-bot 的总体架构与分层设计，仍在演进中。
> This document describes the overall architecture and layering of dsh-lark-bot. Still evolving.

## 分层 · Layering

```
┌──────────────────────────────────────────┐
│  dsh profile · cordis 组合                │
│  · dsh-lark-bot/plugin（桥接引擎，进程内） │
│  · dsh-lark-bot/notify（lark_notify 工具）│
└──────────────────────────────────────────┘
        │  以标准插件方式加载 | loaded as a standard plugin
        ▼
飞书 / Lark（私聊 · 群聊 · 话题；文档评论为规划中）
        │  WebSocket 长连接（出站，免公网服务器 / 域名 / 内网穿透）
        ▼
┌──────────────────────────────────────────┐
│  bridge/   飞书通道接入                    │
│  · 消息事件、流式卡片、卡片交互、媒体下载    │
│  · 出站 @ 提及 + 跨会话通知（lark_notify 工具）│
└──────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────┐
│  session/  会话路由与持久化                │
│  · chat / topic(thread) → scope key        │
│  · 排队合并、scope 内并行 run、中断、访问控制 │
│  · 保留窗口 + 归档（文件 / Git 仓库）        │
└──────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────┐
│  workspace/  项目工作区管理（核心差异化）    │
│  · git worktree / 分支隔离                 │
│  · 项目级规则注入（AGENTS.md）               │
│  · 上下文持久化 + 项目索引                  │
└──────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────┐
│  adapters/  agent 后端适配层               │
│  · dsh-sdk（官方 SDK client，默认）         │
│  · dsh-acp（ACP 审批通道，可选）            │
│  · dsh-headless（legacy fallback）          │
│  · dsh-web（本地 dsh web agent，单写者）    │
└──────────────────────────────────────────┘
        │
        ▼
DeepSeek Harness (dsh) ──▶ DeepSeek V4 Pro / Flash
```

```
┌──────────────────────────────────────────┐
│  guardian/（可选 · 独立于 dsh 的进程）      │
│  · 心跳看门狗（读 bridge 心跳 + ps 观察）  │
│  · dsh 下线后接管飞书通道，接收 /safemode  │
│  · 仅核心安全 profile（SDK 流式优先，      │
│    headless 回退，均无第三方插件）         │
│  · 受限对话自愈 + 退出重启完整 profile      │
└──────────────────────────────────────────┘
```

```
┌──────────────────────────────────────────┐
│  dsh profile（cordis 组合）                │
│  · dsh-lark-bot/plugin  桥接引擎（进程内） │
│  · dsh-lark-bot/notify  lark_notify 工具  │
│  · @deepseek-ai/dsh-base …               │
└──────────────────────────────────────────┘
```

本项目以 **dsh 标准 profile bundle** 交付：`dsh plugin add dsh-lark-bot`（或一行
`dsh-lark-bot setup`）把包装进 profile，dsh 启动时以标准插件方式加载
`dsh-lark-bot/plugin` —— 桥接引擎**在 dsh 进程内**运行（飞书 WebSocket 通道、会话/工作区、
卡片、通知回调），并按需拉起官方 dsh SDK runtime 子进程执行 agent 任务。常驻 / 守护 / 重启
由 dsh 宿主负责，不再有独立后台服务层（唯一进程级例外是默认安装的「安全网守护」，见关键决策 8）。
首次启动无凭据时打印二维码完成一次性绑定。

## 关键决策 · Key Decisions

1. **飞书通道**：采用 `@larksuite/channel`（WebSocket 长连接 + PersonalAgent 应用），并开启 `resolveChatMode` 以区分普通群聊与话题 scope，免公网服务器、免域名、免内网穿透。
2. **agent 后端解耦**：通过 adapter 接口抽象，`dsh` 为默认后端。默认走官方
   `@deepseek-ai/dsh-sdk-client`（`dsh-sdk-jsonrpc-server` runtime，原生 session + 流式事件）；
   `DSH_LARK_ADAPTER=acp` 走官方 `@deepseek-ai/dsh-acp`（审批卡）；`headless` 保留 legacy fallback；
   `DSH_LARK_ADAPTER=web` 走本地 dsh web agent（`session.prompt` + `/api/events.mux`，单写者，根治双写）。
   桥接核心只依赖 `AgentAdapter` / `AgentEvent` 契约，dsh 漂移只影响 `src/adapters/dsh/`。
3. **工作区管理**：会话绑定 git worktree / 分支 + 项目级规则注入 + 上下文持久化，是本项目的核心差异化能力。
4. **模型 / provider / 凭据管理**：`/model` `/providers` `/provider` `/key` 命令直接读写
   dsh 官方配置存储（`~/.dsh/settings.yaml` + `~/.dsh/.credentials.yaml`），与 dsh Web
   Settings→Models 同一协议（`patchNode` 叶子 diff、`<file>.lock` 写锁、原子替换、0600 凭据文件），
   因此不重复造配置管理 API，也不绕过官方热发布；ACP / SDK 协议本身不含配置管理方法，
   模型切换通过每轮请求的 model 参数与 dsh 热发布生效。
5. **多角色 Agent**：`RoleStore`（`<profile>/roles.json`）定义命名角色（persona / 模型 /
   工具指引 / 角色规则）并按 scope 绑定；运行期角色指令作为 prompt 前缀注入，角色模型参与
   模型优先级（每会话 `/model use` > 角色 > profile > dsh 默认 > 环境），因此角色切换无需
   重启 runtime，也能与 scope 内并行 run 共存。
6. **出站通知通道**：bridge 出站契约支持 `mentions` 与跨 chat/thread 发送；`ScopeDirectory`
   持久化 scope → chat/thread 映射；`NotifyServer` 在 127.0.0.1 提供带 token 鉴权的回调，
   SDK / ACP runtime 装配 `lark_notify` 工具（`dsh-lark-bot/notify`），agent 可主动 @ 提及
   并向其他会话推送汇报；本地回环 + 每启动随机 token，不暴露公网。
7. **唯一安装-部署-使用路径**：不做「独立后台服务 vs dsh 插件」双路径。产品形态收敛为
   dsh profile bundle：`dsh-lark-bot setup --profile <name>`（内部自动处理 pnpm 构建策略并
   执行标准 `dsh plugin add`）→ `dsh --profile <name>` → 首次扫码。CLI 仅保留 `setup` /
   `doctor` / `upgrade`（一键彻底升级，issue #10）/ 隐藏 `run`（诊断）以及安全网守护的
   `guardian run|install|uninstall|status`，README 只记录这一条路径。
9. **一键彻底升级（issue #10）**：`dsh-lark-bot upgrade` 从任意旧版本（含 0.7.0 前遗留形态）
   一条命令完成 包本体（`dsh plugin add <name>@<latest>`）→ guardian 幂等重装并重启 →
   runtime profile（dsh-lark-sdk / dsh-lark-acp）own-package 链接修复 → `doctor` 升级后验证；
   运行中实例默认只提示重启命令（不中断会话 / 配置 / 凭据），`--restart` 可选自动重启，
   `--rollback` 按 `~/.dsh-lark/upgrade-state.json` 记录精确回滚。旧版本（无 upgrade 命令）
   通过 `npx dsh-lark-bot@latest upgrade` 引导：npx 拉取最新版执行升级。
8. **安全网守护（issue #6）**：dsh 采用「一切皆插件」架构，任一第三方插件都可能让整个组合
   boot 失败，导致桥接引擎与 dsh 一起下线。因此在插件托管架构之外，额外提供**独立于 dsh
   进程的最小「安全网守护」**：桥接引擎周期写入心跳文件（`<bridge-profile>/guardian/
   heartbeat.json`），守护仅在「曾观察 dsh 在线 且 心跳过期 / 无 dsh 进程」时接管飞书长连接
   （同 app 单长连接约束：dsh 在线时守护必须静默，绝不抢占通道）。`/safemode` 进入仅核心
   安全模式：优先预置 `~/.dsh/profiles/<profile>-safe-sdk`（官方 `dsh-base` +
   `dsh-sdk-jsonrpc-server`，无第三方插件）以获得与正常模式一致的实时流式卡片（思考 / 工具 /
   web search / 打字机文字），SDK runtime 不可用时回退 `~/.dsh/profiles/<profile>-safe`
   （`dsh-base` + `dsh-headless`）并以活动状态卡兜底；单任务空闲超时（默认 10 分钟，
   持续无活动事件才终止，活跃的流式任务不会被误杀）、
   `/safemode stop` 与卡片 ⏹ 按钮可随时终止；`/safemode exit` 重启完整 profile 并交还通道。
   守护以 systemd user unit / LaunchAgent / Windows 启动项注册，进程本身不依赖任何 dsh /
   Cordis 代码。

## 目录映射 · Directory Mapping

| 目录 Dir | 职责 Responsibility |
| :--- | :--- |
| `src/bridge/` | 飞书通道接入（消息、卡片、媒体） |
| `src/onboard/` | 首次扫码创建 / 绑定 PersonalAgent 应用 |
| `src/session/` | 会话路由、上下文记忆、持久化 |
| `src/workspace/` | 项目工作区管理 |
| `src/adapters/` | agent 后端适配器（sdk 默认 / acp 审批 / headless legacy / web 单写者） |
| `src/card/` | 流式卡片状态与渲染 |
| `src/bot/` | 运行注册、消息排队 |
| `src/commands/` | 斜杠命令（/cd /ws /new …） |
| `src/cli/` | CLI 入口：`setup`（唯一安装命令）/ `doctor`（诊断）/ `upgrade`（一键升级）/ 隐藏 `run` |
| `src/upgrade/` | 一键升级（issue #10）：版本探测、升级状态记录、运行状态检测、guardian / profile 重启助手、runtime profile 链接修复 |
| `src/config/` | profile / 配置 / 访问白名单管理 |
| `src/core/` | 结构化日志 |
| `src/media/` | 附件下载与文本注入 |
| `src/notify/` | 进程内通知回调服务与 `lark_notify` 工具插件 |
| `src/platform/` | 跨平台原子写入 |
| `src/guardian/` | 安全网守护（默认随 setup 安装）：心跳、状态持久化、仅核心安全 profile、进程观察、控制信号、接管状态机、系统服务安装 |
