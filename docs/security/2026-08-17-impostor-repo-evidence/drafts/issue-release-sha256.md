---
状态: 已发布 · https://github.com/PlutoKeating/dsh-lark-bot/issues/39
建议编号: #39
---

# 标题

`chore(release): 发布资产 SHA-256 校验文件落地（SECURITY.md 承诺执行）`

# 正文

## 背景

SECURITY.md 已承诺：自 2026-08-17 文档更新后的**下一个 Release 起**，每个发布资产随附
`<asset>.sha256` 校验文件；docs/DOWNLOAD.md 已写入校验方法。本 issue 负责把承诺落实到发布流水线。

## 任务

- [ ] `scripts/publish-dual-packages.mjs`（或 release.yml 步骤）：生成
  `dsh-lark-bot-<ver>.tgz` / `dsh-feishu-bot-<ver>.tgz` 后，为每个资产生成同名 `.sha256` 文件并随 Release 上传
- [ ] GitHub Packages 发布产物（如适用）同步生成校验文件
- [ ] README / docs/DOWNLOAD.md 的校验命令与示例与 Release 资产保持同步
- [ ] 本地验证：`shasum -a 256 <资产>` 输出与 `.sha256` 内容一致

## 验收

- 下一个 Release 的 assets 列表包含两个 `.sha256` 文件，内容与实际哈希一致
- `docs/DOWNLOAD.md` 的校验步骤可直接照做通过

## 参考

- SECURITY.md「官方分发渠道 · Official distribution channels」
- docs/DOWNLOAD.md「Release 资产说明」

---

> 本文由 **PlutoKeating** 指导与审核，使用 **dsh-lark-bot** 发布。
