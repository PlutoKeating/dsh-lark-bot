---
状态: DRAFT · 未授权不发布
建议编号: #41（占位，实际以创建时为准）
---

# 标题

`decision: npm 相似包名保护性占位包决策`

# 正文

## 背景

监控脚本 `NPM_TYPOS` 清单当前 10 个相似包名**均未注册**（2026-08-17 实测）：

`dsh-larkbot` / `dsh-lark-bot2` / `dsh-lark-bot-cli` / `dsh-lark-bot-latest` /
`dsh-lark-bot-core` / `dsh-lark-bot-beta` / `dsh-lark-bot-ts` / `dsh-lark-bot-node` /
`dsh-feishubot` / `dsh-feishu-bot-latest`

## 选项

1. **注册保护性占位包**：每个包发布最小 README，声明“非官方包，官方包为 `dsh-lark-bot`”，
   防止被抢注后用于仿冒分发。注意 npm 政策：占位包需有真实、非误导性内容
2. **仅监控不注册**：保持现状，脚本已覆盖，出现抢注立即告警
3. **只保护最高风险的 3–5 个**（最像 typo 的：`dsh-larkbot`、`dsh-lark-bot2`、`dsh-lark-bot-cli` 等）

## 待决策

- 方案（1 / 2 / 3）与注册账号（建议独立于 `plutokeating` 的专用账号，或直接 `plutokeating`）
- 占位包 README 模板（防误导措辞，指向官方包名与仓库）

## 验收

- 决策后按方案执行；README 模板符合 npm 政策且明确指向官方包

---

> 本文由 **PlutoKeating** 指导与审核，使用 **dsh-lark-bot** 发布。
