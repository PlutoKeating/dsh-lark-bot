# 更新链路架构 · Upgrade Flow Architecture（issue #15）

> 本文是 issue #15 的第一阶段交付：对 dsh-lark-bot 的版本更新链路做架构审查，记录组件、
> 路径、执行顺序与已知边界。后续的「更新提醒 / 任何情况无痛一键更新 / 版本热管理与热重载」
> 均以此文档为基线。
> This is the first-stage deliverable of issue #15: an architecture review of the update
> chain, covering components, paths, execution order and known boundaries.

## 1. 目标与范围 · Goals

- 任何安装形态（含 v0.7.0 前的遗留形态、旧版本、`npx` 引导）都能可靠、可回滚地升级到最新；
- 升级不丢配置 / 会话 / 凭据；运行中实例不被无提示打断（或提供明确、可接受的生效路径）；
- 版本信息处处一致：profile 包 / runtime profile 链接及 SDK/ACP 依赖 / guardian 服务单元 / npm / 兼容矩阵。

## 2. 组件与路径总览 · Components

| 组件 Component | 路径 Path | 说明 Notes |
| :--- | :--- | :--- |
| 包本体 Package | `~/.dsh/profiles/<profile>/node_modules/dsh-lark-bot` | pnpm 安装（vendor tgz 或 npm），`dsh plugin add <name>@<version>` 更新 |
| runtime profile（sdk/acp） | `~/.dsh/profiles/dsh-lark-sdk` / `dsh-lark-acp` | 通过 own-package 链接引用包本体；`upgrade` 负责链接、上游依赖及 managed overlay 精确一致性，重写 ACP overlay 时保留当前 provider/model route |
| guardian 服务单元 | `~/.config/systemd/user/dsh-lark-guardian.service`（Linux）等 | ExecStart 指向 CLI 入口；**必须指向稳定路径**（见 §5） |
| 正常引擎服务 | `~/.dsh-lark/service/<profile>.json|env|intent.json` + OS 用户服务 | 可选；稳定 CLI runner 启动同一 dsh profile；env 在 POSIX 为 0600、Windows 为 owner-only ACL；intent 记录显式 stop/uninstall |
| dsh profile 进程 | `dsh --profile <name>` | 桥接引擎在进程内运行；换包后需重启才加载新代码 |
| 桥接心跳 | `~/.dsh-lark/profiles/<bridge>/guardian/heartbeat.json` | guardian 判定 dsh 在线状态的依据 |
| 升级状态 | `~/.dsh-lark/upgrade-state.json` | `--rollback` 的版本快照 |
| 飞书内升级交接 | `~/.dsh-lark/profiles/<bridge>/guardian/update.json` | 0600；精确目标版本、原 chat/thread 路由、执行终态与一次性回执 |
| 多机器人 fleet | `~/.dsh-lark/fleet.json` | 每个实例指向独立 dsh profile 与 `bots/<name>/dsh` DSH_HOME；升级状态与重启仍按 profile 管理 |
| 兼容矩阵 | `docs/COMPATIBILITY.md` | 版本 pin 与上游一致性的单一事实来源 |
| 会话/worktree/archive schema | `<bridge-profile>/sessions.json` + `worktrees/` + `archives/` | 首次启动从旧 worktree 的 Git registry 核验 owning repo，把 schema 1 会话与旧 retention archive header 归回真实项目；owner 匹配时原位迁移，不匹配时保留旧树并另建 hashed worktree |

> dsh rc.8 的“不兼容 SQLite schema 17”只涉及上游 opt-in
> `@deepseek-ai/dsh-session-persistence-sqlite`，托管 SDK/ACP profile 使用 JSONL。upgrade 不打开或改写
> 用户自定义 SQLite 数据库；自定义 SQLite profile 必须保留 rc.7 runtime 或自行导出后新建 schema 17。

## 3. 版本探测 · Version probing（#14 修复后的语义）

- `fetchNpmLatestVersion`（`src/upgrade/versions.ts`）：**最多 3 次尝试 + 退避重试**，每次依次
  使用 `application/vnd.npm.install-v1+json` → `application/json` 两个 Accept 头；
  404 视为“包不存在”不重试；镜像通过 `DSH_LARK_UPGRADE_REGISTRY` 指定。
