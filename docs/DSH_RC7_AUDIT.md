# DeepSeek Harness 0.1.0-rc.7 兼容审计

审计日期：2026-08-19。对应仓库 issue #51。

## 结论

本项目已将 dsh harness、SDK client/server 与 ACP 托管 runtime 精确对齐到
`0.1.0-rc.7`。重新生成的 lockfile 中不存在 `@deepseek-ai/dsh-*@0.1.0-rc.6`，
临时 DSH_HOME 中的官方 rc.7 SDK 与 ACP runtime 均完成真实 initialize 握手；SDK 还通过
本地 OpenAI-compatible fixture 完成任务、`lark_notify` / `lark_ask_user` /
`lark_request_plan_approval` 回调、计划前 `bash` 强制拒绝 → 计划批准 → 官方 `approval/request`
一次性批准 → 真实执行顺序、拒绝一次性审批后 agent 继续替代通知路径，以及带第一轮
历史哨兵的同一 session 续接。

`lark_notify` / `lark_ask_user` / `lark_request_plan_approval` 向宿主 `ctx.tools` 注册原始 JSON Schema；
`dsh-lark-bot/approval` 以 structural listener 接入官方 `approval/request` waterfall，并以宿主
`tools/pre-execute` 强制确保 rc.7 未主动询问的高风险工具也必须逐次确认。
`ToolDefinition`，本包不再直接依赖或运行时导入 `@deepseek-ai/dsh-tools`。这避免插件副本
与宿主工具运行时各持有一份模块级 Symbol。根 lockfile 仍会因 SDK client 的 peer 图包含
一份 rc.7 `dsh-tools`；它属于 SDK client 进程依赖图，不会被两个工具插件 import。

## 证据分类

### 官方事实

- 官方 release：<https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.0-rc.7>
- rc.6 基线到 rc.7 的 106 个提交：
  <https://github.com/deepseek-ai/deepseek-harness/compare/fb82698709c39f1860b0ab0ed147e1fa30c1d5d0...99f6f02fecdb7dff40c3fbc9470f5907c29f74ca>
- ACP rc.7 可持久化并转发 PNG/JPEG/WebP/GIF 图片；initialize 通过
  `promptCapabilities.image` 声明当前模型路由是否接受图片。
- max-token 结束不再必然终止 session；SDK/ACP 调用方必须按协议终态而不是错误文本猜测。
- DeepSeek reasoning effort 新增 `low`；插件可注册 settings card。它们分别是 #35 与 #36
  的上游复用入口，本次兼容升级不抢先实现两个产品需求。

### 社区复现

- npm `latest` / `next` 不同步：
  <https://github.com/deepseek-ai/deepseek-harness/discussions/2763>
- 两份物理 `dsh-tools` 可令 scheduler Symbol 不一致：
  <https://github.com/deepseek-ai/deepseek-harness/discussions/3033>、
  <https://github.com/deepseek-ai/deepseek-harness/discussions/2660>
- rc.7 仍可能遇到 `end-seed` 后 seq gap：
  <https://github.com/deepseek-ai/deepseek-harness/discussions/3198>
- 第三方未知 session event 的恢复注册面仍有限：
  <https://github.com/deepseek-ai/deepseek-harness/discussions/3191>

### 本项目验证与推断

- `pnpm-lock.yaml` 曾在只升级 SDK client 后保留整条 rc.6 peer 图；从无旧 lock 的解析结果
  重建后才得到全 rc.7。`scripts/check-dsh-upstream.mjs` 现会拒绝 rc.6 core lock 条目。
- `isSdkProfileReady()` / `isAcpProfileReady()` 现在读取实际安装包 manifest 并核对精确版本；
  旧 rc.6 profile 会进入既有 install/repair 流程，不再被误判为 ready。
- ACP 入站图片改为 base64 原生 image block，并在发送前检查 runtime capability；不支持或
  无法识别格式时返回可见错误。ACP 出站图片因当前飞书 channel 契约尚无二进制发送能力，
  会产生明确文本降级提示，不再静默消失。

## 受影响调用点

| 区域 | 审计结果 |
| :--- | :--- |
| `sdk-adapter.ts` / `sdk-translate.ts` | rc.7 类型检查及现有 initialize、resume、reasoning/text/tool/usage、stop、route-rebind 回归通过；无协议代码改动 |
| `acp-adapter.ts` | initialize/审批/终止回归通过；新增 capability-gated 原生图片 prompt 与出站图片显式降级 |
| `sdk-runtime.ts` / `acp-runtime.ts` | profile ready 改为核验实际 rc.7 manifest，旧版本自动重装 |
| `notify/tool.ts` / `notify/ask-tool.ts` / `notify/approval-answerer.ts` | 工具使用宿主 raw JSON Schema；审批 answerer 不直接 import dsh approval 包，以 structural event seam 回调 bridge |
| `dsh-config.ts` | rc.7 settings 存储 schema 无需改动；继续使用官方 namespace 与原子 patch 协议 |
| session heal/archive | 未新增会话事件；保留非破坏性 archive/heal，未把上游 #3191/#3198 误标为已修复 |
| Guardian / headless / web | 单元/集成回归覆盖启动、接管、退出与 adapter 契约；本次未改变三者协议 |

## 自动与人工验证边界

已自动完成：typecheck、全量单测、构建、发布包检查、依赖图/版本漂移检查，以及在临时
DSH_HOME 安装官方 dsh/base rc.7 后的 SDK server 与 ACP initialize 握手。探针使用本地
OpenAI-compatible HTTP fixture 驱动真实 SDK 协议循环，验证 `lark_notify`、
`lark_ask_user` / `lark_request_plan_approval` 工具回调、未批准 `bash` 的 pre-execute 拒绝、计划批准后的
官方 one-shot approval 允许后的真实执行、拒绝后继续替代工具路径，
以及同一 `compat-session` 的续接；续接响应必须观察到第一轮工具调用、
工具结果与最终回答哨兵，不会仅凭第二轮 prompt 通过。该探针不需要外部模型密钥，也不会
产生收费请求。

当前环境没有 `DEEPSEEK_API_KEY`，因此没有声称完成真实收费模型请求。探针中的工具目标是
本地回调 fixture，并非真实飞书 API；它验证协议和插件装载，不验证飞书权限或网络。Windows
PTY、飞书真实图片、headless/web 实机任务也仍属于发布前人工矩阵；它们的命令和判定见
`docs/COMPATIBILITY.md`。上游 #3191/#3198 是已记录风险，不能由本项目通过删除 session
数据来“修复”。
