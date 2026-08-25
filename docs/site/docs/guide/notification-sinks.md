---
title: 通知转发到其他 IM（纯通知）
description: 把完成 / 失败 / 审批与突发故障通知，单向转发到 Telegram / 企业微信等常用 IM。
---

# 通知转发到其他 IM（纯通知）

把完成 / 失败 / 审批与突发故障通知，**单向**转发到 Telegram / 企业微信等常用 IM。飞书仍为唯一完整交互平台。

## 这是什么

有些用户不习惯使用飞书，日常更多用微信 / QQ / WhatsApp / Telegram 等自己的 IM。本项目**不改变**「飞书是唯一一等交互平台」的定位——这些用户不会在这些 IM 上指挥 agent，也不想把项目变成多平台 bot 框架；他们需要的只是：任务完成 / 失败 / 等待审批，或 agent 崩溃 / 突发状态时，能接到一条**纯通知提醒**。

- **转发事件与飞书内一致**：任务完成、执行失败、等待审批，以及「突发 / 故障」类信息（安全网守护心跳异常、渠道断开重连、异常退出等）。
- **每个渠道只做推送、不做接收**：不在这些 IM 上建立完整交互机器人（无命令、卡片、问答、会话管理、文件上传）。
- **飞书仍是唯一完整交互平台**；其他 IM 只是通知接收端（notification sink）。

## 支持的平台

首期落地两个「官方、无状态、推送型」渠道（均为一条 HTTPS 出站 POST，几乎零成本接入）：

| 类型 | 接口 | destination / secret |
| --- | --- | --- |
| `telegram` | 官方 Bot API `POST /bot\<token\>/sendMessage` | destination = 目标 chat_id / @handle；secret = Bot token |
| `wecom` | 企业微信 群机器人 webhook `POST …/webhook/send?key=\<key\>` | destination = webhook key（与 secret 相同） |

## 配置渠道

只有管理员可管理出站通知渠道（`/channels` 命令）。凭据写入 `<profile>/notification-channels.json`（0600），只被 bridge 读取，命令回显与 `/status` 一律只显示打码值。

```bash
# telegram：destination 是目标 chat_id/@handle，secret 是 Bot token
/channels add telegram Ops --id tg-main --destination @my_ops_chat --secret 123456:ABCdef...

# wecom：destination 是群机器人 webhook key（与 secret 相同，作为唯一凭据）
/channels add wecom Ops --id wecom-main --destination 1234-abcd-5678 --secret 1234-abcd-5678
```

- `/channels list` — 查看已配置渠道（不显示凭据）。
- `/channels show <id>` — 查看单个渠道（打码显示目标 / 密钥）。
- `/channels enable <id>` / `/channels disable <id>` — 启用或停用。
- `/channels remove <id>` — 删除。

::: tip 安全提供凭据
你也可以直接在 `<profile>/notification-channels.json` 中维护渠道（建议由管理员安全提供凭据，避免在群聊中明文输入）；只要文件保持 0600 且不进日志 / 诊断包即可。
:::

## 让某个 scope 使用这些渠道

在 `/notifications on` 里用 `sinks=` 列出要一并转发的渠道 id（可为多个，用逗号分隔）；事件默认全选，也可用 `events=` 精确指定（含 `urgent`）。

```bash
# 当前 scope：完成/失败/审批 提醒，转发到 tg-main 与 wecom-main，@ 自己，审批等待 10 分钟提醒
/notifications on current events=completed,failed,approval mentions=self sinks=tg-main,wecom-main remind=10

# 也接收突发/故障级飞书提醒（urgent 事件）
/notifications on current events=completed,failed,approval,urgent sinks=tg-main,wecom-main
```

`/notifications show` 查看当前配置；`/notifications off` 关闭；`/notifications default` 恢复 Web 默认值。

## 突发 / 故障通知

除了完成 / 失败 / 审批，本项目新增 `urgent` 事件。像「渠道重连、心跳异常、异常退出」这类突发 / 故障，会**不管 scope 是否 opt-in** 都广播到**全部已启用渠道**（安全网守护 / 重连 / 心跳异常的天然来源），保证你在任何 IM 上第一时间知道出事了。scope 显式开启 `urgent` 事件时，也会在飞书收到提醒。

## 安全与边界

- **凭据不回显**：只存于 0600 文件，从不出现在日志、卡片、`/channels`、`/status` 或诊断包。
- **纯通知**：这些渠道**不做任何入站**——不实现命令、卡片 action、问答、审批或文件上传。
- **未配置时行为不变**：不配置任何额外渠道、或偏好未列出 `sinks` 时，行为与现状完全一致。
- **飞书默认一等**：飞书通知逻辑保持默认路径；其他 IM 只是同一通知事件的**额外投递目标**。
- 回环回调 token 机制（`lark_notify`）不因新增渠道而弱化。

## 查看状态

`/status` 状态卡会显示「出站渠道」一行，列出当前已启用的渠道 id（不含凭据）。

## 故障排查

- 收不到通知：先 `/channels list` 确认渠道已 `enable`；再用 `/notifications show` 确认 scope 的 `sinks=` 与该渠道 id 一致。
- 渠道发送失败只记结构化日志（`sink:telegram` / `sink:wecom`），不会阻塞其他渠道，也不会污染飞书终态。
- 单渠道 HTTP 有 10 秒超时；超时 / 非 2xx / 非 0 errcode 视为失败，但不会抛错中断。
