---
title: 快速开始
description: 3 步把 DeepSeek Harness 接入飞书 / Lark，扫码即用。
---

# 快速开始

3 步把 DeepSeek Harness 接入飞书 / Lark，扫码即用。

## 前置要求

- Node.js ≥ 22
- 已安装 DeepSeek Harness（`dsh`）并配置 `DEEPSEEK_API_KEY`
- 飞书 / Lark 手机 App（用于扫码绑定）

## 第 1 步：安装桥接插件

```bash
npx dsh-lark-bot@latest setup --profile dsh-lark
```

`setup` 会自动处理 pnpm 构建、注册为 dsh profile，并（默认）安装安全网守护。

## 第 2 步：启动并扫码绑定

```bash
dsh --profile dsh-lark
```

终端打印二维码，用飞书 / Lark App 扫码创建或选择 PersonalAgent 应用并绑定。

::: tip 卡片回调
交互卡片的按钮（计划门禁 / 审批 / 问答）需在飞书开放平台启用 `card.action.trigger` 回调并重新发布应用。
:::

## 第 3 步：开始使用

- **私聊**：直接发消息，bot 会响应。
- **群聊 / 话题**：默认需要 `@bot` 才会触发。
- 发送 `/help` 查看权威命令清单。

## 网络要求

不需要公网 IP、域名、服务器或内网穿透。飞书通道使用 WebSocket 长连接（出站），本机在 NAT 后面也能用，代码始终只在本机运行。

## 接下来

- 把通知转发到 Telegram / 企业微信：见 **[通知转发到其他 IM](/guide/notification-sinks)**。
- 常用命令：见 **[命令速览](/guide/commands)**。
- 环境变量与 profile：见 **[配置](/guide/configuration)**。
