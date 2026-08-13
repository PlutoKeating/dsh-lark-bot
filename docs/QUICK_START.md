# 快速开始 · Quick Start

> 本文描述 dsh-lark-bot 面向最终用户的安装与首次使用流程，是 P1 的验收基线。

## 1. 前置条件

- Node.js ≥ 22.19
- 已安装 DeepSeek Harness（`dsh`）并配置 `DEEPSEEK_API_KEY`
- 一个飞书 / Lark 账号

## 2. 安装

```bash
npm install -g dsh-lark-bot
# 或开发阶段：
git clone git@github.com:PlutoKeating/dsh-lark-bot.git
cd dsh-lark-bot
pnpm install
pnpm build
pnpm start
```

## 3. 首次启动

```bash
dsh-lark-bot start
```

1. 终端显示二维码。
2. 使用飞书 App 扫码。
3. 选择或创建 PersonalAgent 应用。
4. 绑定成功后，bot 发送欢迎卡片到私聊。
5. 直接发送消息即可开始使用；群聊中需要 `@bot`。

## 4. 常用命令

| 命令 | 作用 |
| --- | --- |
| `/new` | 开始新会话 |
| `/cd <path>` | 切换工作目录并重置会话 |
| `/ws list` | 查看命名工作空间 |
| `/ws save <name>` | 保存当前工作空间 |
| `/ws use <name>` | 切换到命名工作空间 |
| `/resume` | 恢复兼容的历史会话 |
| `/status` | 查看当前状态 |
| `/stop` | 终止当前任务 |
| `/help` | 查看命令帮助 |

## 5. 本地状态

- 配置文件：`~/.dsh-lark/config.json`
- 会话状态：`~/.dsh-lark/profiles/<profile>/sessions.json`
- 工作空间：`~/.dsh-lark/profiles/<profile>/workspaces.json`
- 日志：`~/.dsh-lark/profiles/<profile>/logs/`

可通过 `DSH_LARK_HOME` 修改状态根目录。
