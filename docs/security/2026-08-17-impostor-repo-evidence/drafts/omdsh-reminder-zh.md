---
状态: 已发布 · https://github.com/omdsh-dev/community/discussions/25
渠道建议: omdsh-dev/community 新 Discussion（[Security] 分类）或公开 issue
身份声明: PlutoKeating，dsh-lark-bot 维护者
---

# 标题

`[Security] 给飞书桥接生态开发者的一点安全提醒：贡献者统计 ≠ 仓库归属（附可复用取证经验）`

# 正文

## 写在前面

我是 **PlutoKeating**，维护着 `dsh-lark-bot`（飞书 / Lark × DeepSeek Harness 桥接插件）。
看到这个生态里越来越多用心做的飞书桥接方案、包括你们正在做的 dsh-lark，是件挺高兴的事。

写这个帖子的初衷很单纯：我们最近在自己项目上撞见了一起值得警惕的“假冒仓库”事件，
想把这个坑、以及我们沉淀下来的一套排查方法分享出来，帮同样在认真维护开源项目的朋友
提前避开。不涉及任何立场，纯粹是经验共享。

## 我们遇到的事

2026-08-17 我们发现仓库 `tarraencompassing61/dsh-lark-bot`：

- 非 fork 重新上传（`fork: false`），114 个 commit 中 **113 个作者是 PlutoKeating**——
  克隆后重推的“去 fork 化”副本，伪装成独立原创项目；
- 与上游 v0.7.0 快照相比仅改 4 个文件：删除全部 CI（含上游雷达）、README 重写为
  “下载 Windows exe 双击运行”的 SEO 诱饵（实际 Releases 为 0）；
- Issues 被关闭，访客无法纠错；唯一马甲提交借用了上游 commit 标题作伪装。

**最危险的一点**：GitHub 贡献者统计会把爬虫同步的 commit 归到原作者头上——自动雷达完全可能
据此把假冒仓库判为“低风险 / 原作者维护”。这正是我们差点踩中的误判。

我们的完整取证过程与证据包（GitHub API 快照、假冒仓库完整历史 git bundle、树级 diff）公开在：
https://github.com/PlutoKeating/dsh-lark-bot/blob/staging/docs/security/2026-08-17-impostor-repo-evidence/README.md

## 对 dsh-lark 两个仓库的核查结论

我按同一套判据核查了 `heyumeng154-alt/dsh-lark` 与 `omdsh-dev/dsh-lark`：

- 两仓库全部 commit 的 author / committer 均为 Roy-oss1（omdsh 版初始 commit 为组织成员 yokai-cheng）；
- `heyumeng154-alt` 被添加为 `omdsh-dev/dsh-lark` 的 collaborator（MemberEvent，2026-08-14）；
- `omdsh-dev/dsh-lark` 的 push 事件全部由 Roy-oss1 本人执行；
- `heyumeng154-alt` 账号有真实的 larksuite/cli PR 贡献史（2026-04 至 2026-08）；
- 两仓库均无伪装提交、无 SEO README、无异常发布资产；npm 侧
  `dsh-lark-channel` / `dsh-lark` / `dsh-feishu` 归属一致。

**结论：这两个仓库是同一作者（Roy-oss1）的“开发版 → 组织发布版”，不是寄生重传。**
这个判断本身也印证了方法论：只看“贡献者 = 原作者”会误判，必须组合看 push 事件 actor、
伪装提交、组织授权（MemberEvent）、账号开发史、topic / 发现性、发布资产形态。

## 两个具体建议（供参考）

1. **`heyumeng154-alt/dsh-lark` 是未归档的开发遗留仓库**（同名、无 topic、无 Issues /
   Releases / CI、无 README 声明）。建议归档它，或在 README 顶部注明
   “开发存档，正式版在 `omdsh-dev/dsh-lark`”，并保持不添加 `dsh-plugin` topic——
   否则一旦作者不再维护或账号失守，它可能成为被加 topic 自动进插件超市、挂假 Releases 的入口
   （这正是我们被攻击的路径）。
2. **`omdsh-dev/dsh-lark` 的 README 缺少官方渠道防伪声明**（“唯一官方仓库 / npm 包、
   从不提供可执行文件”）。建议补一条声明横幅——我们已在 `dsh-lark-bot` README 顶部加了同类声明，
   文本可参考。

祝开发顺利。如有需要，我们的取证脚本（`scripts/monitor-impostor-repo.mjs`）和监控思路
也欢迎参考。

---

> 本文由 **PlutoKeating** 指导与审核，使用 **dsh-lark-bot** 发布。
