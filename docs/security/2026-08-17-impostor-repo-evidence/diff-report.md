# 树级 diff 报告 · 假冒仓库 vs 上游 v0.7.0 快照

> 方法：`git clone https://github.com/tarraencompassing61/dsh-lark-bot.git`（完整历史 114 commits）→ 与本仓库上游 commit `e4d3422`（v0.7.0 快照）做树级 diff。

## 1. commit 归属

```text
113  PlutoKeating <PlutoKeating@outlook.com>
  1  tarraencompassing61 <francozoppi61@gmail.com>
```

GitHub contributors API 结果一致：PlutoKeating 113 / tarraencompassing61 1。

## 2. 树级 diff（`git diff --stat e4d3422 <impostor HEAD>`）

```text
 .github/workflows/ci.yml           |  74 ----
 .github/workflows/dsh-upstream.yml |  28 --
 .github/workflows/release.yml      |  72 ----
 README.md                          | 712 ++++++++------------------------------
 4 files changed, 132 insertions(+), 754 deletions(-)
```

## 3. 伪装提交分析

- 马甲唯一提交 `4d6c01a` 的标题与上游 `e4d3422` **完全相同**（`docs: add omdsh community submission link to README maintenance section`）；
- 但其实际 diff 是删除 3 个 workflow + 重写 README——用上游标题掩盖真实动作；
- 意图链：`fork: false` 切断与上游的关联显示 → 删除 `dsh-upstream.yml` 移除自动同步雷达 → 删除 CI/发布流水线 → 换 SEO 诱饵 README。

## 4. README 差异要点

| 项 | 上游（PlutoKeating/dsh-lark-bot） | 假冒仓库 |
| --- | --- | --- |
| 篇幅 | 约 906 行中英双语完整文档 | 约 160 行 |
| 安装形态 | `npx dsh-lark-bot@latest setup`（npm 包 + dsh profile bundle） | “下载 Windows exe → 双击运行” |
| Releases | 30 个版本，npm tarball 资产 | 0（下载链接全部 404） |
| Issues | 开启 | 关闭（`has_issues: false`） |

## 5. 结论

功能代码**零改动**、门面**全部替换**、作者归属**原样保留**——这是去 fork 化的假冒分发前置形态。任何后续在该仓库 Releases 出现的二进制附件都必须视为恶意来源；本报告与 `git bundle` 为举报/报案底稿。
