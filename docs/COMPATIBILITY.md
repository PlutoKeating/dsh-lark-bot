# 兼容矩阵与升级政策 · Compatibility Matrix & Upgrade Policy

> 本文是 DeepSeek Harness 兼容性的**单一事实来源**，机器可读副本位于
> [`src/config/dsh-compat.ts`](../src/config/dsh-compat.ts)，配套自动化：
> `scripts/check-dsh-upstream.mjs`（上游雷达）与 `scripts/probe-dsh-compat.mjs`
> （真实可用性探测，CI `compat-probe` 任务）。

## 1. 兼容矩阵

> 最后验证：2026-08-20（临时 DSH_HOME 安装 + SDK / ACP initialize；ACP task/permission；SDK notify/ask/plan/approval、live session 续接与 restart collision；rc.7 SQLite fail-closed 实测）。

| 组件 | 锁定版本 | 说明 |
| :--- | :--- | :--- |
| DeepSeek Harness CLI（`dsh`） | `0.1.0-rc.8` | SDK / ACP runtime initialize 握手实测通过 |
| `@deepseek-ai/dsh-sdk-client` | `0.1.0-rc.8` | `package.json` 精确锁定（`dependencies`） |
| `@deepseek-ai/dsh-sdk-jsonrpc-server` | `0.1.0-rc.8` | SDK runtime profile 安装版本（`dsh-compat.ts`） |
| `@deepseek-ai/dsh-acp` | `0.1.0-rc.8` | ACP runtime profile 安装版本（`dsh-compat.ts`） |
| Node.js | `>=22.19.0` | `engines` 与 `dsh-compat.ts` 一致 |

版本约束规则：

- SDK client 与托管 SDK server / ACP 顶层包精确 pin；本仓库 lockfile 的 SDK peer graph 通过
  `pnpm.overrides` 统一到矩阵版本。override 不会传递给下游，因此每次发现新上游版本都必须重跑
  全新 consumer 安装与真实 probe，不能把当前注册表快照当成永久保证。
- 本包不直接依赖 `@deepseek-ai/dsh-tools`；工具以 raw JSON Schema 注册到宿主 registry，
  防止两份模块级 scheduler Symbol。lockfile 不允许混入任何非当前矩阵版本的 dsh core 包。
- `dsh-compat.ts` 是唯一事实来源；`scripts/check-dsh-upstream.mjs` 会校验它和
  `package.json` 的 `dsh-sdk-client` 版本一致，不一致即报错（防漂移）。
- 模型 / provider / 凭据管理走 dsh 官方 `settings.yaml` + `.credentials.yaml` 存储协议，
  与 SDK 版本无关；SDK/ACP 协议漂移集中在 `src/adapters/dsh/`，宿主工具 registry 漂移
  集中在 `src/notify/` 的 raw-schema 注册边界。

## 2. 升级政策

DeepSeek Harness 处于 developer preview（0.1.0-rc 系列），接口频繁破坏性变更。政策：

1. **优先跟随 stable**：`latest` dist-tag 出现非 rc 稳定版（或 rc 更高版本）时，按第 3 节流程升级。
2. **不在 rc 迭代期盲目追新**：除非修复直接影响本 bot 的缺陷，否则保持冻结版本，
   等一个被验证的版本再批量对齐。
3. **升级 = 一次受控发布**：改版本 → 全量回归 → 更新验证日期 → 发版，而不是原地换依赖。

## 3. 升级操作手册（Upgrade Runbook）

以从当前 `0.1.0-rc.8` 升级到 `X.Y.Z` 为例：

1. **确认上游**：`node scripts/check-dsh-upstream.mjs`（或每周 CI `dsh-upstream` 任务）
   分别检查 `latest`、`next` 与 highest published，阅读对应 release notes 中 SDK/ACP 的破坏性变更。
2. **更新单一事实来源**：改 `src/config/dsh-compat.ts` 中 `harness` / `sdkClient` /
   `sdkServer` / `acp`（按需），`verifiedAt` 留空待验证后填写。
3. **同步锁定**：把 `package.json` 的 `@deepseek-ai/dsh-sdk-client` 改为同一精确版本，
   执行 `pnpm install` 更新锁文件。
4. **全量回归**：`pnpm release:check`（diff 检查 + typecheck + 全部测试 + 构建 +
   上游一致性检查）。
5. **真实可用性探测**：`pnpm compat:probe`（本机）或推送后 CI `compat-probe` 任务：
   在临时 DSH_HOME 安装锁定版 dsh，走 SDK / ACP runtime 初始化握手，并用本地
   OpenAI-compatible fixture 验证 ACP 文本任务 + plan + one-shot permission 拒绝，以及 SDK 任务、`lark_notify` / `lark_ask_user` /
   `lark_request_plan_approval` 回调、计划前 `bash` 强制拒绝 → 计划批准 → rc.8 one-shot approval → 实际执行的顺序、
   one-shot 拒绝后 agent 继续替代工具路径、同一 runtime 的 session 续接，以及关闭重开后
   persisted-log collision 明确可识别（bridge 随后清 binding 并用 transcript 新建 session）。
6. **实机回归**：重启 profile（`dsh --profile <name>`，或守护模式下
   `dsh-lark-bot guardian status` 观察接管/交还）后运行 `dsh-lark-bot doctor`，
   确认 dsh profile 中插件装载正常（`dsh --profile <name>` 内引擎启动）；飞书会话内跑一轮真实任务。
7. **更新验证日期**：把 `verifiedAt` 改为当天，同步本文矩阵表与
   `README.md`「兼容性」章节。
8. **发版**：提交、push、打 tag，release 流水线自动发布双包。

## 4. 自动化

| 机制 | 位置 | 作用 |
| :--- | :--- | :--- |
| 上游雷达 | `scripts/check-dsh-upstream.mjs` + `.github/workflows/dsh-upstream.yml`（每周一 03:17 UTC + 手动触发） | 分列 `latest` / `next` / highest，校验矩阵、workshop、lockfile 与无直接 dsh-tools 依赖 |
| 真实探测 | `scripts/probe-dsh-compat.mjs` + `.github/workflows/ci.yml`（`compat-probe` 任务） | 临时 DSH_HOME 安装锁定 dsh，验证 rc.7 SQLite 被 rc.8 原样拒绝、SDK / ACP initialize、ACP task/permission/image capability，以及 SDK notify/ask/plan/approval、live resume/restart collision |
| 发版前检查 | `pnpm release:check`（= `ci:local` + 上游一致性） | 本地全量门禁 |

## 5. 风险披露

- dsh 仍是 pre-release：即使锁定版本，接口仍可能随 patch 行为变化；以 CI 实测为准。
- 探测任务需要网络与 `pnpm`；失败时优先看 workflow 日志中的 dsh 安装 / 握手错误。
- rc.8 的已知 session 边界与本次验证限制见 [`DSH_RC8_AUDIT.md`](DSH_RC8_AUDIT.md)。
- rc.8 不兼容 schema 只属于 opt-in SQLite provider；托管 SDK/ACP 使用 JSONL。自定义 SQLite profile
  不自动迁移，必须保留旧 runtime 或自行导出后新建 schema 17 数据库。
