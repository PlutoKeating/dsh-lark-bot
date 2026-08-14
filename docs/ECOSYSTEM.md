# 生态兼容与交付标准 · Ecosystem & Delivery Standards

> 本文档定义 dsh-lark-bot 作为 DeepSeek Harness 生态插件的**工程交付标准与兼容性要求**。实现代码的工程师（P1 及之后）需要满足这些要求——它们决定插件能否被生态正确识别、可靠安装与持续维护。
> This document defines the **delivery standards and compatibility requirements** for dsh-lark-bot as a plugin in the DeepSeek Harness ecosystem. Engineers implementing code (P1 onward) must satisfy these — they determine whether the plugin is correctly recognized, reliably installable, and maintainable.

---

## 1. 背景 · Background

DeepSeek Harness 生态有一个社区维护的**目录与兼容性雷达**（`awesome-dsh-plugins`），每天自动扫描带 `dsh-plugin` topic 的公开仓库，并对每个插件做多层级兼容性判定（发现 → 清单 → 静态兼容 → 编译 → 运行实测）。

本规范的作用是：让本插件达到生态目录的**可识别、可安装、可评估**标准。这是工程质量与互操作性的底线，与「写功能代码」同等重要。

## 2. 代码交付要求 · Code Delivery Requirements

实现工程师必须保证根目录满足：

| 项 | 要求 |
| :--- | :--- |
| `package.json` | 存在且 `name` 非空（`dsh-lark-bot` / `dsh-feishu-bot`） |
| 入口 | 提供 `main` / `exports` / `dsh.bundle.patch`（`./cordis.patch.yml`） |
| 依赖 | 所有运行时依赖在 `dependencies` / `peerDependencies` 显式声明 |
| 许可证字段 | `license` 字段与根 `LICENSE` 文件**一致**（均为 AGPL-3.0） |

### 2.1 dsh profile bundle 形态

- 产品形态为 **dsh profile bundle**（唯一安装-部署-使用路径）：`package.json` 声明
  `dsh.bundle.patch` → `./cordis.patch.yml`，支持 `dsh plugin --profile <name> add
  dsh-lark-bot` 标准安装，或一行 `npx dsh-lark-bot@latest setup --profile <name>`；
  bundle patch 装配 `dsh-lark-bot/plugin`（在 dsh 进程内运行完整桥接引擎，首次启动扫码绑定）
  与 `lark-notify`（标准工具行）。
- `./plugin`、`./invariant`、`./notify` 三个子路径导出随包发布：`plugin` 为 bundle 行对应的
  cordis 插件；`invariant` 为 `invariants` 注册表伴生模块（与官方 dsh-lark-channel 同款契约）；
  `notify` 为 `lark_notify` 工具插件，SDK / ACP runtime profile 自动装配。
- `peerDependencies` 声明 `@deepseek-ai/cordis: ^4.0.1`（与 dsh 0.1.0-rc.6 依赖链一致）。
- pnpm ≥ 10 对依赖构建脚本（protobufjs）默认拒绝：`dsh plugin add` 若报
  `ERR_PNPM_IGNORED_BUILDS`，按官方 publish 指引在 profile 的 `pnpm-workspace.yaml` 加入
  `allowBuilds: { protobufjs: true }` 后重试（与官方 dsh-lark-channel 行为一致）。

## 3. README 规范 · README Specification

README 必须覆盖以下九个章节（本仓库已全部填实，见根目录 `README.md`）：

1. Overview — 解决什么问题、适合谁（`这是什么 / What it is` + `目标 / Goals`）
2. Compatibility — 支持哪些 dsh 版本 / mainline commit，最后验证日期（`兼容性 / Compatibility`）
3. Install / Uninstall — 如何安装、升级、禁用、彻底移除（`安装与卸载 / Install & Uninstall`）
4. Quick start — 最小配置 + 可复现示例（`快速开始 / Quick Start`）
5. Configuration — 配置项、默认值、环境变量、敏感项（`配置 / Configuration`）
6. Permissions & data — 访问哪些文件 / 网络 / 凭据 / 用户数据（`权限与数据 / Permissions & Data`）
7. Troubleshooting — 常见错误、日志位置、回滚方式（`排障 / Troubleshooting`）
8. Development — 如何构建、测试、贡献（`开发 / Development`）
9. License & security — 许可证、版权归属、安全问题的私下报告方式（`许可与安全 / License & Security`）

此外按 omdsh-dev/community 收录要求补充：

