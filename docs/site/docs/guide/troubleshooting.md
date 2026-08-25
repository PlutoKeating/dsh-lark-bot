---
title: 排障与 FAQ
description: 诊断命令、常用问题与快速定位。
---

# 排障与 FAQ

诊断命令、常用问题与快速定位。

## 诊断与状态

- `/status` — 可刷新状态卡，查看工作区、模型、run、token 用量、任务账本与「出站渠道」。
- `/doctor`（管理员）— 生成脱敏诊断包并作为文件发送，内容排除消息正文 / transcript / 凭据。
- `dsh-lark-bot doctor` / `service status` / `guardian status` — 终端侧区分「引擎进程活着」与「飞书通道可用」。

## 常见问题

### DeepSeek Harness 怎么接入飞书？

见 [快速开始](/guide/quickstart)：一条命令安装 + 扫码绑定，全程不需要公网服务器、域名或内网穿透。

### 需要公网 IP 或服务器吗？

不需要。飞书通道使用 WebSocket 长连接（出站），NAT 后面也能用，代码始终只在本机运行，飞书只传输消息。

### dsh 崩溃了怎么办？

默认安装的安全网守护会接管飞书通道，发 `/safemode` 进入仅核心安全模式自愈，`/safemode exit` 恢复完整 profile。任务账本会在出站通道就绪后安全标为 `interrupted`，用 `/jobs` 对账并显式重试。

### 收不到转发到 Telegram / 企业微信的通知？

先 `/channels list` 确认渠道已 `enable`；再用 `/notifications show` 确认 scope 的 `sinks=` 与渠道 id 一致。渠道发送失败只记结构化日志，不阻塞其他渠道。详见 [通知转发到其他 IM](/guide/notification-sinks)。

### 怎么确认下载的是正版？

只从 github.com/PlutoKeating/dsh-lark-bot 与 npm（`dsh-lark-bot` / `dsh-feishu-bot`）获取；凡提供 exe 的渠道均为假冒。

### 为什么说功能最全？

十二项组合为一：安全网守护、多角色、多机器人可信交接、并行任务、崩溃任务对账、会话归档、跨会话通知、通知转发到其他 IM、dsh Web 可视化设置、对话内模型 / 密钥管理、执行模式、计划门禁与飞书内自更新。

## 更多资料

- 完整文档：仓库 `docs/`（README / MANUAL / FEATURES / API / ARCHITECTURE）。
- 用户手册：`docs/MANUAL.md`。
- 架构决策：`docs/ARCHITECTURE.md`（含关键决策 18：出站通知渠道）。
