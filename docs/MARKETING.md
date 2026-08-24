# 推广与搜索可见度手册 · Marketing Playbook

> 本文档服务于 dsh-lark-bot 的全网宣传矩阵建设：诊断结论、关键词与渠道矩阵、可直接发布的稿件、
> 平台执行步骤与效果跟踪。维护人：项目所有者；创建：2026-08-17。

---

## 1. 现状诊断（2026-08-17 多平台实测）

### 1.1 我们有什么（硬数据）

| 指标 | 数值 | 同类对比 |
| --- | --- | --- |
| GitHub 仓库 | `PlutoKeating/dsh-lark-bot`（2026-08-13 创建） | 飞书桥接细分头部（20 star，与竞品差距在一天内） |
| npm 下载（月） | `dsh-lark-bot` 3,640 + `dsh-feishu-bot` 3,614 | **同类第一**；harness-lark 1,480、dsh-lark-link 343、dsh-im-hub 231 |
| 功能组合 | 九项能力组合（Guardian / 多角色 / 多机器人交接 / 并行 / 持久任务对账 / 归档 / 跨会话通知 / 对话内模型密钥 / 计划门禁） | 同类最全，且为唯一「dsh 崩溃后飞书仍叫得应」方案 |
| 目录收录 | dshfind ✅、dshbase ✅、awesome-dsh-plugins ✅、omdsh-dev ✅ | 缺失：awesome-dsh-plugin 大榜（7.2k+ star）——已提交 PR 待合并 |
| GitHub 搜索 | 关键词「deepseek harness 飞书」GitHub 内第 1 位 | GitHub 内可见度 OK |

### 1.2 我们缺什么（问题清单）

1. **中文媒体零曝光**：Bing / 百度 / B 站 / 知乎 / 小红书 / 抖音均搜不到本项目。
2. **竞品用内容占位**：Bing「deepseek harness 飞书」前 10 条是 dsh-lark-link 的 CSDN+B 站、
   harness-lark 的 Docker 教程、zhbdream 的 CSDN 文、cc-connect 的技术站文章、ai-bot.cn/aihub.cn 目录。
   这些竞品 star 数很多低于我们（如 zhbdream 仅 1 star），但**内容先发=搜索可见**。
3. **品牌词被劫持**：Bing 搜「dsh-lark-bot」，第一页是 dshbase（我们的目录页，尚可）、zhihu、
   dsh-launcher、dsh.do、dsh-plugin.shop（无内容的空壳站）等；百度完全无收录。
4. **缺官网/落地页**：仓库 `homepage` 为空，无 GitHub Pages、无 sitemap、无结构化数据 → 搜索引擎与 AI 助手都难以抓取与引用。
5. **缺中国站点镜像**：竞品 zhbdream 在 Gitee 同步发布；我们没有 Gitee 镜像（百度对 Gitee 收录好于 GitHub）。
6. **缺英文媒体**：dsh 生态英文教程（orcarouter.ai、dev.to 等）均未提及我们。

### 1.3 核心结论

> 产品力没有转化为搜索可见度。原因不是「不够好」，而是：**没有内容、没有落地页、没有结构化数据、
> 没有目录覆盖、没有镜像站点**。这是纯执行问题，一个月内可系统性解决。

---

## 2. 关键词矩阵（按优先级）

| 关键词（中文） | 用户意图 | 当前排名 | 目标载体 |
| --- | --- | --- | --- |
| deepseek harness 连接飞书 | 教程/方案 | Bing 无；百度无 | 落地页 + CSDN/掘金/知乎长文 + B 站 |
| deepseek harness 飞书 | 教程/方案 | Bing 无（竞品占据） | 同上 |
| deepseek harness 扫码飞书 | 安装教程 | 无 | 落地页 FAQ + 小红书 |
| deepseek 飞书机器人 | 泛需求（含非 dsh） | 无 | 知乎回答 + 公众号 |
| dsh 飞书 | 品牌/方案 | Bing 无 | 全渠道统一用词 |
| dsh-lark-bot | 品牌词 | Bing 第一页为目录页，仓库未上榜 | 内容矩阵反哺 |
| deepseek harness 插件推荐 | 盘点 | 无（V2EX 盘点文已出现） | 投稿「插件盘点」类文章/回答 |
| 手机远程用 deepseek harness | 场景 | 无 | 小红书/抖音场景化内容 |

