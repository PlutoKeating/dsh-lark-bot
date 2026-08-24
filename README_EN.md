<h1 align="center">dsh-lark-bot</h1>

<p align="center">🌏 <a href="README.md">中文</a> · 🌐 Official wiki <a href="https://dsh-lark-bot.arr2018.dpdns.org">dsh-lark-bot.arr2018.dpdns.org</a></p>

<p align="center">
  <strong>Put DeepSeek Harness into Feishu</strong> · scan to connect in 30 s · drive your coding agent from your phone · Feishu still answers you if dsh crashes
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Feishu%20%2F%20Lark-3370FF" alt="Platform">
  <img src="https://img.shields.io/badge/agent-DeepSeek%20Harness-4D6BFE" alt="Agent">
  <img src="https://img.shields.io/badge/runtime-Node.js%20%E2%89%A5%2022-339933" alt="Node">
  <img src="https://img.shields.io/badge/License-AGPLv3-blue" alt="License">
  <img src="https://img.shields.io/badge/status-released-blue" alt="Status">
  <a href="https://dshfind.com/zh/plugins/PlutoKeating/dsh-lark-bot?ref=badge"><img src="https://dshfind.com/api/badge/PlutoKeating/dsh-lark-bot?lang=en" alt="dshfind"></a>
  <a href="https://dshbase.com/en/plugins/dsh-lark-bot"><img src="https://dshbase.com/badges/dsh-lark-bot.svg" alt="dshbase verified"></a>
  <a href="https://dsh-plugin.org/plugins/plutokeating/dsh-lark-bot"><img src="https://dsh-plugin.org/badges/listed.svg" alt="Listed on dsh-plugin.org"></a>
  <a href="https://github.com/PlutoKeating/dsh-lark-bot/releases"><img src="https://img.shields.io/github/v/release/PlutoKeating/dsh-lark-bot?sort=semver&label=latest%20release" alt="Latest release"></a>
</p>

## Overview

Make DeepSeek Harness a member of your Feishu/Lark and drive your local coding agent directly from phone, group, or thread. It uses a Feishu WebSocket long connection, so you need **no public IP, domain, server, or NAT-tunnelling**; Linux / macOS / Windows, Node.js ≥ 22.

---

## Quick start

**Prerequisites:** DeepSeek Harness (`dsh`) is installed with `DEEPSEEK_API_KEY` configured; Node.js ≥ 22.19; a Feishu / Lark account.

```bash
npx dsh-lark-bot@latest setup --profile dsh-lark   # ① one-command install (into a dsh profile + safety-net guardian by default)
dsh --profile dsh-lark                              # ② start
```

③ On first start the terminal prints a QR code → scan it with the Feishu app to create / select a PersonalAgent
app → once bound, message the bot directly; groups / threads default to `@bot`.

- **Already have an app**: skip the scan with `DSH_LARK_APP_ID=cli_xxx DSH_LARK_APP_SECRET=<secret> DSH_LARK_TENANT=feishu dsh --profile dsh-lark`.
- **Upgrade**: `npx dsh-lark-bot@latest upgrade --profile dsh-lark --yes`.

> **No terminal needed**: an admin just sends `/upgrade` in Feishu.

---

## Core capabilities

> **Strongest Feishu-only channel in the ecosystem**: among the DSH "channels & notify × Feishu" plugins, ours is the
> **most feature-complete** (a full 5.0/5.0 feature-completeness score), backed by `ARCHITECTURE.md` + `API.md`
> engineering docs. We don't chase multi-platform breadth (WeChat / DingTalk / QQ etc. is a different game) — instead
> we make **the Feishu channel the deepest, the most painless, and the most durable**.

- **Safety-net guardian** (**unique in the ecosystem**): Feishu still replies if dsh crashes; `/safemode` opens a core-only safe mode to self-heal — most bridges are "serial single chat + lost on crash".
- **Parallel tasks**: many tasks run concurrently in the same group with isolated sessions; others only queue serially.
- **Multi-role agents**: `/role` switches / assigns PM, dev, doc, etc., each with its own persona, model preference, and rules.
- **Multi-bot trusted hand-off**: `bot add` adds independent instances and trusted bots hand off with a real @ in the same group, capped.
- **Crash reconciliation**: messages write to a durable task ledger before queueing; restart restores queued items, `/jobs` retries explicitly.
- **Session archive & retention**: `/archive` + `/retention` auto-archive and clean up.
- **Cross-session notify + @**: a task finishing in group A can push to group B / DM and @ you.
- **In-chat model & key management**: one `/config` card to switch providers and hot-reload keys, without leaving Feishu.
- **Quick / balanced / deep mode**: `/mode` picks the strength for the next turn without interrupting the current task.
- **Plan gate for key tasks**: `lark_request_plan_approval` sends the full plan first, then approves or revises via a card.
- **dsh Web visual settings**: point-and-click work dir, model, concurrency, and reminders in Settings → Plugins.
- **In-Feishu self-update**: an admin `/upgrade` updates, verifies, and reloads; only nudges when a new version exists.

