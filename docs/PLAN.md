# 开发计划 · Development Plan

> 当前主线执行计划与验收标准。状态随开发进度持续更新。

## 1. 阶段总览

| 阶段 | 目标 | 状态 |
| --- | --- | --- |
| P0 | 仓库、文档、CI、脚手架 | ✅ 完成 |
| P1 | 飞书 bot + dsh 单会话往返 | 🚧 进行中 |
| P2 | 项目工作区管理 | 🚧 进行中 |
| P3 | 审批、调度、沙箱 | 🚧 进行中 |
| P4 | npm / GitHub Packages 发布 | ✅ 完成 |

## 2. P1 验收标准

- [x] 首次扫码创建 PersonalAgent 应用
- [x] 私聊消息进入 dsh headless
- [x] 返回流式卡片
- [x] `final_text` 正确渲染
- [x] 会话记忆最近 40 条
- [x] 图片 / 文本文件附件处理
- [x] `/new` `/cd` `/ws` `/status` `/resume` `/stop` `/timeout` `/help`
- [ ] 真实飞书账号连续两轮 E2E 验收

## 3. P2 验收标准

- [x] `/cd` 与 `/ws` 工作目录切换
- [x] git worktree 隔离
- [x] 项目级 `AGENTS.md` 注入
- [x] 命名工作区最近使用索引
- [x] 工作空间导航卡片
- [x] `SessionStore.fork` 复制历史
- [ ] dsh 原生 session fork / resume / replay

## 4. P3 验收标准

- [x] 用户 / 群聊访问白名单
- [x] `/invite user|admin|group|list|remove`
- [x] 单 scope 运行锁与 `/stop`
- [x] 墙钟超时看门狗
- [ ] 卡片审批
- [ ] 异步任务队列
- [ ] 沙箱调度与 workflow 编排

## 5. P4 验收标准

- [x] npm 双包发布
- [x] GitHub Packages scoped 双包发布
- [x] GitHub Release 自动创建
- [x] 全局安装 smoke test
- [x] 完整用户手册

## 6. 当前执行顺序

1. 完成 P1 真实飞书 E2E
2. 接入 dsh ACP / SDK 后补齐 P2 真正 fork/resume
3. 基于 ACP 实现 P3 卡片审批
4. 补充异步任务队列与调度
5. 稳定发布下一版本
