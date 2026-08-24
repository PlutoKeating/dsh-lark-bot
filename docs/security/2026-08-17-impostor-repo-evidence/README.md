# 假冒仓库证据包 · Impostor Repository Evidence

> 调查时间：2026-08-17 · 方法：GitHub API 全量快照 + 完整 commit 历史克隆比对 + 树级 diff + npm registry 检查
> 本目录是**假冒仓库 `tarraencompassing61/dsh-lark-bot`** 与 npm 仿冒/混淆包的取证存档，供后续举报、法务与社区声明复用。

## 一、结论

`tarraencompassing61/dsh-lark-bot` 被判定为**假冒 / 恶意来源**（软件供应链投毒前置的典型形态）：

- 非 fork 重新上传（`fork: false`），114 个 commit 中 **113 个作者为 PlutoKeating**（`PlutoKeating@outlook.com`），唯一一个马甲提交还借用了上游真实 commit 标题作伪装；
- 删除全部 CI / 发布流水线（含上游雷达 `dsh-upstream.yml`），关闭 Issues（`has_issues: false`），Releases 为 0；
- README 被改写为“下载 Windows exe → 双击运行”的诱导性文案——本项目从始至终以 npm 包 + dsh profile bundle 交付，**从不提供可执行文件**。

## 二、关键证据（全部为硬数据）

### 2.1 账号画像

| 指标 | 值 |
| --- | --- |
| 用户名 | `tarraencompassing61`（“随机词+随机词+数字”批量注册命名） |
| 注册时间 | 2026-04-14T23:52:16Z |
| 公开仓库 | 1（仅此假冒仓库） |
| followers / following / bio / company | 0 / 0 / null / null |
| commit 邮箱 | `francozoppi61@gmail.com`（一次性 Gmail） |

### 2.2 去 fork 化重传

- 仓库创建于 2026-08-14T19:38:44Z，晚于上游 v0.7.0 发布；
- 完整克隆后 `git rev-list --count HEAD` = **114**；
- `git log --format='%an <%ae>' | sort | uniq -c`：**113 × PlutoKeating，1 × tarraencompassing61**；
- GitHub contributors API 同：PlutoKeating 113 / tarraencompassing61 1；
- 马甲唯一提交 `4d6c01a` 标题为 `docs: add omdsh community submission link to README maintenance section`（与上游 `e4d3422` **完全相同**），实际 diff 却是删除 3 个 workflow + 重写 README——用上游标题掩盖“去 CI + 换门面”的真实动作。

### 2.3 树级 diff（相对上游 v0.7.0 快照 `e4d3422`）

```text
 .github/workflows/ci.yml           |  74 ----
 .github/workflows/dsh-upstream.yml |  28 --
 .github/workflows/release.yml      |  72 ----
 README.md                          | 712 ++++++++------------------------------
 4 files changed, 132 insertions(+), 754 deletions(-)
```

**一行功能代码未改，门面全部替换。** 详细分析见 [`diff-report.md`](diff-report.md)。

### 2.4 README 诱导性文案

- 通篇“Download → Releases → Windows 可执行文件 → 双击运行”；
- 实际 Releases = 0，所有下载链接均为 404（“养排名”阶段）；
- Issues 被关闭，访客无法提问 / 纠错；
- AGPL 许可证文件保留（规避 DMCA / 许可违约渠道，见 §四 法律边界）。

### 2.5 生态平台现状（2026-08-17 实测）