- `fetchNpmLatestVersionOnce`：单次、5s 超时、best-effort，供 `doctor` 更新提醒等廉价探测使用；
  **任何失败都不得导致 doctor / upgrade 报错**。
- `doctor` 更新提醒：`DSH_LARK_UPGRADE_CHECK=0` 关闭；发现新版本输出
  `upgrade: 有新版本 X（当前 Y）；执行 dsh-lark-bot upgrade 更新`。
- `/version`、`/upgrade`、`/new` 与桥接周期检测（`src/upgrade/update-check.ts` /
  `src/upgrade/update-notifier.ts`）：内存缓存 1h；`/version` 展示当前/最新版本；
  `/upgrade` 与每次 `/new` / `/reset` 强制一次 best-effort 探测（`/new` 仅在严格更新时发短文本）；
  桥接按 `DSH_LARK_UPGRADE_CHECK_INTERVAL_MS`（默认 6h）检测，发现新版本默认记日志，
  `DSH_LARK_UPGRADE_NOTIFY=true` + `DSH_LARK_UPGRADE_NOTIFY_CHAT` 时向指定 chat 推送
  一次（按版本去重）。

## 4. 升级执行链路 · Upgrade pipeline

飞书内入口先由 `ChannelUpdateController` 校验 profile admin，生成绑定 scope + actor、十分钟有效的
一次性 offer；确认卡只允许发起人确认或取消。确认后 `GuardianUpdateHandoff` 先以 0600 原子落盘
精确 npm 目标和回复路由，再启动独立 worker；取消不写升级状态、不启动进程。

1. `detectUpgradeState`：读取 own / installed / dsh 进程 / guardian / 心跳；
2. `resolveTarget`：`--rollback` → `--package <name>@<version>` → npm latest；
3. `dsh plugin add <name>@<target>`：profile 内 pnpm 安装（含构建策略预批准）；
4. guardian 重装：`resolveGuardianCliEntry` **优先 profile 内已装包**（稳定路径，见 §5）；
5. runtime profile 一致性修复：sdk/acp own-package 链接、陈旧 SDK server / ACP 依赖，以及与当前
   包不一致的 managed `cordis.patch.yml`；ACP 重写前解析并保留既有 provider/model route；
6. 新版 bridge 首次启动时迁移 workspace session schema；若存在旧版 scope-only Git worktree，先从
   Git registry 解析 owning repo；先以逐文件原子、半完成可重试的幂等流程把旧 execution-cwd
   retention archive header 归回该项目并生成 migration commit，全部成功后才提交 session schema 2。
   请求 base 匹配 owner 时原位移动到 path-hash
   目录；不匹配或不可验证时保留旧树，并为当前 base 新建独立树，避免错误迁移或覆盖 dirty state；
7. 先记录 `upgrade-state.json`（支持 `--rollback`；运行中实例先标记 pending restart）；
8. `doctor` 升级后验证；
9. 带 `--restart` 时最后探测正常引擎 service metadata；已安装则通过对应 OS controller 刷新环境并
   重启（显式 upgrade 操作可覆盖先前 stop intent），未安装才回退旧的 detached process 重启，
   避免重复 dsh 实例；成功后清除 pending restart。将 profile 重启放在最后，确保同 cgroup worker
   即使被重启终止，回滚记录与 doctor 也已经完成。

独立 worker 通过目标版本的 `npx <name>@<version> upgrade --restart --package <name>@<version>`
复用上述完整链路。它不继承 bridge cwd，也不复用 `~/.npm`：固定从
`profiles/<bridge>/guardian/update-worker/cwd`（0700）运行，npm cache 按 request id 的 SHA-256
隔离在相邻目录（0700），并以显式 0077 umask 启动 npx，避免历史 cache 权限损坏、源码目录同名
package 遮蔽或异常宿主 umask 破坏 npm 子目录。失败输出只映射为有界安全类别，原始 stdout/stderr
不会落盘或发往飞书。受管 profile 的 systemd cgroup 重启可能同时终止 worker；新 bridge 以实际加载的
包版本协调仍为 running 的交接状态，确认目标已生效后标记 succeeded。终态发送失败保持未交付，
下一次轮询或重启继续向原 chat/thread 重试，因此结果最多成功交付一次。

