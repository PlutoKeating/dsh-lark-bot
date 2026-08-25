---
title: 命令速览
description: 全部 / 命令，按类别分组。
---

# 命令速览

命令帮助、状态与卡片均中英文；`/help` 为全量权威清单。完整说明见仓库 `docs/MANUAL.md`。

## 会话与工作区

| 命令 | 作用 |
| --- | --- |
| `/new` `/reset` | 开始新会话（当前 workspace） |
| `/cd <path>` | 切换到该目录的独立会话 |
| `/ws list\|save\|use\|remove` | 管理命名工作空间 |
| `/session [current\|bind]` | 浏览 / 显式绑定 DSH session |
| `/resume` | 查看当前会话最近上下文 |
| `/newg <群名>` | 自动新建群聊并开新会话 |

## 任务与运行

| 命令 | 作用 |
| --- | --- |
| `/status` | 可刷新状态卡（工作区 / 模型 / run / token / 账本） |
| `/jobs [list\|show\|retry]` | 对账并重试排队 / 运行 / 失败 / 中断任务 |
| `/stop` | 终止当前任务 |
| `/timeout [N\|off\|default]` | 查看或设置空闲超时 |
| `/concurrency [N\|default]` | 查看或设置 scope 并行数 |
| `/mode`（`/effort`） | 选择快速 / 平衡 / 深度执行强度 |
| `/density [compact\|standard\|detailed]` | 卡片密度 |

## 通知与通讯

| 命令 | 作用 |
| --- | --- |
| `/notify <scope\|chatId> <text>` | 跨会话发送通知（管理员） |
| `/notify list` | 查看已注册 scope |
| `/notifications [show\|off\|default\|on …]` | 配置完成 / 失败 / 审批（含 urgent）提醒，支持 `sinks=` 转发到其他 IM |
| `/channels [list\|show\|add\|remove\|enable\|disable …]` | 管理出站通知渠道（管理员，Telegram / wecom 等） |
| `/replies [show\|default\|set …]` | 回复合并、频率与近似去重 |
| `/ask <问题>` | 发送结构化问答卡 |

## 模型 / Provider / 凭据

| 命令 | 作用 |
| --- | --- |
| `/config` | 模型 / Provider / 凭据管理卡片 |
| `/model [use\|default\|add\|remove\|list]` | 查询与管理模型 |
| `/providers` `/provider [add\|update\|remove]` | 查询与管理 provider |
| `/key [list\|set\|remove]` | 管理 dsh 凭据引用 |
| `/secret [status\|set\|remove]` | 安全采集或删除密钥（管理员） |

## 策略 / 隔离 / 角色

| 命令 | 作用 |
| --- | --- |
| `/permission [ask\|allow\|deny] [scope]` | 工具权限策略 |
| `/isolation [group\|topic\|member]` | 群会话隔离（设置需管理员） |
| `/role list\|show\|set\|save\|remove\|clear` | 查看 / 管理角色 |
| `/invite user\|admin\|group <id>` | 管理访问白名单 |
| `/language [show\|set\|reset]` | 默认语言策略 |

## 维护 / 诊断 / 更新

| 命令 | 作用 |
| --- | --- |
| `/archive [note\|send\|list\|clean]` | 管理归档并上传 / 转发 / 清理 |
| `/retention [N\|default]` | 会话保留条数 |
| `/doctor` | 生成脱敏诊断包（管理员） |
| `/version` | 当前版本与最新版本 |
| `/upgrade` | 检查并确认自更新（管理员） |
| `/help` | 查看命令清单 |
