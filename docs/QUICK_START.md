# 快速开始 · Quick Start

> 本文描述 dsh-lark-bot 面向最终用户的安装与首次使用流程。

## 1. 前置条件

- Node.js ≥ 22.19
- 已安装 DeepSeek Harness（`dsh`）并配置 `DEEPSEEK_API_KEY`
- 一个飞书 / Lark 账号

## 2. 安装（唯一路径）

```bash
npx dsh-lark-bot@latest setup --profile dsh-lark
```

`setup` 会：定位本机 dsh → 预批准 pnpm 构建策略（protobufjs 等）→ 执行标准
`dsh plugin --profile dsh-lark add dsh-lark-bot`，把本插件作为标准 bundle 装进 profile，
并**默认同时安装「安全网守护」**（见第 6 节；不需要时加 `--no-guardian` 跳过）。

开发阶段也可以先 `pnpm install && pnpm build`，再用
`DSH_LARK_SETUP_PACKAGE=/path/to/dsh-lark-bot-x.y.z.tgz node dist/cli.js setup --profile dsh-lark`
安装本地构建产物（可选，不面向普通用户）。

**升级（v0.12.0+ 推荐）：** 一行命令彻底升级包 + guardian + 升级后验证：

```bash
npx dsh-lark-bot@latest upgrade --profile dsh-lark --yes
```

`--check` 只报告版本与运行状态；`--restart` 升级后自动重启 guardian 与受管 profile；
`--rollback` 回滚到上次升级前版本；详见 README「升级」与 docs/MANUAL.md §1.1。

## 3. 启动并扫码（首次一次性绑定）

```bash
dsh --profile dsh-lark
```

dsh 以标准插件方式加载桥接引擎；首次启动（无凭据时）终端显示二维码：

1. 终端显示二维码。
2. 使用飞书 App 扫码。
3. 选择或创建 PersonalAgent 应用。
4. 绑定成功后，桥接引擎在 dsh 进程内运行并发送欢迎卡片到私聊。
5. 直接发送消息即可开始使用；群聊中需要 `@bot`。

在 Git 仓库中工作时，bot 会为每个会话自动创建独立 git worktree；非 Git 目录则直接使用你指定的目录。

常驻 / 守护由 dsh 宿主负责（profile 在则引擎在；默认安装的「安全网守护」除外，见第 6 节）。
已经有一个 PersonalAgent 应用时，
可在启动命令的环境变量中提供凭据跳过扫码：

```bash
DSH_LARK_APP_ID=cli_xxx DSH_LARK_APP_SECRET=<secret> DSH_LARK_TENANT=feishu \
  dsh --profile dsh-lark
```

## 4. 卸载

```bash
dsh plugin --profile dsh-lark remove dsh-lark-bot
```

## 5. 飞书内常用命令

| 命令 | 作用 |
| --- | --- |
| `/new` `/reset` | 开始新会话 |
| `/cd <path>` | 切换工作目录并重置会话 |
| `/ws list` | 查看命名工作空间 |
| `/ws save <name>` | 保存当前工作空间 |
| `/ws use <name>` | 切换到命名工作空间 |
| `/ws remove <name>` | 删除命名工作空间 |
| `/status` | 查看当前状态 |
| `/resume` | 查看当前会话最近上下文 |
| `/stop` | 终止当前任务 |
| `/timeout [N\|off\|default]` | 查看或设置当前会话运行超时 |
| `/concurrency [N\|default]` | 查看或设置当前 scope 并行任务数 |
| `/role set <id>`、`/role list` | 绑定 / 查看多角色 Agent |
| `/archive [note]`、`/archive list` | 归档 / 查看会话记录 |
| `/notify <scope\|chatId> <text>` | 跨会话发送通知（管理员） |
| `/density [compact\|standard\|detailed]` | 查看或设置卡片密度 |
| `/model` `/model use <id>` `/model default <id>` | 查看 / 热切换当前会话模型 / 写入 dsh 默认模型 |
| `/model add\|remove <provider> <modelId>` | 管理 provider 的模型（管理员） |
| `/providers` | 查看 dsh providers、模型与凭据状态 |
| `/provider add\|update\|remove <id>` | 管理 provider（管理员） |
| `/key set\|remove\|list <引用名>` | 管理 dsh 凭据（set / remove 需管理员） |
| `/ask <问题>` | 你主动发送结构化问答卡（回答写入会话上下文） |
| `/invite user\|admin\|group <id>`、`/invite list`、`/invite remove user\|group <id>` | 管理访问白名单 |
| `/help` | 查看命令帮助 |