## 5. 生效机制与关键修复 · Activation & hardening

- **飞书 worker 执行环境（issue #90）**：旧实现继承 bridge cwd 并复用用户全局 npm cache，源码目录
  同名包遮蔽或任一无 execute 位的 cache 目录都会让 `/upgrade` 在数秒内失败，状态却只有 exit code。
  现使用上述中立 cwd、逐请求 cache 与安全 umask，并只保存/回传脱敏的可行动失败类别。
- **guardian 单元路径（issue #15 发现并修复）**：通过 `npx` 引导安装时，`guardian install`
  曾把 ExecStart 指向 `~/.npm/_npx/<hash>/...`——npm 清理缓存后服务失效。现改为优先解析
  `~/.dsh/profiles/<profile>/node_modules/<name>/dist/cli.js`（稳定路径），仅在 profile 内
  无包时回退到当前运行包；`doctor` 会检测单元内容并警告 npx 缓存路径。
- 包更新后，**运行中的 dsh 进程仍执行旧代码**：CLI 默认只提示重启命令（不中断会话），
  `--restart` 自动重启 guardian 服务与受管 profile；若安装了 `service`，优先走 OS 服务重启；
  飞书 `/upgrade` 总是走该 guardian 协调的自动重载路径。重载会中断正在执行的任务，但持久会话、
  归档、配置和凭据保留；cordis hmr 仍被禁用，不宣称进程内无重启 HMR。
- **待生效标记**：升级记录 `pendingRestart`（运行中实例且未 `--restart` 时为 true），
  `doctor` 会提示「上次升级待重启生效」；重启后再次 upgrade / 手动清理即不再提示。
- 换包后的首次启动较慢（pnpm 校验 / 构建策略，实测 ~30–90s），属已知现象，等待即可。
- **多机器人实例**：`upgrade --profile <name>` 只升级指定 dsh profile，不会隐式中断或批量重启
  其他实例。管理员应从 `bot list` 取得每个实例的 dsh profile 与 dsh home，逐个以
  `DSH_HOME=<dsh-home> dsh-lark-bot upgrade --profile <dsh-profile> --yes` 执行 upgrade/doctor；
  `--restart` 也只作用于该 profile 对应的用户服务。

## 6. 已知边界与风险清单 · Known boundaries

| 场景 Scenario | 现状 Status | 处置 Handling |
| :--- | :--- | :--- |
| 旧版本 `npx` 引导（< v0.12.0） | v0.13.1 起探测健壮；**在包源码目录内**执行会触发 npm shim 错误 | 文档提示从任意普通目录执行 |
| guardian 单元指向 npx 缓存 | 已修复 + doctor 告警 | 重新 `guardian install` |
| registry 偶发 406 / 慢响应 | #14 重试 + Accept 降级 | 已修复 |
| 运行中实例升级 | CLI 默认提示重启；飞书确认后 Guardian 自动更新并重载，活动任务会中断 | 已支持最小重启窗口；非进程内 HMR |
| 离线 / 镜像 | `--force` 按当前版本重装；`DSH_LARK_UPGRADE_REGISTRY` | 已支持，需回归 |
| Windows | `pnpm.cmd` 解析（#7 cross-spawn）；guardian 用启动项 | 已修复，需回归 |
| 回滚 | `upgrade-state.json` + `--rollback` | 已支持 |
| 运行中实例待生效 | `pendingRestart` 记录 + doctor 提示 | 已实现 |
| runtime 链接漂移 | doctor 检测 sdk/acp 链接版本与已装版本不一致 | 已实现 |
| runtime managed overlay 漂移 | upgrade 按当前包精确比较 SDK overlay；ACP 按既有 provider/model route 生成期望内容，陈旧时原地重写 | 已实现 + 单测覆盖 |
| schema 1 workspace/worktree/archive | 从旧树核验 owning repo并归属 session/retention archive；owner 匹配时原位移动，不匹配时保留旧树并为当前项目另建 | 已实现 + 单测覆盖 owner match/mismatch/archive rebind |
| 多机器人版本漂移 | 每个实例是独立 dsh profile，单次 upgrade 不做 fleet-wide mutation | `bot list` 后逐 profile 升级并 doctor |