> Each session auto-creates an isolated git worktree project workspace; streaming process cards render in a native Feishu collapsible panel.

## Command reference

Command help, status, and cards are bilingual; `/help` is the full authoritative list. All commands are in [`docs/MANUAL.md`](docs/MANUAL.md).

| Command | What it does |
| --- | --- |
| `/config` | Model / provider / credential management card (`/model`, `/provider(s)`, `/key` are aliases of the same card) |
| `/new` `/reset` | Start a new session |
| `/status` | Status card (workspace / model / session / run / token / job ledger) |
| `/mode` (`/effort`) | Pick quick / balanced / deep strength |
| `/cd <path>` | Switch to an independent session in that directory |
| `/ws list\|save\|use\|remove` | Manage named workspaces |
| `/jobs [list\|show\|retry]` | Reconcile and retry queued/running/failed/interrupted jobs |
| `/session`、`/session bind` | Browse / explicitly bind a DSH session |
| `/role list\|show\|set\|clear` | View / bind roles |
| `/notify <scope\|chatId> <text>` | Cross-session notification (admin) |
| `/notifications [show\|off\|on …]` | Configure completion / failure / approval reminders |
| `/stop` | Stop current tasks |
| `/upgrade` | Self-update (admin) |
| `/doctor` | Generate a redacted diagnostic bundle (admin) |
| `/help` | Show the command list |

---