英文（供搜索引擎与 AI 助手收录）：

| 关键词 | 目标载体 |
| --- | --- |
| deepseek harness feishu / lark | 英文 README、dev.to/medium 投稿、Hacker News 评论 |
| dsh lark bridge / dsh feishu plugin | npm 描述、GitHub topics |

---

## 3. 渠道矩阵与优先级

| 渠道 | 优先级 | 动作 | 谁来做 |
| --- | --- | --- | --- |
| GitHub（仓库 + 收录） | P0 | 元数据/README/落地页优化；awesome-dsh-plugin PR | 已完成（见 §5） |
| 落地页（GitHub Pages） | P0 | 启用 Pages + 提交 sitemap | 需要你在 GitHub 设置开启（§6.1） |
| CSDN / 掘金 | P0 | 发布主稿（§7.1），多账号转载 | 稿子已备好，复制粘贴 |
| B 站 | P0 | 实机演示视频（§7.2） | 需你录屏，脚本已备好 |
| 知乎 | P1 | 文章 + 回答引流（§7.3） | 稿子已备好 |
| 小红书 | P1 | 3 条图文笔记（§7.4） | 图文已备好，需截图 |
| 抖音 / 视频号 | P2 | 30 秒口播（§7.5） | 需出镜/录屏 |
| 公众号 | P2 | 长文转载 + 私域 | 主稿改标题 |
| 目录与收录 | P0 | ai-bot.cn / aihub.cn / Gitee（§6.2–6.4） | 部分我提交，部分需账号 |
| 英文媒体 | P2 | dev.to / medium / HN（§7.6） | 稿子可翻译后发 |

---

## 4. 统一对外口径（全渠道一致）

- 一句话：**把 DeepSeek Harness 装进飞书，扫码 30 秒，手机指挥本机 coding agent。**
- 安装命令：`npx dsh-lark-bot@latest setup --profile dsh-lark`
- 九个差异化能力：安全网守护 / 多角色 Agent / 多机器人可信交接 / 并行多任务 / 持久任务对账 / 会话归档 / 跨会话通知 / 对话内模型密钥管理 / 计划门禁
- 卖点一句话：**「唯一 dsh 崩溃后飞书里还叫得应」的桥接方案**
- 官方渠道：GitHub `PlutoKeating/dsh-lark-bot`；npm `dsh-lark-bot` / `dsh-feishu-bot`
- 反假冒声明：从不提供 exe；发现 `tarraencompassing61/dsh-lark-bot` 等仿冒仓库已留存证（docs/security/）

---

## 5. 仓库侧已执行优化（本次提交）

1. GitHub 仓库描述加入「扫码即用 / scan-to-connect」关键词；topics 增加 feishu-bot、lark-bot、qrcode；homepage 指向 dshfind 详情页。
2. `package.json`：npm 描述改中英双语，keywords 增加「飞书 / 飞书机器人 / 扫码 / deepseek harness 飞书」等中文词。
3. `README.md`：徽章行增加 dshbase；「社区收录情况」增加 awesome-dsh-plugin（PR 待合并）与 dshbase 两行。
4. 新增落地页 `docs/index.html`：中英双语、OG/Twitter 卡片、SoftwareApplication + FAQPage 结构化数据、FAQ 覆盖长尾问题。
5. 产品内 bot 固定 UI 也完成双语：共享 Card JSON 2.0 按读者客户端语言显示中文 / English，Markdown/toast 降级中英并列；不翻译 agent 生成内容。
5. 新增 `docs/sitemap.xml`、`docs/robots.txt`、`docs/llms.txt`（供搜索引擎与 AI 助手直接读取的项目摘要）。
6. 新增本文档 `docs/MARKETING.md`。
7. 已向 awesome-dsh-plugin 提交收录 PR（见 §6.2 状态）。
8. IndexNow 即时收录已配置：密钥文件 `docs/2a7bb299d031c8950416360bfa35cd94.txt`（**勿删**，删除后
   IndexNow 提交会失败）；提交接口 `https://api.indexnow.org/indexnow`，host 为
   `dsh-lark-bot.arr2018.dpdns.org`，新 URL 上线后可 POST 提交（Bing / Yandex / Naver 均支持）。
