---
title: 核心功能
description: dsh-lark-bot 的功能最全组合，全部可在飞书内使用。
---

# 核心功能

dsh-lark-bot 的功能最全组合，全部可在飞书内使用。

## 安全网守护

dsh 采用「一切皆插件」架构，单个第三方插件报错即可让整个 profile boot 失败。dsh-lark-bot 额外提供**独立于 dsh 进程的最小安全网守护**：dsh 崩溃或无法启动时，守护接管飞书通道，你只需发 `/safemode` 进入仅核心安全模式，定位并修复问题后 `/safemode exit` 恢复完整 profile。

## 多角色 Agent

用 `/role` 切换或指派 PM / 开发 / 文档等角色，每个角色有持久化人设、模型偏好与规则并绑定到群。一个机器人，一整个团队。

## 多机器人实例与可信交接

每实例拥有独立 bridge profile、dsh profile、DSH_HOME、PersonalAgent 身份与凭据。同群只接受已登记 peer 的真实 `@` 交接，并以共享计数上限阻止无限互聊；真人新消息会重置计数。

## 并行多任务与会话隔离

同一群里可同时跑多个任务，各自会话隔离。每会话自动创建隔离的 git worktree 项目工作区；`/concurrency` 调整并行数（默认 2）。

## 崩溃后任务对账

消息先持久落盘再入队，重启恢复排队项；遗留 `running` 在出站通道就绪后安全转为 `interrupted`。用 `/jobs` 查看 checkpoint 并显式重试，避免重复外部副作用。

## 会话归档与保留

`/archive`、`/retention` 管理旧任务与自动保留策略，会话列表不会越积越多；`/archive send <id> [scope|chatId]` 可转发归档到指定会话。

## 跨会话通知 + @人

Agent 在 A 群跑完任务，可主动发消息到 B 群 / 私聊并 `@` 你（出站契约支持 `mentions`）。

## 通知转发到其他 IM（纯通知）

把完成 / 失败 / 审批与突发故障通知**单向**转发到 Telegram、企业微信等常用 IM。详见 [通知转发到其他 IM](/guide/notification-sinks)。

## dsh Web 可视化设置

在官方 Settings → Plugins 页面查看和修改应用、workspace、模型、并行数与提醒；密钥只写不回显，并内置诊断快捷入口。

## 对话内模型 / Provider / 密钥管理

`/model`、`/providers`、`/key` 直接在聊天里查看、切换供应商、热更新密钥；一张 `/config` 卡片完成模型 / Provider / 凭据管理。

## 执行模式

`/mode`（或 `/effort`）用双语卡片按会话选择**快速 / 平衡 / 深度**，简单问答更快、复杂重构更谨慎；下一轮生效且不打断当前任务。

## 关键任务计划门禁

较大或高风险动作前，`lark_request_plan_approval` 先发送完整计划，再由卡片批准执行或带意见继续规划；批准后原任务自动续跑，等待期间暂停超时。

## 飞书内自更新

管理员发送 `/upgrade` 检查 npm 官方包，确认卡后由 Guardian 后台更新、验证并重载；`/new` 仅在有更新时发一条短提醒。

## 会话投影（显式 DSH session 消息投影）

`/session` 浏览 / 显式绑定当前 workspace 的 DSH session，历史 / 实时 / 重连共用按 seq 串行投影管线，确认 nonce 固化 operator、scope、workspace。

::: info 卡片国际化
bot 卡片按每位读者语言显示中文 / English（Per-viewer）；纯文本与 toasts 使用中英并列，不保存或推断个人语言。
:::
