# dsh-lark-bot landing / docs site

基于 **VitePress** 的官方落地页 + 使用文档站，部署到 Cloudflare Pages（项目名 `dsh-lark-bot`），由 `.github/workflows/cf-pages.yml` 在 `main` 分支的 `docs/**` 变更时自动构建并部署。

> 参考 Kimi Code / MiMoCode 官方 docs 站的「Vite 系文档框架 + 侧边栏分目录 + 明暗主题 + 响应式移动端」风格。

## 技术栈

- VitePress（默认主题 + 少量品牌色 / 排版覆盖，见 `.vitepress/theme/custom.css`）
- 内容为 Markdown（MDX 可用），源在 `docs/`
- Vue 3（VitePress 依赖）

## 本地开发

```bash
cd docs/site
pnpm install
pnpm dev          # VitePress dev server
pnpm build        # vitepress build docs → dist/
pnpm preview      # vitepress preview docs
pnpm typecheck    # tsc --noEmit（校验 .vitepress 配置 / 主题）
```

## 目录结构

- `.vitepress/config.mts` — 站点标题、导航、侧边栏（分目录）、本地搜索、明暗主题、`cleanUrls`、输出目录
- `.vitepress/theme/` — `index.ts` + `custom.css`（品牌色、排版、移动端、明暗微调）
- `docs/` — Markdown 页面源：
  - `index.md` 首页（hero + 功能卡片）
  - `guide/quickstart.md` 快速开始
  - `guide/features.md` 核心功能
  - `guide/commands.md` 命令速览
  - `guide/notification-sinks.md` 通知转发到其他 IM
  - `guide/configuration.md` 配置
  - `guide/security.md` 安全与权限
  - `guide/troubleshooting.md` 排障与 FAQ
- `docs/public/` — `robots.txt`、`sitemap.xml`、`llms.txt`、`favicon.svg`、`logo.svg`

## URL 生成

`cleanUrls: true` 生成干净的 URL（如 `/guide/quickstart`，页面文件为 `guide/quickstart.html`）。Cloudflare Pages 原生把扩展名路径解析到 `.html` 文件并规范化到干净 URL，无需额外的 `_redirects` 规则；本地 `vite preview` 不做该解析属正常，需直接访问 `/guide/quickstart.html`。

## 内容维护

- 页面内容在 `docs/**/*.md`，组件 / 主题在 `.vitepress/theme/`。
- 版本与命令 / 功能清单请与根目录文档（`docs/MANUAL.md` 等）保持同步。
