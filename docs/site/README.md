# dsh-lark-bot landing site

React Router + Tailwind CSS 的官方落地页 / 使用文档站点。部署到 Cloudflare Pages（项目名 `dsh-lark-bot`），由 `.github/workflows/cf-pages.yml` 在 `main` 分支的 `docs/**` 变更时自动构建并部署。

## 技术栈

- React 18 + typeScript
- react-router-dom v6（`BrowserRouter` + 嵌套路由 + `<Outlet>` 布局）
- Vite 6
- Tailwind CSS v3

## 本地开发

```bash
cd docs/site
pnpm install
pnpm dev          # 启动 Vite dev server
pnpm build        # 产物输出到 dist/
pnpm preview      # 本地预览构建产物
pnpm typecheck    # tsc --noEmit
```

## 页面路由

| 路由 | 页面 |
| --- | --- |
| `/` | 首页（hero、能力、官方渠道声明） |
| `/docs/quickstart` | 快速开始（安装 / 扫码 / 绑定 / `@bot`） |
| `/docs/features` | 核心功能（十二项能力详解） |
| `/docs/commands` | 命令速览（分组命令表） |
| `/docs/notification-sinks` | 通知转发到其他 IM（Telegram / 企业微信纯通知配置） |
| `/docs/configuration` | 配置（环境变量 / profile / Web 设置 / 出站渠道） |
| `/docs/security` | 安全与权限（白名单、密钥、假冒警示） |
| `/docs/troubleshooting` | 排障与 FAQ |

## SPA 路由回退

客户端路由的直接访问（如 `/docs/quickstart`）由 `public/_redirects`（`/* /index.html 200`）交给 Cloudflare Pages 处理；本地 `vite preview` 不做回退，属正常。

## 内容维护

- 页面内容在 `src/pages/*.tsx` 中，组件在 `src/components/`。
- 站点级静态资产（`robots.txt`、`sitemap.xml`、`llms.txt`）在 `public/`，构建时复制到 `dist/`。
- 版本信息、命令 / 功能清单请与根目录文档（`docs/MANUAL.md` 等）保持同步。