### 6.1 npx 引导回归矩阵 · Bootstrap regression matrix

| 场景 Scenario | 覆盖 Coverage |
| :--- | :--- |
| 普通目录 `npx dsh-lark-bot@latest upgrade` | 手动验证（v0.13.1 实测通过）+ #14 探测单测 |
| 包源码目录内 npx | 已知 npm shim 行为（文档提示从普通目录执行） |
| registry 偶发 406 / 慢响应 | 单测：406→JSON 降级、503→重试、404→不重试 |
| 镜像 registry | 单测：`fetchNpmLatestVersionOnce` 自定义 registry URL；`DSH_LARK_UPGRADE_REGISTRY` 文档化 |
| 离线（registry 不可达） | 单测：`--force` 按当前版本继续 |
| 指定版本 | 单测：`--package name@version` |
| 回滚 | 单测：`--rollback` 按 state 重装上一版本 |
| Windows pnpm 解析 | 单测：sdk/acp runtime cross-spawn（#7） |

## 7. 热重载 / 最小重启窗口 · Hot reload & minimal restart window

**现状**：桥接引擎运行在 dsh 进程内（标准插件加载），插件代码在 boot 时装载，cordis hmr
被禁用——**换包必须重启 dsh profile 进程**，重启会中断进程内会话。

**当前方案（飞书自更新 + 最小重启窗口 + 安全网）**：
1. 升级默认不中断会话：只记录 `pendingRestart` 并提示；`--restart` 走
   guardian 服务重启 → dsh profile 重启（systemd-run 重建）；
2. 安全网守护在 dsh 下线期间接管飞书通道（standby→takeover），重启窗口内用户不失联；
3. 升级失败 / 不满意可 `--rollback` 精确回退（`upgrade-state.json`）。
4. 管理员可只在飞书发送 `/upgrade`，确认卡后由独立 worker 固定目标版本并完成更新/重载；
   终态跨重启恢复。`/new` 只负责短提醒，绝不自动开始升级。

**热重载边界与回退**：真正意义的进程内热重载需要把桥接引擎拆出 dsh 核心进程（或启用并验证
cordis hmr 与 SDK runtime 的连接保持），属于架构演进方向，不在当前版本落地；在实现前，
`--restart` + guardian 兜底 + `--rollback` 即为受支持的最小重启窗口与回退路径。

## 8. issue #15 路线图 · Roadmap

- **更新提醒**：doctor 已落地（本分支）；后续增加 bridge 启动日志 / `/status` 展示、低频率
  带缓存的新版本检测与飞书管理员通知（可关闭）。
- **任何情况无痛一键更新**：旧版本 `npx` 引导回归矩阵（Windows / 镜像 / 离线 / 代理）；
  运行中实例“排队重启 / 自动重启”策略细化；升级中断重入。
- **版本热管理与热重载**：版本 pin 一致性 + doctor 漂移自愈（guardian 单元、runtime 链接、
  COMPATIBILITY）；探索热重载或最小重启窗口（cordis hmr、SDK runtime 连接保持），明确回退路径。

## 9. 验收对照 · Acceptance（对应 issue #15）

- [x] 架构审查文档落盘（本文）
- [x] doctor 更新提醒（可关闭，`DSH_LARK_UPGRADE_CHECK=0`）
- [x] `/version` 命令 + 桥接周期检测（日志 / 可选飞书通知，按版本去重）
- [x] `/upgrade` 管理员 owner-bound 确认卡 + Guardian 持久交接 + 跨重启终态回执
- [x] `/new` / `/reset` 每次 best-effort 检查，只有新版本时发送一条短文本
- [x] `npx` 引导回归矩阵（镜像 / 离线 / 指定版本 / 回滚 / 406 / Windows 单测覆盖）
- [x] 运行中实例：`pendingRestart` 记录 + doctor 提示 + `--restart` / `--rollback`
- [x] 版本 pin / runtime 一致性：guardian 单元路径、runtime 链接与上游依赖、managed overlay
  精确内容（ACP 保留 provider/model route）均由 upgrade 检测并修复
- [x] 最小重启窗口 + 安全网兜底 + 回滚；热重载分析落盘（架构演进方向，边界明确）