> **⚠️ Official channels only**: the only official repo is [PlutoKeating/dsh-lark-bot](https://github.com/PlutoKeating/dsh-lark-bot),
> and the only official npm packages are `dsh-lark-bot` / `dsh-feishu-bot` (maintainer `plutokeating`). This project
> **never ships a Windows .exe or a "download & run" installer** — any page or repo distributing one under its name
> is **fake / malicious**. The only official install command is `npx dsh-lark-bot@latest setup --profile dsh-lark`.
> See the Security notice below.

## FAQ

**Q: How do I connect DeepSeek Harness to Feishu?**
**A:** With Node ≥ 22 and dsh installed (and `DEEPSEEK_API_KEY` set), run `npx dsh-lark-bot@latest setup --profile dsh-lark`, then `dsh --profile dsh-lark` and scan the QR code. DM the bot directly; groups / threads default to `@bot`.

**Q: Do I need a public IP, domain, or server?**
**A:** No. Feishu uses a WebSocket long connection (outbound), so it works behind NAT — no public server, domain, or NAT-tunnelling.

**Q: How is this different from other DeepSeek Harness Feishu plugins?**
**A:** The most complete feature set: safety-net guardian, parallel tasks, multi-role agents, multi-bot hand-off, persistent job ledger, session archive, cross-session notify, dsh Web visual settings, in-chat model & key management, execution modes, plan gate, and in-Feishu self-update. It's a standard dsh profile bundle and `setup` is the only install path.

**Q: Could there be a fake version?**
**A:** The only official repo / npm packages are above under "Official channels only"; this project never ships an `.exe` or a "download & run" installer — anything distributing an exe is fake.

---

## Compatibility

- **DeepSeek Harness (`dsh`)**: verified against **0.1.0-rc.8** (2026-08-22) via the official `@deepseek-ai/dsh-sdk-client` / `dsh-acp`; locked versions & upgrade policy in [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md).
- **Runtime**: Node.js ≥ 22.19; **Platforms**: Linux / macOS / Windows. Default adapter `sdk` (native resume / streaming / image blocks); switchable to `acp` / `headless` / `web`.

## Configuration

- **Recommended**: local dsh Web → **Settings → Plugins → dsh-lark-bot** to view / edit service region, App ID, App Secret, work dir, default model, concurrency, adapter, and reminders; App Secret is write-only.
- Or use `/config`, `/providers`, `/provider`, `/key` in Feishu to inspect / write providers, models, and credentials (admin-only).
- Env vars use the `DSH_LARK_*` prefix; state root is `~/.dsh-lark`; template in [`.env.example`](.env.example); full env-var matrix in [`docs/MANUAL.md`](docs/MANUAL.md) §9.

> Behavior details (crash reconciliation, session isolation, plan gate, per-tool approval, multi-bot hand-off, safety-net guardian) are in [`docs/FEATURES.md`](docs/FEATURES.md);
> permissions & data in [`docs/MANUAL.md`](docs/MANUAL.md) §6 and [`SECURITY.md`](SECURITY.md).

## Security & licensing

- **License**: GNU AGPL-3.0 (see [`LICENSE`](LICENSE)). Open source and self-hostable, free for personal / internal use; **commercial / SaaS / closed-source reuse needs a separate license**.
- **Security**: default-deny, secret redaction, path containment, SSRF protection, stale-event rejection, interaction tools disabled by default — see [`SECURITY.md`](SECURITY.md); report vulnerabilities privately via GitHub Security Advisory.

## Upgrade & uninstall

```bash
npx dsh-lark-bot@latest upgrade --profile dsh-lark --yes   # upgrade (or admin /upgrade in Feishu)
```

- **Disable**: export `DSH_LARK_DISABLED=1` before starting the profile (plugin stays loaded, bridge engine stops).
- **Uninstall**: `dsh plugin --profile dsh-lark remove dsh-lark-bot`; local state (config / sessions / archives / roles) stays in `~/.dsh-lark`.

---

## About the project

- **Development**: `pnpm install && pnpm typecheck && pnpm test && pnpm build`; delivery standards in [`docs/ECOSYSTEM.md`](docs/ECOSYSTEM.md), AI-agent workflow in [`AGENTS.md`](AGENTS.md). Dual-package publish `pnpm publish:dual` (`dsh-lark-bot` + `dsh-feishu-bot`, shared dist).
- **Author**: **PlutoKeating** ([profile](https://github.com/PlutoKeating)).
- **Contributors**: [zhuguangjun2002](https://github.com/zhuguangjun2002) · [chensimo1992-sys](https://github.com/chensimo1992-sys) · [estelledc](https://github.com/estelledc) · [fredjiangyysx](https://github.com/fredjiangyysx) · [Geoffrey-hougaojie](https://github.com/Geoffrey-hougaojie) · [hellxiaoao](https://github.com/hellxiaoao) · [koprivnikarurnaa-oss](https://github.com/koprivnikarurnaa-oss) · [Normanyin](https://github.com/Normanyin) · [pancong0711](https://github.com/pancong0711) · [qvivp](https://github.com/qvivp).
- **Docs**: `QUICK_START` (install / quick start) · `MANUAL` (full manual + commands + env vars) · `FEATURES` (capability behavior) · `COMPATIBILITY` · `ARCHITECTURE` · `API` · `roadmap`.

## Community & ecosystem

| Platform | Status |
| :--- | :--- |
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | ✅ listed ([#1408](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/1408)) |
| [awesome-dsh-plugins](https://github.com/AdamPlatin123/awesome-dsh-plugins) | ✅ listed · runtime-verified |
| [dshfind](https://dshfind.com/zh/plugins/PlutoKeating/dsh-lark-bot) | ✅ listed |
| [dshbase](https://dshbase.com/zh/plugins/dsh-lark-bot) | ✅ listed · install-verified |
| [dsh-plugin.org](https://dsh-plugin.org/zh/plugins/plutokeating/dsh-lark-bot) | ✅ listed · official source verified |
| [omdsh-dev/community](https://github.com/orgs/omdsh-dev/discussions/11) | ✅ accepted · active |

## Security notice

> On 2026-08-17 a fake repo **`tarraencompassing61/dsh-lark-bot`** was found: a non-fork re-upload, 113 of 114
> commits authored as PlutoKeating, all CI removed, Issues closed, 0 Releases, yet posing as the official
> distribution with a "download Windows exe & run" README. **This project never ships an exe; any such download is fake / malicious.**
>
> Evidence archive: [`docs/security/2026-08-17-impostor-repo-evidence/`](docs/security/2026-08-17-impostor-repo-evidence/README.md) ·
> Official download channel: [`docs/DOWNLOAD.md`](docs/DOWNLOAD.md) · Ongoing monitor: `pnpm security:monitor`.

## Disclaimer

> This is an unofficial community tool, unaffiliated with and not endorsed by DeepSeek or ByteDance / Feishu (Lark). DeepSeek Harness, Feishu / Lark, and related trademarks belong to their respective owners.