9. **README 可发现性重构（issue #43，2026-08-17）**：用户向内容前置为「场景痛点 → 能做什么 → 30 秒上手 →
   完整使用方式 → FAQ」五段，自动化 / AI 合规章节（Keywords / 兼容性 / 架构 / 社区收录 / 安全声明等）整体
   移后并完整保留；安全警告压缩为一行醒目提示 + 文末完整声明，官方渠道与防假冒信息不删减。
10. **GitHub Topics 扩充至 18 个**：新增 `im-bridge` / `ai-agent` / `workspace` / `self-healing`
    （对应 bridge / dsh 后端 / 工作区管理 / Guardian），README「关键词」章节同步为同一集合。
11. **npm 元数据刷新（v0.15.1）**：keywords 补齐 `feishu-plugin` / `lark-integration` / `remote-coding`
    等场景词（总量 20 个），描述保持中英双语；v0.15.1 发布后 registry 元数据与仓库一致。
12. **Release notes 支持 Highlights 区块**：`scripts/release-notes.mjs` 新增 `--highlights`，
    `release-highlights/<tag>.md` 文件在发版时拼接到 release body 顶部（功能亮点 + 安装 / 升级命令）。
13. **落地页 FAQPage 同步**：补充「多项目 / 多人协作」典型用例问答（与 README FAQ 保持一致）。
14. **社区收录刷新恢复提交（安全窗口结束，2026-08-17）**：awesome-dsh-plugins 数据刷新 PR
    （v0.8.0 → v0.15.1）；dshfind #6 跟进评论（v0.10.1 → v0.15.1 一次刷新）；awesome-dsh-plugin
    PR #1408 跟进评论（v0.15.1 数据）；omdsh-dev Discussion #11 更新说明备妥待人工粘贴
    （org 级 discussion 无 REST/GraphQL 写接口）。状态与链接见 README「社区收录情况」。
15. **README 单语化（中文优先，v0.15.2）**：为提升搜索可见度，README.md 删除全部英文
    标题/描述/正文，仅保留中文（技术术语、命令、代码与 GitHub Topics 关键词除外）；新增
    `README_EN.md` 为最终中文版的完整英文翻译，并在中文 README 顶部提供「英文版」入口；
    npm 包自 v0.15.3 起同时携带两份 README（发布管线 `PUBLISH_FILES` 同步）。

---

## 6. 需要你操作的事项

### 6.1 落地页双活部署（已完成）

- **Cloudflare Pages（主站，正式域名）**：`https://dsh-lark-bot.arr2018.dpdns.org/`
  - Pages 项目 `dsh-lark-bot`（subdomain `dsh-lark-bot.pages.dev`），部署目录为 `docs/` 中
    `index.html`、`llms.txt`、`robots.txt`、`sitemap.xml` 四个资产；
  - 自定义域名已绑定：zone `arr2018.dpdns.org` 下 CNAME `dsh-lark-bot → dsh-lark-bot.pages.dev`
    （proxied）；
  - **自动部署（已启用）**：GitHub Actions 工作流 [`.github/workflows/cf-pages.yml`](../../.github/workflows/cf-pages.yml)
    在 push 到 main 时自动把 `docs/` 中四个 web 资产部署到 Pages（需仓库 Secret
    `CLOUDFLARE_API_TOKEN`，作用域仅限 Pages Write）。push 后无需手动操作；
  - 手动兜底：`wrangler pages deploy <目录> --project-name=dsh-lark-bot`。
- **GitHub Pages（备用/回源）**：`https://plutokeating.github.io/dsh-lark-bot/`
  - 已启用，Source = main 分支 `/docs` 目录，push 后自动重建。
- **去重策略**：两份内容共用同一份源文件，canonical 统一指向正式域名
  `https://dsh-lark-bot.arr2018.dpdns.org/`，搜索引擎只收录正式域名。
- **sitemap 提交清单**：见 §6.1.1。

### 6.1.1 搜索引擎 sitemap 提交清单

目标域名：`https://dsh-lark-bot.arr2018.dpdns.org/`，sitemap：
`https://dsh-lark-bot.arr2018.dpdns.org/sitemap.xml`。

**Bing Webmaster Tools**

