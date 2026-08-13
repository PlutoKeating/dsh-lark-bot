# reference/ · 参考研究目录

本目录专门存放**用于研究和参考的克隆仓库、上游源码与文档**，不属于本项目的构建产物，也不会被提交到 git（见 `reference/.gitignore`）。

This directory holds **cloned reference repositories, upstream source and documents for study only**. They are not part of this project's build and are never committed (see `reference/.gitignore`).

## 计划克隆 · Planned clones

| 仓库 Repo | 用途 Purpose |
| :--- | :--- |
| [`zarazhangrui/lark-coding-agent-bridge`](https://github.com/zarazhangrui/lark-coding-agent-bridge) | 飞书 ↔ coding agent 桥接的参考实现（本项目的直接参照） |
| [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) | DeepSeek Harness 上游源码（`dsh`，agent 后端） |
| [`grinev/opencode-telegram-bot`](https://github.com/grinev/opencode-telegram-bot) | IM 桥接 bot 的另一个参考实现 |

> 克隆命令示例 · Example clone command:
> ```bash
> git clone --depth 1 https://github.com/zarazhangrui/lark-coding-agent-bridge.git
> git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git
> ```