模型 / provider / 凭据管理直接读写 dsh 官方配置（`~/.dsh/settings.yaml` 与
`~/.dsh/.credentials.yaml`，与 dsh Web Settings→Models 同协议），改动下一请求生效：
`/model use` 按会话热切换模型；`/model default` 写入 `agent-default-model`；
`/provider add|update` 管理 `deepseek-official` 与自定义 pi-ai provider；
`/key set|remove` 写读凭据文件（0600）。密钥不会在聊天回复中显示，建议在私聊中使用。

启动后如发现异常，先运行 `dsh-lark-bot doctor` 检查 profile、工作目录和本机 dsh 可用性。

默认 backend 为官方 `@deepseek-ai/dsh-sdk-client`（`DSH_LARK_ADAPTER=sdk`）：首次启动会自动在
`~/.dsh/profiles/dsh-lark-sdk` 创建 SDK JSON-RPC runtime profile（bundle `dsh-base` +
`dsh-sdk-jsonrpc-server`），需要本机可用 `pnpm`。审批场景可切换
`DSH_LARK_ADAPTER=acp`（`~/.dsh/profiles/dsh-lark-acp`，审批卡通过 ACP
`session/request_permission` 一问一答）；`headless` 保留旧版子进程 fallback；
`DSH_LARK_ADAPTER=web` 驱动本地 dsh web agent（`session.prompt` + `/api/events.mux`，
网页端成为唯一写者，从根上消除多写者会话损坏；配合 `DSH_LARK_WEB_URL` / `DSH_LARK_WEB_PUSH`）。

bot 会为每个飞书 scope 默认保存最近 40 条对话（`/retention` 可调），超出保留窗口的消息自动
归档到 `~/.dsh-lark/profiles/<profile>/archives/`（Markdown + JSONL + Git commit，`/archive`
可手动导出）；`/new` 会清空当前 scope 的会话记忆。

发送图片时，bot 会先下载到本地 media 目录；发送文本类文件时，会把文件内容注入给 dsh 处理。

**任务中向你提问（问答卡）**：agent 需要你拍板、确认或补充缺失信息时，会通过 `lark_ask_user`
工具主动向当前会话弹一张问答卡（单选 / 多选 / 自由文本），你回答后任务自动继续；等待期间
任务运行超时看门狗暂停，不会被超时打断。

## 6. 安全网守护（默认安装）· Safety-net guardian

dsh 采用「一切皆插件」架构，任何第三方插件都可能让整个 profile boot 失败。此时桥接引擎与
dsh 一起下线，飞书入口不可用。因此 `setup` **默认安装**一个**独立于 dsh 进程**的最小守护，
在最坏情况下仍保留飞书救援入口：

```bash
# 随 setup 默认安装（无需额外参数）；已安装后也可单独安装 / 重装：
dsh-lark-bot guardian install --dsh-profile dsh-lark

# 状态查看 / 卸载
dsh-lark-bot guardian status
dsh-lark-bot guardian uninstall
```

不需要守护时，安装命令加 `--no-guardian` 跳过。

dsh 正常运行时守护保持静默（不占用飞书通道）；dsh 下线或无法 boot 后，守护自动接管通道，
在飞书里向 bot 发送控制信号即可全程自救，无需命令行：