- [ ] 打开 bing.com/webmasters，用微软账号登录（支持 GitHub/Google 账号登录）。
- [ ] 「添加网站」→ 输入 `dsh-lark-bot.arr2018.dpdns.org`；若 GSC 已加过可「从 Google Search Console 导入」。
- [ ] 验证方式选「DNS 验证」：复制给出的 TXT 记录 → Cloudflare 控制台 → `arr2018.dpdns.org` → DNS →
      添加 TXT 记录 → 等 1–5 分钟 → 回到 Bing 点验证（验证成功后该 TXT 可删除）。
- [ ] 「Sitemaps」→ 提交 `https://dsh-lark-bot.arr2018.dpdns.org/sitemap.xml`。
- [ ] 「URL 检查」提交首页，确认状态可抓取、无 blocked。

**Google Search Console**

- [ ] 打开 search.google.com/search-console → 「添加资源」→ 选「网域」→ 输入 `dsh-lark-bot.arr2018.dpdns.org`。
- [ ] 复制 DNS 验证 TXT 记录 → Cloudflare 控制台添加 TXT → 点「验证」（验证后可删除 TXT）。
- [ ] 「站点地图」→ 提交 `https://dsh-lark-bot.arr2018.dpdns.org/sitemap.xml`。
- [ ] 「网址检查」→ 输入首页 → 「请求编入索引」。
- [ ] 3–7 天后检查「网页索引编制」报告：确认落地页已收录、canonical 正确指向正式域名、无重复页。

**百度搜索资源平台（尽力而为）**

- [ ] 打开 ziyuan.baidu.com，注册/登录后「添加站点」→ `dsh-lark-bot.arr2018.dpdns.org`。
- [ ] 同样用 DNS TXT 验证（Cloudflare 控制台添加）。
- [ ] 提交 sitemap；百度对 dpdns.org/pages.dev 收录优先级低，主要收录来源仍是 Gitee 镜像与
      CSDN/知乎内容，若迟迟不收录可改用「普通收录-手动提交」提交首页 URL。

**通用注意**

- 所有验证 TXT 记录验证通过后即可从 Cloudflare 删除，不影响站点。
- canonical 已统一指向正式域名，双站（Cloudflare + GitHub Pages）不会被重复收录。
- 提交后如 7 天仍未收录：重新提交 sitemap、确认 robots.txt 没有误拦（当前允许全部抓取）、
  并在各工具「抓取测试」里确认 200。
- [x] IndexNow 已配置并提交首页（2026-08-17，HTTP 202 接受）；Bing 一般数小时内安排抓取。

### 6.2 awesome-dsh-plugin 收录（P0，已提交）

- 已按规范新增 `data/plugins/PlutoKeating__dsh-lark-bot.yml`（category: notify）并重新生成 README，
  PR 已创建（编号见 README「社区收录情况」更新后回填）。合并后请把 README 中 `#PLACEHOLDER`
  替换为真实 PR 编号并更新状态。

### 6.3 ai-bot.cn / aihub.cn 目录提交（P1）

- ai-bot.cn（AI 工具目录，Bing 权重高）：首页有「提交收录」入口，按表单提交仓库 URL + 简介 + 截图；
- aihub.cn：同理；
- 需要账号注册，用主邮箱注册后提交即可（推广用途，建议用项目专用邮箱）。

### 6.4 Gitee 镜像（P1，百度收录关键）

1. 注册 gitee.com 账号，创建同名仓库 `dsh-lark-bot`；
2. 把 GitHub 仓库添加为 remote 并推送：`git remote add gitee https://gitee.com/<你的账号>/dsh-lark-bot.git && git push gitee main`；
3. 在 Gitee 仓库「管理 → 开源软件」勾选开源，README 自动渲染（百度对 Gitee 收录明显好于 GitHub）；
4. 竞品 zhbdream 已这么做，我们是追赶方。

### 6.5 平台账号准备（P1）

- CSDN / 掘金 / 知乎 / B 站 / 小红书 / 抖音 / 公众号：用项目身份或主理人身份注册；
- 头像统一用仓库 logo，简介统一写「DeepSeek Harness × 飞书 开源桥接插件作者」。

---

## 7. 可直接发布的稿件

### 7.1 主稿（CSDN / 掘金 / 知乎 / 公众号通用）

