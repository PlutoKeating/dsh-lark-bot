---
title: 配置
description: 环境变量、profile、dsh Web 可视化设置与出站通知渠道。
---

# 配置

环境变量、profile、dsh Web 可视化设置与出站通知渠道。

## 环境变量

运行时读取 `DSH_LARK_*` 变量并与 `~/.dsh-lark/config.json` 合并。完整模板见仓库 `.env.example`。常用项：

```bash
# 应用凭据（优先首次扫码绑定，以下为自动化部署的覆盖项）
# DSH_LARK_APP_ID=
# DSH_LARK_APP_SECRET=
DSH_LARK_TENANT=feishu

# agent 后端模式：sdk（默认）| acp | headless | web
DSH_LARK_ADAPTER=sdk

# provider/model 路由
# DSH_LARK_PROVIDER=provider-id
# DSH_LARK_MODEL=model-id

# 默认主动提醒：off | completed(完成+失败) | all(+审批)
DSH_LARK_NOTIFICATION_DEFAULT=off

# 安全网守护心跳间隔（ms）
DSH_LARK_HEARTBEAT_MS=5000
```

::: info 出站通知渠道无需环境变量
Telegram / 企业微信等出站通知渠道**不需要环境变量**——在聊天里用管理员 `/channels` 配置，scope 用 `/notifications … sinks=<id>` 开启。凭据存于 0600 文件，永不回显。
:::

## Profile 与安装

```bash
# 安装并注册为 dsh profile
npx dsh-lark-bot@latest setup --profile dsh-lark

# 启动并按 profile 管理
dsh --profile dsh-lark
dsh-lark-bot service install|start|status|logs|restart|stop|uninstall --profile dsh-lark
```

## dsh Web 可视化设置

在官方 Settings → Plugins 页面（dsh Web）用浏览器卡片集中呈现应用、workspace、模型、并行数、adapter 与提醒默认值，并逐项标注「重连 / 下一任务生效」；诊断区直接检查脱敏 settings 快照。`/status` 与 `/doctor` 保留为运行态降级路径。密钥永不进入 Host → Web 响应。

## Scope 级覆盖

- `/concurrency`、`/notifications`、`/mode`、`/density`、`/replies` 等 scope 覆盖优先于 Web 默认。
- 模型优先级：每会话 `/model use` > 角色 > profile > dsh 默认 > 环境。
- 通知默认：无 override 时继承 profile 的 `notificationDefault`；`/notifications default` 删除 override 恢复继承。

## 目录与状态文件

默认根目录 `~/.dsh-lark/`，按 profile 存放：`sessions.json`、`jobs.json`、`scopes.json`、`roles.json`、`permission-policies.json`、`notification-preferences.json`、`notification-channels.json`（0600）、`archives/`、`logs/` 等。
