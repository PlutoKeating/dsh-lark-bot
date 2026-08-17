---
状态: DRAFT · 未授权不发送
渠道: hikariming/dshfind issue 或站内联系
---

# 标题

`[举报] 假冒仓库 tarraencompassing61/dsh-lark-bot 条目请下架或标记为非官方`

# 正文

## 背景

dshfind 依据 GitHub `dsh-plugin` topic 自动收录仓库。假冒仓库
`tarraencompassing61/dsh-lark-bot` 复制了官方仓库的 topic（与全部代码），因此在插件超市中
生成了详情页：https://dshfind.com/zh/plugins/tarraencompassing61/dsh-lark-bot

## 为什么该条目应下架或标记为“非官方 / 假冒”

1. **非 fork 重新上传**：`fork: false`，但 114 个 commit 中 113 个作者为官方维护者
   PlutoKeating（GitHub contributors API：PlutoKeating 113 / tarraencompassing61 1）——
   克隆后重推的“去 fork 化”副本，伪装成独立原创项目；
2. **与官方 v0.7.0 快照相比仅改 4 个文件**：删除全部 CI（含上游雷达），README 重写为
   “下载 Windows exe 双击运行”的 SEO 诱饵；实际 Releases 为 0，所有下载链接 404；
3. **Issues 被关闭**，访客无法纠错；唯一马甲提交借用了上游 commit 标题作伪装；
4. 该条目与官方条目并列出现在搜索中，分流官方流量，并存在被误解为官方渠道、
   进而被用于投毒分发的前置风险；
5. 由于假冒仓库 package.json 的包名仍是官方名 `dsh-lark-bot`，dshfind“按包信息推导”的安装命令
   实际会安装官方 npm 包——该条目没有独立存在的价值，只会造成混淆。

## 请求

- 将 `tarraencompassing61/dsh-lark-bot` 条目移出超市；或
- 在条目上标记“⚠️ 非官方 / 假冒来源”并附官方仓库链接：
  https://github.com/PlutoKeating/dsh-lark-bot

## 证据

https://github.com/PlutoKeating/dsh-lark-bot/blob/staging/docs/security/2026-08-17-impostor-repo-evidence/README.md

---

English summary: The impostor repository tarraencompassing61/dsh-lark-bot (non-fork re-upload
of PlutoKeating/dsh-lark-bot; 113/114 commits authored by PlutoKeating; CI deleted; Issues
disabled; 0 releases; SEO-bait README offering Windows exe downloads) has been auto-listed
on dshfind because it copied the `dsh-plugin` topic. Request: delist the entry or mark it
"unofficial / impostor" with a link to the official repository. Evidence:
https://github.com/PlutoKeating/dsh-lark-bot/blob/staging/docs/security/2026-08-17-impostor-repo-evidence/README.md
