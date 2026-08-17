---
状态: 已发布 · https://github.com/omdsh-dev/community/discussions/26（原目标 Discussion #11 评论不可达，改发新讨论）
渠道: omdsh-dev/community Discussion #11（我方收录讨论）追加评论
---

# 标题

`官方渠道声明与假冒仓库警告（2026-08-17）`

# 正文

## 官方渠道（唯一）

- 官方仓库：https://github.com/PlutoKeating/dsh-lark-bot
- 官方 npm 包：`dsh-lark-bot` / `dsh-feishu-bot`（维护者 `plutokeating`）
- 官方安装：`npx dsh-lark-bot@latest setup --profile dsh-lark`
- **本项目从不提供 Windows / macOS 可执行文件（.exe）**

## 假冒仓库警告

2026-08-17 发现假冒仓库 **`tarraencompassing61/dsh-lark-bot`**：

- 非 fork 重新上传，114 个 commit 中 113 个作者为 PlutoKeating（GitHub contributors API 可查）；
- 删除全部 CI、关闭 Issues、Releases 为 0，README 却是“下载 Windows exe 双击运行”的 SEO 诱饵；
- **任何声称“Download dsh-lark-bot → 双击运行”的页面均为假冒 / 恶意来源，请勿下载或运行。**

取证存档与证据包（含完整 git bundle）：
https://github.com/PlutoKeating/dsh-lark-bot/blob/staging/docs/security/2026-08-17-impostor-repo-evidence/README.md

持续监控：`pnpm security:monitor`（官方仓库脚本，每周运行）。

请认准官方渠道；如在其他页面看到“下载 exe”入口，欢迎指回本公告。

---

> 本文由 **PlutoKeating** 指导与审核，使用 **dsh-lark-bot** 发布。
