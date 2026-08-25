---
title: 安全与权限
description: 访问白名单、工具权限、密钥处理与官方渠道 / 假冒警示。
---

# 安全与权限

访问白名单、工具权限、密钥处理与官方渠道 / 假冒警示。

## 官方渠道声明

::: danger 仅认准官方渠道
唯一官方仓库 [github.com/PlutoKeating/dsh-lark-bot](https://github.com/PlutoKeating/dsh-lark-bot)；唯一官方 npm 包 `dsh-lark-bot` / `dsh-feishu-bot`（维护者 **plutokeating**）。本项目**从不提供 .exe 或“下载即运行”的安装包**，凡以项目名义分发 exe 的页面 / 仓库皆为假冒 / 恶意来源。安装唯一命令：`npx dsh-lark-bot@latest setup --profile dsh-lark`。
:::

## 访问白名单

`DSH_LARK_ACCESS_DEFAULT_DENY=1` 会在未配置 allowlist 时拒绝 DM 流量（fail closed）；管理员用 `/invite user|admin|group <id>` 管理白名单。群聊 / 话题默认只处理 `@` 消息。

## 工具权限与审批

每个 scope 的 `/permission` 策略（如 `ask|allow|deny`）统一执行；默认 `ask` 时低风险自省静默放行，高风险弹「允许执行一次 / 拒绝」卡。写入成功后才回执，失败回滚。

## 密钥与凭据

- dsh 凭据（provider / 模型）与飞书 app-secret 走现有安全收集流程（owner-only 表单），原始值不经过 prompt / session / jobs / archive / logger / diagnostics。
- 出站通知渠道（Telegram / WeCom）凭据存于 `<profile>/notification-channels.json`（0600），**从不回显**，不进入日志 / 诊断包。
- 本地 callback（`lark_notify` 等）走 127.0.0.1 + 每启动随机 token，不暴露公网。

## 计划门禁

较大或高风险动作先在批准前出完整计划；`deny` 优先于计划门禁，`allow` 不替代关键任务计划确认。

## 最小权限与安全网

安全网守护独立于 dsh 进程，只在「观察过 dsh 在线 且 心跳过期 / 无 dsh 进程」时接管飞书长连接（同 app 单长连接约束，dsh 在线时守护必须静默）。