标题（A/B 任选）：
- A：把 DeepSeek Harness 装进飞书，扫码 30 秒，手机指挥本机 Coding Agent
- B：DeepSeek Harness 连接飞书全教程：扫码即用、崩溃也能自救，九项能力一次讲清

正文：

> DeepSeek Harness（dsh）8 月 13 日开源后，「一切皆插件」引爆了生态。在手机飞书里指挥本机
> coding agent 是最高频的需求之一，但市面上的桥接方案大多是「串行单聊 + 崩溃就失联」。
> 这篇文章介绍 dsh-lark-bot——把 dsh 装进飞书 / Lark 的开源桥接插件，扫码即用。
>
> **为什么需要它？**
> 官方 Web UI 要求你坐在电脑前；桥接方案则让你在路上用手机发一句话，家里的电脑就开始干活。
> dsh-lark-bot 用飞书 WebSocket 长连接，不需要公网 IP、域名、服务器或内网穿透；代码始终只在本机运行。
>
> **安装（唯一路径）**
> ```bash
> npx dsh-lark-bot@latest setup --profile dsh-lark
> dsh --profile dsh-lark
> ```
> 首次启动终端打印二维码，飞书 App 扫码绑定 PersonalAgent 应用，私聊直接发消息，群聊/话题里 @bot。
>
> **九个差异化能力**
> 1. 安全网守护：dsh 进程崩溃后机器人仍在飞书回复，/safemode 进入仅核心安全模式自愈——唯一
>    「出故障时用户不会失联」的方案；
> 2. 多角色 Agent：/role 切换 PM / 开发 / 文档角色，每个角色有人设、模型偏好与规则；
> 3. 多机器人可信交接：独立机器人在同群以真实 @ 交接，连续回合有硬上限；
> 4. 并行多任务：同群同时跑多个任务，会话隔离不排队；
> 5. 持久任务对账：消息先落盘，崩溃后用 /jobs 查看 checkpoint 并显式重试；
> 6. 会话归档：/archive、/retention 自动保留策略，会话列表不烂掉；
> 7. 跨会话主动通知：A 群跑完，主动发到 B 群并 @ 你；
> 8. 对话内管理模型和密钥：/model、/providers、/key 全程在聊天里完成；
> 9. 计划门禁：完整计划先发出，批准后才执行关键动作。
>
> **安全性**
> 数据只在本机、飞书与 DeepSeek 之间流转；密钥不写入仓库；访问白名单 /invite 可管理；
> 官方从不提供 exe 安装包，凡遇到「下载双击运行」的页面均为假冒来源，请认准
> GitHub `PlutoKeating/dsh-lark-bot` 与 npm `dsh-lark-bot`。
>
> **项目信息**
> GitHub：github.com/PlutoKeating/dsh-lark-bot
> npm：dsh-lark-bot / dsh-feishu-bot
> 收录：dshfind、dshbase、awesome-dsh-plugin 等。
> 欢迎 Star、提 Issue、参与社区；项目基于 AGPL-3.0 开源。

发布要点：
- CSDN：勾选「原创」「转载需授权」，标签选 DeepSeek / 飞书 / AI Agent / 开源；
- 掘金：标签选 人工智能 / 前端 / 开源；
- 知乎：文章 + 同步回答「DeepSeek Harness 怎么接入飞书？」类问题（§7.3）；
- 公众号：标题改「我用一个周末把 DeepSeek Harness 装进了飞书」，首图用仓库卡片。

### 7.2 B 站视频脚本（8–10 分钟实机演示）

标题：DeepSeek Harness 装进飞书，扫码 30 秒，手机指挥本机 Coding Agent｜dsh-lark-bot 实机演示

分镜：
1. **开场（0:00–0:30）**：手机飞书界面，「帮我跑一下测试」→ 电脑终端开始执行 → 飞书收流式卡片。
   口播：DeepSeek Harness 8 月 13 日开源，今天带你把本机 coding agent 装进飞书。
