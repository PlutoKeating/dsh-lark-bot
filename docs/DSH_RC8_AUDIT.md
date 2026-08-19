# DeepSeek Harness 0.1.0-rc.8 兼容审计

> 验证日期：2026-08-20。所有安装与协议实验均使用临时 `DSH_HOME`，未读取或改写用户真实 profile。

## 结论

本项目的 SDK client、托管 SDK JSON-RPC server 与 ACP runtime 顶层包已精确锁定 `0.1.0-rc.8`；
本仓库 lockfile 的 dsh peer graph 也通过 override 统一到 rc.8。真实探针通过 SDK / ACP initialize、
ACP 文本 task + plan + one-shot permission 拒绝、SDK notify / ask / plan / one-shot approval 允许与拒绝后
继续、live session 续接，以及关闭重开后的 persisted-log collision 识别。托管 profile 的精确 manifest
与 overlay readiness 会把 rc.7 顶层 runtime 当场幂等重装为 rc.8，并保留 ACP provider/model route。

官方 release：<https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.0-rc.8>
（commit `141eb6f`；[rc.7→rc.8 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.0-rc.7...dsh-v0.1.0-rc.8)
为 536 commits / 1,604 files）。截至验证日，上游 release 没有链接单独的 Discussion；结论以官方
release、tag 下的包 README/manifest、npm tarball 与隔离实测为准，不引用同名非官方 harness 仓库。

公开边界核对：

- [`dsh-sdk-client`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/packages/sdk/client/README.md)
  仍只有 initialize / prompt / shutdown；`run()` 可接收 `ContentBlock[]`，但没有本地图片 upload 或
  persisted-session load 方法。
- [`dsh-sdk-jsonrpc-server`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/packages/sdk/server/README.md)
  以调用方 session id create agent，协议没有 load/list/resume 方法；关闭重开行为由真实 probe 固定。
- [`dsh-session-persistence-sqlite`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/packages/session/session-persistence-sqlite/README.md)
  明确为 opt-in、schema 17 且无旧 schema migration；`dsh-base` shipped composition 仍选择 JSONL。
- SDK client 的 prerelease peer 范围可能随注册表新增版本而变化；仓库用精确 `pnpm.overrides` 固定自身
  lockfile。发布 tarball 在 2026-08-20 的全新 pnpm consumer 安装实测未出现 rc.6/rc.7 条目，但该
  时点证据不冒充会传递给下游的 override；发现新上游版本后必须重新运行 consumer/probe 矩阵。

npm 固定证据：

| 包 | integrity |
| :--- | :--- |
| `@deepseek-ai/dsh@0.1.0-rc.8` | `sha512-VQU5NlomrKLRgcXuOf+sxWFvqxPA8q9vMhrKPlPPXiOJEhGlGlAdiyxZvZxkCVI+v0zbhe21cY3/luLyxpSzzA==` |
| `@deepseek-ai/dsh-sdk-client@0.1.0-rc.8` | `sha512-oxjRMs32QZAuD1bigr3ndFuKRNj661c5WzlUHf7MF+ElLLgC/9Fk28Li31k7Hh1+l5zu0CooXvHJGRvIvjxClA==` |
| `@deepseek-ai/dsh-sdk-jsonrpc-server@0.1.0-rc.8` | `sha512-Q/TDmu/oIZTN7GGBIXSwJ6m7eVts804RMHKoCxAMYcBIMCOo3HbvXe20lMQu511Oi6e0fdmzVu0OSLguCxUhcA==` |
| `@deepseek-ai/dsh-acp@0.1.0-rc.8` | `sha512-lcGAWC77nfmvz/bHLzMt+h6QDDONw9ZGMFGyp5EMYxnzKJP3j8KdXE2+mCcoGrzdHCC0DAXTz/CSmFsx8G71xA==` |

## 存储不兼容边界

release 所称“不兼容”针对可选 `@deepseek-ai/dsh-session-persistence-sqlite`：rc.8 使用 schema 17，
会打包 chunk、Zstandard 压缩大 payload，并明确拒绝旧 schema、且不提供 migration。真实 probe 创建了含
session/event 的 rc.7 schema 15 数据库，rc.8 provider 明确以 15→17 不兼容拒绝，拒绝前后数据库字节
完全一致。npm 包源码与 README 还明确说明该 provider 是 opt-in，**没有 shipped composition 默认选择它**。

本项目托管 SDK / ACP profile 组合 `@deepseek-ai/dsh-base`，默认 session persistence 仍为 JSONL。真实 rc.8
probe 验证了同一 runtime 内的命名 session 续接；runtime 关闭后，SDK JSON-RPC server 对同名持久日志会明确
返回 `id collision`，当前协议没有跨进程 rehydrate API。bridge 已把该错误作为原生 binding 失效处理：清除
binding 后以自身 transcript 在新 session 继续，而不是把空上下文冒充恢复成功。升级器只重建托管 runtime
依赖与 overlay，不会寻找、打开或改写用户自定义 SQLite 数据库。自行挂载 SQLite provider 的自定义 profile
必须保留 rc.7 runtime 或自行导出/新建 schema 17 数据库；本项目不会把未知旧库冒充可迁移。

## 图片与流式语义

- rc.8 ACP runtime 的真实 initialize 当前仍**未声明** `promptCapabilities.image`。桥接继续 fail closed：
  有图片时不发送不受支持的 block，并显示明确错误；fake ACP protocol tests 保留 capability=true 时的
  PNG/JPEG/GIF/WebP 原生 base64 block 契约，以便上游真正开放后不需改桥接协议。
- rc.8 SDK client 的高层 `run()` 可接受 durable `ContentBlock[]`，但 SDK wire 没有把本地原始图片上传为
  runtime attachment ref 的 API。本项目因此明确把图片作为本地文件路径交给 filesystem/image tools，
  不声称像素已原生发送给模型。
- reasoning/text/tool/usage 翻译回归与真实 local OpenAI-compatible task probe 通过。取消后前缀进入后续
  prompt/fork 属于上游 session 行为；SDK 当前没有 prompt-level cancel，bridge stop 会关闭 runtime，故保留
  “中断后由 transcript fallback/新 runtime 继续”的既有边界，不伪造原生 cancel 验证。

## 自动与人工边界

自动：`pnpm compat:probe`（含 rc.7 SQLite fail-closed、真实 ACP task/permission）、adapter/runtime/upgrade
tests、仓库 lockfile peer graph 漂移检查、typecheck、build、publish bundle。人工发布前矩阵仍包括
真实 DeepSeek provider 的单图/超大图/历史多图、长 reasoning、
取消后续接/fork；本地 fixture 不能证明供应商服务端的图像压缩或 gateway 特定行为。
