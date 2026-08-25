---
layout: home

hero:
  name: dsh-lark-bot
  text: 把 DeepSeek Harness 装进飞书 / Lark
  tagline: 扫码即用，在手机飞书里指挥本机 coding agent。流式卡片、并行任务、多角色 Agent、跨会话主动通知、通知转发到其他 IM 与安全网守护。
  image:
    src: /logo.svg
    alt: dsh-lark-bot
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/quickstart
    - theme: alt
      text: 通知转发到其他 IM
      link: /guide/notification-sinks
    - theme: alt
      text: GitHub
      link: https://github.com/PlutoKeating/dsh-lark-bot

features:
  - icon: 🛡️
    title: 安全网守护
    details: 唯一「dsh 崩溃后飞书仍叫得应」：守护接管飞书通道，/safemode 进入仅核心安全模式自愈。
  - icon: 🧑‍💻
    title: 多角色 Agent
    details: 一个机器人绑定 PM / 开发 / 文档等角色，各有持久化人设、模型偏好与规则。
  - icon: 🤝
    title: 多机器人可信交接
    details: 每实例独立身份、服务、凭据与上下文；同群只接受登记 peer 的真实 @ 交接。
  - icon: ⚡
    title: 并行多任务
    details: 同一群里同时跑多个任务、会话隔离；每会话自动创建独立 git worktree。
  - icon: 📣
    title: 跨会话通知 + @人
    details: 任务完成主动推送到其他群 / 私聊并 @ 你。
  - icon: 📤
    title: 通知转发到其他 IM
    details: 把完成 / 失败 / 审批 / 突发故障通知单向转发到 Telegram、企业微信等（纯通知）。
  - icon: 🎛️
    title: dsh Web 可视化设置
    details: 官方 Settings → Plugins 里查看和修改应用、workspace、模型、并行数与提醒。
  - icon: 📋
    title: 关键任务计划门禁
    details: 先出完整计划，再由卡片批准执行或带意见继续规划，原任务自动续跑。
  - icon: 🧾
    title: 崩溃后任务对账
    details: 消息先持久落盘再入队，重启恢复排队项；/jobs 查看 checkpoint 并显式重试。
  - icon: 🗂️
    title: 会话归档与保留
    details: /archive、/retention 管理旧任务与自动保留策略，会话列表不越积越多。
  - icon: 🎚️
    title: 执行模式
    details: /mode 用双语卡片选择快速 / 平衡 / 深度，下一轮生效且不打断当前任务。
  - icon: 🔑
    title: 对话内模型 / 密钥管理
    details: /model、/providers、/key 直接在聊天里查看、切换供应商、热更新密钥。

---

::: warning 官方渠道声明
唯一官方仓库 [github.com/PlutoKeating/dsh-lark-bot](https://github.com/PlutoKeating/dsh-lark-bot)；唯一官方 npm 包 `dsh-lark-bot` / `dsh-feishu-bot`（维护者 **plutokeating**）。本项目**从不提供 .exe 或“下载即运行”的安装包**，任何以此名义分发的页面 / 仓库均为假冒 / 恶意来源。
:::

## 一键安装

```bash
npx dsh-lark-bot@latest setup --profile dsh-lark
```

然后 `dsh --profile dsh-lark` 启动，用飞书 / Lark App 扫码绑定。全程不需要公网服务器、域名或内网穿透。

## 开始阅读

- **[快速开始](/guide/quickstart)** — 安装、扫码绑定、群聊 @bot
- **[核心功能](/guide/features)** — 十二项能力详解
- **[命令速览](/guide/commands)** — 全部 `/` 命令
- **[通知转发到其他 IM](/guide/notification-sinks)** — Telegram / 企业微信纯通知配置
- **[配置](/guide/configuration)** — 环境变量 / profile / Web 设置
- **[安全与权限](/guide/security)** — 白名单、密钥、假冒警示
- **[排障与 FAQ](/guide/troubleshooting)** — 诊断 / 常见问题