2. **为什么（0:30–1:20）**：官方 Web UI 要坐电脑前；出门想改代码怎么办。对比其他方案：串行、崩溃失联。
3. **安装演示（1:20–3:00）**：终端执行两条命令，打印二维码，飞书扫码绑定，第一条消息发出去。
4. **九个能力逐个演示（3:00–7:30）**：
   - 并行任务：同群连发两个任务同时跑；
   - 多角色：/role set pm，让 agent 换角色；
   - 多机器人：开发 bot 完成后真实 @ 复审 bot 交接；
   - 持久对账：模拟重启后用 /jobs 查看中断 checkpoint 并重试；
   - 跨会话通知：A 群让 agent 完成后去 B 群 @ 你；
   - 归档：/archive 后 /archive list；
   - 对话内换模型 / 密钥：/model use、/key set；
   - 计划门禁：发完整计划，卡片批准后继续；
   - 杀手锏：kill dsh 进程 → 飞书发 /safemode → 机器人照常回复 → /safemode exit 恢复。
5. **安全提示（7:30–8:20）**：认准官方仓库；不提供 exe；仿冒仓库警示。
6. **结尾（8:20–9:00）**：Star/安装命令/评论区提问。

发布要点：简介放安装命令与官方链接；分区选「科技→软件应用」；标签 DeepSeek/飞书/AI Agent；
字幕开启；标题与简介覆盖「deepseek harness 飞书」「扫码」关键词。

### 7.3 知乎回答模板（P1）

问题：「DeepSeek Harness 怎么接入飞书？」「有哪些好用的 DeepSeek Harness 插件？」

回答结构：
> 飞书桥接我推荐 dsh-lark-bot（github.com/PlutoKeating/dsh-lark-bot），是目前功能最全的飞书方案，
> 扫码即用，安装只要两条命令……（展开九个能力，重点讲安全网守护）…… 特别提醒：官方从不提供 exe，
> 别下任何「下载双击运行」的版本。

要点：回答要带实际演示截图；知乎对 GitHub 外链放行，但避免堆链接；优先回答高浏览问题。

### 7.4 小红书笔记（3 条，P1）

**笔记 1（教程类）**：标题「DeepSeek Harness 装进飞书，扫码 30 秒，手机指挥电脑干活」
正文：安装命令 + 扫码步骤 + 效果截图（飞书里跑任务的流式卡片）。话题：#DeepSeek #飞书 #AI编程 #效率工具。

**笔记 2（场景类）**：标题「通勤路上改 bug：手机发一句，家里电脑自己跑」
正文：场景化故事 + 并行任务/主动通知演示。话题：#程序员日常 #远程办公 #AI Agent。

**笔记 3（避坑类）**：标题「警惕 DeepSeek Harness 仿冒插件：官方只有一条安装命令」
正文：假 exe 警示 + 官方渠道清单。话题：#DeepSeek避坑 #开源软件。

要点：首图用实机截图（飞书对话流式卡），小红书搜索权重吃标题关键词；发布频率 1–2 条/周。

### 7.5 抖音 / 视频号口播稿（30 秒）

> 你知道吗，DeepSeek Harness 现在已经可以装进飞书了。一条命令，扫码 30 秒，你在手机飞书里发消息，
> 家里的电脑就开始干活。跑测试、改代码、看结果，全程流式卡片。而且就算 dsh 崩了，飞书里照样能把它救活。
> 唯一官方仓库 PlutoKeating/dsh-lark-bot，注意，官方从来不提供 exe，别下错了。

### 7.6 英文媒体（P2）

- 将 §7.1 主稿翻译为英文，发布到 dev.to / medium / Hacker Noon，标题：
  “Connect DeepSeek Harness to Feishu / Lark in 30 Seconds (Scan-to-Connect)”。
- HN 评论区参与 dsh 相关讨论时，自然提及项目与 npm 包名。
- 给 orcarouter.ai 等 dsh 教程站发邮件建议收录（联系页一般有邮箱）。

### 7.7 runoob.com（菜鸟教程）投稿（P1）

**稿件已备好**：`docs/runoob-deepseek-harness-feishu-tutorial.md`（母版）与
`docs/runoob-deepseek-harness-feishu-tutorial.html`（可直接粘贴版）。

**两个概念先分清（重要）**

- **文章投稿（/tougao）**：runoob 官方的内容投稿入口，用于提交原创技术文章，审核通过后由
  runoob 决定是否发表（编入栏目 / 分享展示）。这是**发布教程页面的唯一官方通道**。