| 平台 | 状态 |
| --- | --- |
| GitHub 站内搜索 “dsh-lark-bot” | 6 个仓库，假冒仓库排第 4（1 star）——已被站内搜索索引 |
| [dshfind](https://dshfind.com/zh/plugins/tarraencompassing61/dsh-lark-bot) | 假冒仓库有详情页（HTTP 200）；其“按包信息推导”安装命令为 `dsh plugin add dsh-lark-bot` → **实际安装官方 npm 包**（分流流量，非恶意分发） |
| awesome-dsh-plugins（AdamPlatin123） | 只收录正版 `[可用]`，未收录假冒仓库 |
| Oh-My-DSH（like-study1） | 只收录正版 |
| dshmarket 等运行时市场 | 按 `dsh-plugin` topic 自动拉取，假冒仓库后续会自动出现（需持续监控） |
| 外部搜索引擎 | 本次检索（Google/Bing 索引）尚未收录假冒仓库 → 官方需在窗口期内抢占关键词 |

### 2.6 npm 侧仿冒/混淆包（新发现）

- `dsh-f`（维护者 `yusi5587`，2026-08-16 起连续发版 `0.11.0` → `0.13.4`）：自称 dsh-lark-bot “独立改造分支”，版本号跟随官方，README 复用官方品牌词且无醒目“非官方”声明。tarball 检查：**无 install/postinstall 投毒脚本**、LICENSE 为 AGPL 文本、代码仅连本地回环回调 → 当前定性为**品牌混淆风险**，由监控脚本持续盯防；
- `dsh-lark` / `dsh-feishu`（维护者 `roy-oss`）：指向 omdsh 官方通道插件 `dsh-lark-channel` 的别名包，与 omdsh-dev/dsh-lark 同源，非假冒；
- 官方包 `dsh-lark-bot` / `dsh-feishu-bot` 归 `plutokeating` 所有，当前 v0.14.0，npm 周下载 3640 / 3614。

### 2.7 竞品生态位（背景信息）

- `omdsh-dev/dsh-lark`（24 stars，dshfind 标“🏛 官方”）与 `heyumeng154-alt/dsh-lark` 为同一作者（Roy-oss1）的发布版/开发版；dshfind 给 omdsh 竞品打“官方”标签而正版条目未获该标记，属于生态位竞争，非假冒。

## 三、附件清单

| 文件 | 说明 |
| --- | --- |
| `api-snapshots/*.json` | GitHub API / npm registry 原始快照（2026-08-17，均已通过 JSON 校验） |
| `api-snapshots/impostor-README.md` | 假冒仓库 README 原文 |
| `dsh-lark-bot-impostor-history-2026-08-17.bundle` | 假冒仓库完整历史 git bundle（`git bundle verify` 可复核） |
| `diff-report.md` | 树级 diff 与伪装提交分析 |

**bundle 完整性校验（SHA-256）**：

```text
8d79e05ab980a295e23aef64a819b5ad62ec660272beada8e4139634da526289  dsh-lark-bot-impostor-history-2026-08-17.bundle
```

## 四、法律边界（AGPL）

- 假冒仓库保留 AGPL 许可证与署名 → 当前**不构成许可证违约**，不适用 DMCA 版权渠道；
- 真正的违约触发点：①移除署名/许可证；②分发二进制却不提供对应源码（违反 AGPL）；③分发恶意软件（违反 GitHub ToS 与各国刑法）；
- 因此策略是**固证 + 监控 + 等其越线一击致命**：本证据包即举报/报案底稿，`scripts/monitor-impostor-repo.mjs` 盯防其 Releases 附件。

## 五、处置约定（官方渠道）

- 官方唯一仓库 / 唯一 npm 包名 / 从不提供 exe，见根 README 官方声明横幅与 [`docs/DOWNLOAD.md`](../../DOWNLOAD.md)；
- 每周运行 `pnpm security:monitor`（脚本 `scripts/monitor-impostor-repo.mjs`）：
  - 假冒仓库 `pushed_at` / releases / stars / README 哈希变化 → 告警；
  - 假冒仓库 Releases 出现**任何附件** → 立即固证并按“分发恶意软件”举报；
  - npm `dsh-f` 发新版、官方包版本漂移、相似包名被抢注 → 告警。
- 对外平台动作（GitHub 举报 / dshfind 申诉 / omdsh 提醒 / 防伪公告）的**草稿**见
  [`drafts/`](drafts/README.md)，**暂缓执行**；发送 / 发布前需维护者逐份显式授权，避免打草惊蛇。
