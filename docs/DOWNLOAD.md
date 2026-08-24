# Download dsh-lark-bot (Official) | 官方下载与分发渠道

> 本页是 dsh-lark-bot 的**唯一官方下载与分发渠道说明**。如果你在搜索引擎或第三方页面看到“Download dsh-lark-bot”的下载入口，请先按下方清单核对——**本项目从不提供可执行文件**。

## 官方渠道（只有这些）

| 渠道 | 地址 / 包名 |
| :--- | :--- |
| 官方 GitHub 仓库 | <https://github.com/PlutoKeating/dsh-lark-bot> |
| 官方 npm 包（唯一） | `dsh-lark-bot`（同源双包 `dsh-feishu-bot`，维护者 `plutokeating`） |
| 官方 Releases | <https://github.com/PlutoKeating/dsh-lark-bot/releases> |
| GitHub Packages | `@plutokeating/dsh-lark-bot` / `@plutokeating/dsh-feishu-bot` |

## 官方安装（没有“下载安装包”这回事）

```bash
# 唯一安装命令
npx dsh-lark-bot@latest setup --profile dsh-lark

# 一键升级
npx dsh-lark-bot@latest upgrade --profile dsh-lark --yes

# 或标准 dsh 插件方式
dsh plugin --profile <name> add dsh-lark-bot
```

本项目以 npm 包 + dsh 标准 profile bundle 交付，**从不提供 Windows/macOS 可执行文件（.exe 等）**。

## Release 资产说明

每个 GitHub Release 发布两个 **npm tarball（源码包，不是可执行文件）**：

- `dsh-lark-bot-<version>.tgz`
- `dsh-feishu-bot-<version>.tgz`

自本文档落地后的下一个 Release 起，每个资产随附同名 `<asset>.sha256` 校验文件。下载后请校验：

```bash
# Linux / macOS
shasum -a 256 dsh-lark-bot-<version>.tgz

# Windows PowerShell
Get-FileHash dsh-lark-bot-<version>.tgz -Algorithm SHA256
```

与 Release 中 `<asset>.sha256` 内容比对，不一致即视为损坏或被篡改：请勿安装，并按 [`SECURITY.md`](SECURITY.md) 的报告渠道反馈。

## 如何识别假冒来源（核对清单）

- 声称提供“Windows 可执行文件 / 双击运行 / 安装向导” → **假冒**（本项目从不发布 exe）；
- 仓库名或包名不在上方官方清单 → **假冒**；
- Releases 页没有 npm tarball，却挂 exe / 安装包 → **假冒**；
- 页面无法访问 Issues、或要求通过第三方链接下载 → **假冒**。

> [!WARNING]
> 2026-08-17 已发现假冒仓库 `tarraencompassing61/dsh-lark-bot`：非 fork 重新上传、删除全部 CI、关闭 Issues、Releases 为 0，却用“下载 Windows exe 双击运行”的诱导性 README 冒充官方分发。取证存档见 [`docs/security/2026-08-17-impostor-repo-evidence/`](security/2026-08-17-impostor-repo-evidence/README.md)。

## 遇到假冒来源怎么办

1. **不要下载、不要运行、不要提供任何凭据**；
2. 截图 + 保存链接，按 [`SECURITY.md`](SECURITY.md) 的报告渠道反馈；
3. 官方维护者已部署持续监控（`npm run security:monitor`）——假冒仓库一旦发布附件会被第一时间识别并按“分发恶意软件”处理。