- **点我分享笔记 / 写笔记（文章底部表单，addnote.php）**：这是**评论性质的笔记功能**——表单
  `id="commentform"`，隐藏字段为 `comment_post_ID` / `comment_parent`，字段即昵称/邮箱/引用地址，
  只针对当前文章内容做扩展，提交后挂在原文章下、经管理员审核后展示给其他读者。它**不能**用来发布
  新的教程页面，只能满足 runoob「分享 2 份本站教程笔记」的邀请码条件（且必须是**本篇文章**的内容
  扩展，不能贴与当前文章无关的完整教程）。

**投稿步骤**

1. 首选官方通道 https://www.runoob.com/tougao（表单字段：标题 ≤100 字、昵称 ≤20 字、邮箱、
   引用地址 + 富文本编辑器，正文 ≥100 字）：
   - 笔记标题（≤100 字）：`DeepSeek Harness 连接飞书（dsh-lark-bot 桥接插件）`
   - 昵称（≤20 字）：建议 `dsh-lark-bot` 或你的常用昵称
   - E-Mail：必填，用于接收审核结果
   - 引用地址：填 `https://www.runoob.com/deepseek-harness/`（关联 DeepSeek Harness 栏目，
     提高被编入该栏目的概率）
   - 正文：把 `runoob-deepseek-harness-feishu-tutorial.html` 内容整体粘贴进编辑器，
     检查标题层级、代码块与表格是否保留后提交；
   - **2026-08-17 实测该页故障**：Simditor 编辑器 CDN 404、提交地址为空，点击提交无反应。
2. 故障期间改用**邮件投稿**：把稿件（`.md` + `.html` 附件）、昵称、邮箱、引用地址
   `https://www.runoob.com/deepseek-harness/` 发到 `admin@runoob.com`（抄送
   `429240967@qq.com`），模板见 `docs/runoob-submission-emails.md`；
3. 投稿通过后，发邮件到 **429240967@qq.com** 申请内测邀请码（runoob 用户中心注册方式，
   注册后可管理自己的笔记与投稿；官方联系邮箱另有 admin@runoob.com）。

**备选路径（满足其一即可申请邀请码）**

- 提交 3 个有效问题反馈并被采纳；
- 在任意 runoob 教程文章底部「点我分享笔记」分享 2 份**该文章的**扩展笔记（简单描述 + 代码实例）——
  注意这是文章评论式笔记，不是发布教程页面。

**注意**：runoob 审核的是「优质原创」；投稿不等于自动生成栏目页面，是否编入
DeepSeek Harness 栏目由 runoob 编辑决定。引用地址填栏目首页可显著提高归位概率。

---

## 8. 面向搜索引擎与 AI 助手的清单

- [x] llms.txt 提供项目摘要（docs/llms.txt）
- [x] 落地页 FAQPage + SoftwareApplication 结构化数据
- [x] README 中英双语、问题式小标题
- [ ] 在 Perplexity / 豆包 / Kimi / 文心等 AI 搜索里主动提问并截图记录（用「deepseek harness 飞书」类问题），
      持续迭代落地页 FAQ 以命中 AI 引用
- [ ] 让项目出现在更多「插件盘点」类内容中（V2EX、LINUX DO、awesome 榜单、bilibili 盘点视频评论区）
- [ ] 鼓励用户写使用体验（Issue/讨论区）→ 形成带「真实口碑」的长尾内容源

---

## 9. 效果跟踪（周报模板）

| 指标 | 基线（2026-08-17） | 目标（30 天） | 本周 |
| --- | --- | --- | --- |
| GitHub star | 20 | 100+ | |
| npm 月下载 | ~7,250（双包） | 15,000+ | |
| Bing「deepseek harness 飞书」前 10 出现我们 | 无 | 有 | |
| 百度收录 | 无 | 有（落地页/Gitee） | |
| 落地页访问（GSC/Bing 数据） | 未启用 | 可统计 | |
| 已发布内容数 | 0 | ≥8（CSDN/掘金/知乎/B站/小红书×3/抖音） | |
| awesome-dsh-plugin | PR 待合并 | 已收录 | |
| Gitee 镜像 | 无 | 已上线 | |

> 每周五复盘一次，更新本表与 README「社区收录情况」。