| 命令 | 作用 |
| --- | --- |
| `/safemode` | 进入仅核心安全模式（`dsh-base` + `dsh-headless`，无第三方插件），后续消息与 dsh 核心对话 |
| `/safemode status` | 查看守护 / dsh / 安全模式状态 |
| `/safemode plugins` | 列出故障 profile 已安装的插件清单 |
| `/safemode stop` | 终止当前正在运行的安全模式任务（也可点击任务卡片 ⏹ 按钮） |
| `/safemode exit` | 退出安全模式，重启完整 profile 并交还飞书通道 |

安全模式下 agent 具备代码执行能力，可配合上述命令定位 / 修复 / 禁用损坏插件。安全模式优先使用
官方 SDK 流式引擎（实时思考 / 工具调用 / web search / 打字机式文字，同一张卡片持续更新）；
SDK runtime 不可用（如缺 pnpm）时自动回退 headless——此时任务期间卡片仍实时显示
“正在思考 / 已运行 Ns / 无响应 Ns”，任务结束、出错或超时都有明确终态。单任务**空闲超时**
默认 10 分钟（`DSH_LARK_GUARDIAN_SAFE_TIMEOUT_MS`，任务持续无活动事件才被终止，活跃任务
不会被误杀）。dsh 恢复后守护自动断开并回归静默。
守护相关本地状态见下节。

## 7. 本地状态

- 配置文件：`~/.dsh-lark/config.json`
- 守护状态：`~/.dsh-lark/guardian.json`
- 会话状态：`~/.dsh-lark/profiles/<profile>/sessions.json`
- 会话归档：`~/.dsh-lark/profiles/<profile>/archives/`
- 角色定义：`~/.dsh-lark/profiles/<profile>/roles.json`
- scope 目录：`~/.dsh-lark/profiles/<profile>/scopes.json`
- 工作空间：`~/.dsh-lark/profiles/<profile>/workspaces.json`
- Git worktree：`~/.dsh-lark/profiles/<profile>/worktrees/`
- 媒体目录：`~/.dsh-lark/profiles/<profile>/media/`
- 运行日志：桥接引擎以 JSON Lines 输出到 stderr（由 dsh 宿主进程捕获；`logs/bot.log`
  是 0.6.0 独立服务时代的遗留路径，0.7.0 起不再写入）
- 守护心跳：`~/.dsh-lark/profiles/<profile>/guardian/heartbeat.json`（桥接引擎周期写入）

dsh runtime profile（由 bot 首次启动自动创建于 `~/.dsh/profiles/`）：

- `dsh-lark-sdk`：SDK JSON-RPC runtime（`DSH_LARK_ADAPTER=sdk`，默认）
- `dsh-lark-acp`：ACP runtime（`DSH_LARK_ADAPTER=acp`，审批）
- `dsh-lark-safe`：仅核心安全 profile（`/safemode` 时由守护创建，`dsh-base` + `dsh-headless`）
- `dsh-lark-safe-sdk`：安全模式的 SDK 流式 runtime（`/safemode` 时由守护优先创建，
  `dsh-base` + `dsh-sdk-jsonrpc-server`，无第三方插件；失败自动回退 `dsh-lark-safe`）

可通过 `DSH_LARK_HOME` 修改状态根目录；`DSH_LARK_RUN_TIMEOUT_MS` 控制单次运行空闲超时
（持续无活动事件才终止），`DSH_LARK_STOP_GRACE_MS` 控制优雅退出宽限期。

## 8. 卸载

```bash
dsh-lark-bot guardian uninstall   # 仅安装过守护时需要
dsh plugin --profile dsh-lark remove dsh-lark-bot
```

卸载后 profile 不再加载插件；本地状态保留在 `~/.dsh-lark`，如需清除请先备份再删除该目录。