- `维护与支持 / Maintenance` — 维护状态、主维护者、问题 / 安全报告渠道。
- `已知限制 / Known limitations` — ACP 会话全新、SDK 无 mid-turn cancel、嵌套 runtime 取舍、
  未实现能力（飞书文档评论等）、pnpm≥10 构建策略说明。

## 4. DSH 版本声明 · DSH Version Declaration

- README「兼容性」章节需声明支持的 dsh 版本 / mainline commit 及**最后验证日期**。
- dsh 处于 developer preview，接口**频繁破坏性变更**。交付时锁定一个验证过的 commit，并在 dsh 升级后复验更新。
- 接入点集中在 `src/adapters/`（ACP / SDK），dsh 漂移时只改这一层，不波及桥接核心。
- 锁定版本以 [`src/config/dsh-compat.ts`](../src/config/dsh-compat.ts) 为单一事实来源，
  矩阵文档与升级手册见 [`docs/COMPATIBILITY.md`](COMPATIBILITY.md)。

### 4.1 自动化保障

- `scripts/check-dsh-upstream.mjs`（+ 每周 CI `dsh-upstream` 任务）：对比 npm `latest`，
  上游发布新 stable 时以失败引起注意；同时校验 `dsh-compat.ts` 与 `package.json`
  的 `dsh-sdk-client` 锁定版本无漂移。
- `scripts/probe-dsh-compat.mjs`（+ CI `compat-probe` 任务）：临时 DSH_HOME 安装锁定版
  dsh + SDK server，通过 `dist/cli.js doctor` 走真实 SDK 初始化握手，满足 L4 运行实测。
- 发版前执行 `pnpm release:check`（`ci:local` + 上游一致性检查）与本机
  `dsh-lark-bot restart` + `doctor` 实机回归。

## 5. 风险披露 · Risk Disclosure

- README「权限与数据」章节需如实说明：读取的凭据、访问的文件目录、建立的网络连接、spawn 的进程，以及数据去向。
- **禁止**把密钥、token、私有地址、个人机器路径提交进仓库；只维护 `.env.example` 模板。

## 6. 兼容性自检 · Compatibility Self-check

生态目录的判定分四层，交付前应至少自检前三层：

| 层级 | 检查内容 | 交付前动作 |
| :--- | :--- | :--- |
| L0 发现 | topic、仓库可见性、元数据 | 保持 `dsh-plugin` topic + 公开仓库 |
| L1 清单 | `package.json`、name、入口字段 | 见第 2 节 |
| L2 静态兼容 | patch / seam / 依赖版本范围 | 与 dsh 接口无已知漂移 |
| L3 编译 | typecheck / 语法检查 | `pnpm typecheck` 通过 |
| L4 运行实测 | 安装、加载、最小任务 | 记录环境、dsh 版本、插件版本、日志 |

## 7. 可发现性 · Discoverability

- 仓库保持 `dsh-plugin` topic（已添加），以便进入生态的自动发现。
- 包名使用**自有命名空间**（`dsh-lark-bot`），不占用 `@dsh-external/*` 等组织或官方保留命名空间。
- 已收录：`AdamPlatin123/awesome-dsh-plugins#37`（`docs: 登记 dsh-lark-bot`，已合并，运行级
  实测 ✅）。

## 8. 许可一致性 · License Consistency

- 全仓库统一 **AGPL-3.0**：`LICENSE` 文件、`package.json` 的 `license` 字段、README 三处一致。
- 不得引入非兼容的第三方代码。`reference/` 下的克隆仓库仅供研究，已被 gitignore、不提交、不属于本插件。

## 9. 交付清单 · Delivery Checklist

P1 代码完成后，实现工程师在提交前逐项确认：

- [x] `package.json` 合法、name 非空、入口明确、依赖显式、license 字段 = AGPL-3.0
- [x] README 九章节均已填实（无遗留 `🚧` 占位）
- [x] 「兼容性」章节声明了 dsh 版本 / commit + 验证日期（dsh 0.1.0-rc.6，2026-08-14）
- [x] 「权限与数据」章节完整披露风险
- [x] `pnpm typecheck` 通过（L3）
- [x] 至少完成一次最小任务的运行实测并记录环境（L4：SDK / ACP runtime 握手 + 真实任务流式，
      记录于 `docs/adapter-notes.md`；`DSH_LARK_E2E=1` 门控测试可复跑）
- [x] `dsh-plugin` topic 仍在
- [x] `git status` 干净，无密钥 / 构建产物 / 本地配置混入提交
