<h1 align="center">dsh-lark-bot</h1>

<p align="center">🌏 中文版：[README.md](README.md)</p>

<p align="center">
  <strong>Put DeepSeek Harness into Feishu / Lark</strong> · scan to connect in 30 s · drive your local coding agent from your phone
</p>

<p align="center">
  <strong>⚡ The only bridge that still answers you if dsh crashes</strong>
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
  <a href="https://github.com/PlutoKeating/dsh-lark-bot/commits/main"><img src="https://img.shields.io/github/commits-since/PlutoKeating/dsh-lark-bot/v0.7.0?label=commits%20since%20v0.7.0" alt="Commits since v0.7.0"></a>
</p>

<p align="center">
  🌐 Landing page <a href="https://dsh-lark-bot.arr2018.dpdns.org">dsh-lark-bot.arr2018.dpdns.org</a>
  · mirror <a href="https://plutokeating.github.io/dsh-lark-bot/">GitHub Pages</a>
</p>

> **✅ In one line:** make **DeepSeek Harness** a member of your Feishu/Lark — drive your local coding agent
> from phone, group, or thread, and bring conversations, tasks, cards, and **project workspaces** into one
> collaboration flow. **Keywords:** `deepseek harness feishu` · `deepseek harness lark` · `dsh lark bridge` ·
> `deepseek harness plugin` · `control deepseek harness from your phone`.

> **⚠️ Official channels only:** the only official repo is [PlutoKeating/dsh-lark-bot](https://github.com/PlutoKeating/dsh-lark-bot),
> and the only official npm packages are `dsh-lark-bot` / `dsh-feishu-bot` (maintainer `plutokeating`). This
> project **never ships a Windows .exe or a "download & run" installer** — any page or repo distributing an
> exe / "double-click to run" under its name is **fake / malicious**. The only official install command is
> `npx dsh-lark-bot@latest setup --profile dsh-lark`. Forensics & full statement: the section `Impostor Repository Warning` below.

---

## What it is (a directly quotable answer for AEO / GEO)

- **What is it**: an **open-source bridge plugin** that connects DeepSeek Harness (`dsh`) to Feishu / Lark. Scan-and-go.
- **How to connect**: install, launch, scan the QR code once. It uses a **Feishu WebSocket outbound long connection**, so you need **no public IP, domain, server, or NAT-tunnelling**.
- **Why choose it**: the most **complete** Feishu feature set — streaming cards, project workspaces, parallel tasks, multi-role agents, multi-bot hand-off, crash-persistent job ledger, in-chat model/key management, plan gating, in-Feishu self-update, and the only **safety-net guardian** that still answers you if dsh goes down.
- **Is it free**: open source and self-hostable; free for personal / internal use (GNU AGPL-3.0; commercial / SaaS / closed-source reuse needs a separate licence).

---

## Get started in 30 seconds

**Prerequisites:** DeepSeek Harness (`dsh`) is installed on your machine with `DEEPSEEK_API_KEY` configured; Node.js ≥ 22.19; a Feishu / Lark account. dsh is the agent itself; this plugin is its remote control.

```bash
# ① One-command install (no prior global install; installs into a dsh profile and installs the safety-net guardian by default)
npx dsh-lark-bot@latest setup --profile dsh-lark

# ② Start
dsh --profile dsh-lark
```

③ On first start the terminal prints a QR code → scan it with the Feishu / Lark app to create or select a
PersonalAgent app → once bound, message the bot directly; in groups / threads it defaults to `@bot`, with an
optional allowlist-protected no-@ mode.

> [!IMPORTANT]
> **The one step that makes buttons work:** card buttons (plan gate / approval / question) follow the Card JSON 2.0
> `behaviors.callback` protocol; the scan wizard explicitly requests the `card.action.trigger` callback capability.
> If your app was created by an older wizard, enable the **card callback** in Feishu Open Platform → **Events & Callbacks → Callback config** and **re-publish**, otherwise messages flow but button clicks never reach the bot.

`setup` does everything for you: locate your local dsh → pre-approve the pnpm build policy → run the standard
`dsh plugin add` → install the «safety-net guardian» system service by default.

- **No public IP / domain / server / NAT-tunnelling** (Feishu WebSocket outbound connection); Linux / macOS / Windows.
- **If you already have a PersonalAgent app** you can skip the scan: `DSH_LARK_APP_ID=cli_xxx DSH_LARK_APP_SECRET=<secret> DSH_LARK_TENANT=feishu dsh --profile dsh-lark`.
- **If you globally installed `dsh-lark-bot`**, `setup` is equivalent to `dsh-lark-bot setup` (the `npx` path needs no global install).
- **Upgrade** with one command: `npx dsh-lark-bot@latest upgrade --profile dsh-lark --yes`; or have an admin send `/upgrade` inside Feishu.

---

## What you get (12 unique capabilities at a glance)

| # | Capability | One-liner |
| --- | --- | --- |
| 🆘 | **Safety-net guardian** | Feishu still answers you if dsh crashes; `/safemode` opens a core-only safe mode to self-heal — **unique in the ecosystem** |
| ⚡ | **Parallel tasks** | Many tasks run concurrently in the same group with isolated sessions; others only queue serially |
| 👥 | **Multi-role agents** | `/role` switches / assigns PM, dev, doc, etc., each with its own persona, model preference, and rules |
| 🤝 | **Multi-bot hand-off** | `bot add` adds independent instances; trusted bots hand off with a real @ in the same group, capped |
| 🧾 | **Crash reconciliation** | Messages write to a durable job ledger before queueing; restart restores queued items, `/jobs` retries explicitly |
| 🗂 | **Session archive & cleanup** | `/archive` archives, `/retention` configures the auto-retention policy |
| 📣 | **Cross-session notify + @** | A task finishing in group A can push to group B / DM and @ you |
| ⚙️ | **dsh Web visual settings** | Point-and-click app, work dir, model, concurrency, and reminders in official Settings → Plugins |
| 🔑 | **In-chat model & key management** | One `/config` card to view / switch providers and hot-reload keys, without leaving Feishu |
| 🎚️ | **Quick / balanced / deep mode** | `/mode` persists per scope; applies next turn without interrupting the current task |
| 🔄 | **In-Feishu self-update** | Admin `/upgrade` updates, verifies, and reloads; `/new` only nudges when a new version exists |
| 🧭 | **Plan gate for key tasks** | `lark_request_plan_approval`: the full plan is sent first, then approved or revised via a card |

+ Each session auto-creates an isolated git worktree project workspace; streaming process cards render in a native
Feishu collapsible panel; the final answer is sent as its own message.

## Common commands (high-frequency first; `/help` is the full authoritative list)

Command help, status, error messages, and bot-owned cards are bilingual (Chinese / English). Card JSON 2.0 uses native
`i18n_content` so the same shared card shows per-reader language; Markdown / toast and older clients show both languages;
agent answers and user input stay as-is.

| Command | What it does |
| --- | --- |
| `/new` `/reset` | Start a new session |
| `/config` | **Model / Provider / Credential management card** (`/model`, `/provider(s)`, `/key` are aliases of the same card) |
| `/status` | Refreshable status card (workspace / model / session / run / context / token / pending / job ledger) |
| `/mode` (alias `/effort`) | Pick quick / balanced / deep execution (applies next turn) |
| `/cd <path>` | Switch to an independent session in that directory |
| `/ws list\|save\|use\|remove` | Manage named workspaces |
| `/jobs [list\|show\|retry]` | Reconcile and explicitly retry queued/running/failed/interrupted jobs |
| `/session`、`/session bind` | Browse / explicitly bind a DSH session (`web` adapter) |
| `/role list\|show\|set\|clear` | View / bind roles |
| `/notify <scope\|chatId> <text>` | Send a cross-session notification (admin) |
| `/notifications [show\|off\|on …]` | Configure completion / failure / approval reminders |
| `/stop` | Stop current tasks |
| `/upgrade` | Check and self-update via the Guardian backend (admin) |
| `/doctor` | Generate and send a redacted diagnostic bundle (admin) |
| `/help` | Show the authoritative command list for this version |

> More commands (`/newg` `/ws` `/timeout` `/permission` `/isolation` `/archive` `/density` `/replies` `/retention`
> `/invite` `/ask` `/language` `/secret` `/safemode` …) are in [`docs/MANUAL.md`](docs/MANUAL.md). The
> model/provider/credential **text subcommands** (`/model use|default|add|remove`, `/provider add|update|remove`,
> `/key set|remove|list`, `/secret status|set|remove`) are the fallback for card-less / headless environments and
> for scripted / admin use — see [`docs/MANUAL.md`](docs/MANUAL.md).

---

## FAQ

**Q: How do I connect DeepSeek Harness to Feishu?**
**A:** With Node.js ≥ 22 and dsh installed (and `DEEPSEEK_API_KEY` set), run
`npx dsh-lark-bot@latest setup --profile dsh-lark`, then `dsh --profile dsh-lark` and scan the QR code. DM the
bot directly; groups / threads default to `@bot`.

**Q: Do I need a public IP, domain, or server?**
**A:** No. The Feishu channel uses a WebSocket long connection (outbound), so it works behind NAT — no public
server, domain, or NAT-tunnelling required.

**Q: How is this different from other DeepSeek Harness Feishu plugins (e.g. harness-lark)?**
**A:** The most complete feature set: safety-net guardian / multi-role agents / multi-bot trusted hand-off / parallel
tasks / persistent job ledger / session archive / cross-session active notify / dsh Web visual settings / in-chat
model & key management / execution modes / plan gate / in-Feishu self-update. It's a standard dsh profile bundle and
`setup` is the only install path; optional `service install` just hands the same profile to the OS for persistence —
it is not a second runtime.

**Q: Where do I download the project? Could there be a fake version?**
**A:** The only official repo is [github.com/PlutoKeating/dsh-lark-bot](https://github.com/PlutoKeating/dsh-lark-bot),
and the only official npm packages are `dsh-lark-bot` / `dsh-feishu-bot` (maintainer `plutokeating`). This project
never ships an .exe or a "download & run" installer; any repo or page distributing an exe under its name is fake
(see the Impostor Repository Warning below).

---

## Compatibility

- **DeepSeek Harness (`dsh`)**: verified against **dsh 0.1.0-rc.8** (last verified 2026-08-22) via the official
  `@deepseek-ai/dsh-sdk-client` / `@deepseek-ai/dsh-acp`; locked versions, upgrade policy, and automation are in
  [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md).
- **Runtime**: Node.js ≥ 22.19; **Platforms**: Linux / macOS / Windows.
- **Adapters**: the official **`@deepseek-ai/dsh-sdk-client`** by default (native session resume, token-level
  streaming, attachment image blocks); `DSH_LARK_ADAPTER=acp` for the official ACP server (protocol-native approval);
  `headless` is the legacy child-process fallback; `web` drives the local dsh web agent (single-writer).

## Known limitations

- ACP mode sessions are fresh each time (upstream constraint, no resume); the SDK protocol has no mid-turn cancel,
  so stopping closes that run's isolated runtime and rebuilds it. The SDK only resumes a native session while the
  current bridge process still holds the same live runtime; after restart / stop / model switch it creates a new
  session and replays the bridge transcript.
- The bridge engine runs inside the dsh process; agent execution uses the official SDK runtime subprocess (a
  deliberate nesting for per-scope + per-workspace cancellation domains and parallel runs). The only process-level
  exception is the default-installed safety-net guardian.
- Feishu document comments and rich-text replies are planned, not yet implemented.
- The pnpm ≥ 10 build-script policy is handled by `setup`; for manual `dsh plugin add` with `ERR_PNPM_IGNORED_BUILDS`,
  add `allowBuilds: { protobufjs: true }` to the profile's `pnpm-workspace.yaml`.

## Configuration overview

Open your local dsh Web → **Settings → Plugins → dsh-lark-bot** to view / edit service region, App ID, App Secret,
work directory, default model, per-session concurrency, adapter, and default reminders. App Secret is write-only and
not echoed; changes hot-apply per item, connection settings restart a generation safely. If the Web settings service
is unavailable, the Feishu commands and env vars below still work.

- Local config: `~/.dsh-lark/config.json`; override the state root with `DSH_LARK_HOME`; env vars use the `DSH_LARK_*` prefix.
- Secrets (`DSH_LARK_APP_SECRET`, `DEEPSEEK_API_KEY`, …) live only in local config / env; logs and cards redact them; the repo only commits the [`.env.example`](.env.example) template.

Core env vars (full table in [`.env.example`](.env.example) and [`docs/MANUAL.md`](docs/MANUAL.md) §9):

| Variable | Default | Notes |
| :--- | :--- | :--- |
| `DSH_LARK_TENANT` | `feishu` | `feishu` or `lark` |
| `DSH_LARK_WORKSPACE` | unset | default work dir for new sessions |
| `DSH_LARK_ADAPTER` | `sdk` | `sdk` / `acp` / `headless` / `web` |
| `DSH_LARK_MODEL` | unset | default model; also satisfied by `agent-default-model` |
| `DSH_LARK_SCOPE_CONCURRENCY` | `2` | parallel tasks per scope (`1` = strictly serial) |
| `DSH_LARK_RUN_TIMEOUT_MS` | `300000` | idle timeout per run (active tasks are not killed) |
| `DSH_LARK_RETENTION_MSGS` | `40` | retained live messages per scope + workspace |
| `DSH_LARK_GROUP_NO_AT` | `false` | process allowlisted real-time no-@ messages and poll registered groups |
| `DSH_LARK_PLAN_GATE` | `strict` | `off` disables the standalone plan gate (per-tool approval still runs) |

When working in a Git repo, a per-scope isolated worktree is auto-created at
`~/.dsh-lark/profiles/<profile>/worktrees/<scope-slug>-<path-hash>/` and the project's `AGENTS.md` copied in;
on upgrade the old worktree's owning repo is verified and migrated in place, preserving branches and uncommitted files.

> Full env-var matrix, permissions, diagnostics, troubleshooting, and deep behavioral notes:
> [`docs/MANUAL.md`](docs/MANUAL.md) · [`docs/FEATURES.md`](docs/FEATURES.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/API.md`](docs/API.md) · [`SECURITY.md`](SECURITY.md).

---

## Permissions & data

Runs on your machine. Summary (full version in [`docs/MANUAL.md`](docs/MANUAL.md) §6 and [`SECURITY.md`](SECURITY.md)):

- **Feishu credentials**: the PersonalAgent `app_id` / `app_secret` are stored in local `~/.dsh-lark/config.json` (0600).
- **Multi-bot identity & messages**: `fleet.json` / `handoffs.json` (0600) store instance and hand-off metadata, not keys.
- **Filesystem / network**: reads/writes the dirs you give via `/cd` / `/ws`; opens a WebSocket outbound connection to Feishu Open Platform and sends task context to the DeepSeek API.
- **Diagnostic bundle**: `/doctor` generates a redacted Markdown file uploaded to the original chat / thread; it does not include App ID/Secret, credential values, message bodies, or session transcripts.
- **Config reads/writes**: `/config`, `/providers`, `/provider`, `/key` use the official dsh storage protocol against `~/.dsh/settings.yaml` and `~/.dsh/.credentials.yaml` (admin-only writes; settings store only the `apiKeyEnv` reference, never literal keys).
- **Safety-net guardian**: installed by default with `setup`; reads Feishu credentials and, when dsh is down, takes over the channel and scans local processes (only `ps`, never reads memory).
- All data flows only between your machine, Feishu, and DeepSeek — no telemetry collected or uploaded. Secrets never enter the repo (see [`.gitignore`](.gitignore)).

## Troubleshooting

Run `dsh-lark-bot doctor` for a real availability probe; without a terminal, an admin sends `/doctor` for a redacted
diagnostic bundle. Common issues:

- **Bot silent / long-connection failure**: `service status` + `service logs -f` (foreground: check stderr); the SDK auto-reconnects and nudges the most recent active session. System sleep blocks message delivery.
- **Agent not responding**: send `/status` for scope / cwd / active runs; `/stop` to terminate; past `DSH_LARK_RUN_TIMEOUT_MS` the watchdog terminates (idle timeout).
- **First-scan failure**: confirm local time is accurate and the Feishu Open Platform is reachable; with an App ID/Secret use `--app-id` / `--app-secret` to skip the scan.

**Rollback**: `dsh plugin --profile dsh-lark remove dsh-lark-bot` then reinstall a pinned version (e.g. `dsh-lark-bot@0.6.0`);
`~/.dsh-lark` state is independent of the plugin, so upgrade / rollback never loses config or sessions. See [`docs/QUICK_START.md`](docs/QUICK_START.md).

---

## Upgrade, disable & uninstall

**Upgrade (recommended one-liner)**

```bash
npx dsh-lark-bot@latest upgrade --profile dsh-lark --yes
```

Or without touching a terminal: the profile admin sends `/upgrade` in Feishu and the Guardian backend updates, fixes
runtime profiles, restarts, and verifies before reporting back. `--check` only reports versions / run state (no
changes); `--restart` restarts the guardian and managed profile after upgrade; `--rollback` reinstalls the previously
recorded version; `--no-guardian` skips the guardian upgrade.

- You can also re-run `setup` to pull the latest; the CLI can be installed with `npm i -g dsh-lark-bot@latest` (`npx` needs no global install).

**Disable**: export `DSH_LARK_DISABLED=1` before starting the profile (keeps the plugin loaded but stops the bridge engine).

**Uninstall**

```bash
dsh plugin --profile dsh-lark remove dsh-lark-bot
```

The profile no longer loads the plugin; local state (config / sessions / archives / roles) stays in `~/.dsh-lark` —
back it up and delete it if you want it gone. See [`docs/QUICK_START.md`](docs/QUICK_START.md).

---

## Keywords

`dsh` · `deepseek` · `deepseek harness` · `deepseek harness feishu` · `deepseek harness lark` · `feishu` · `lark` · `bridge` · `bot` · `chatbot` · `messaging` · `qrcode` · `typescript` · `feishu-bot` · `lark-bot` · `dsh-plugin` · `deepseek-harness` · `im-bridge` · `ai-agent` · `workspace` · `self-healing` · `remote-coding`

## License & security

- **Licence**: GNU Affero General Public License v3.0 (see [`LICENSE`](LICENSE)). **Licence note**: open source and
  self-hostable, free for personal / internal use; **commercial / SaaS / closed-source reuse needs a separate licence**.
- **Copyright**: the source is © the project maintainer, licensed AGPL-3.0; "DeepSeek", "Feishu / Lark" are trademarks of their owners.
- **Security reports**: privately via GitHub Security Advisory, not a public issue. The security model (default deny, secret redaction, path containment, SSRF protection, stale-event rejection, interaction tools disabled by default) is in [`SECURITY.md`](SECURITY.md).

## More (development / author / contributors / structure / roadmap / references)

- **Development**: see [`docs/ECOSYSTEM.md`](docs/ECOSYSTEM.md) (delivery standards) and [`AGENTS.md`](AGENTS.md) (AI-agent workflow); build with `pnpm install && pnpm typecheck && pnpm test && pnpm build`; publish with `pnpm publish:dual` (dual npm packages `dsh-lark-bot` + `dsh-feishu-bot`, same dist).
- **Architecture**: Feishu/Lark ─WebSocket→ `bridge/` → `session/` → `workspace/` → `adapters/` → `dsh` → DeepSeek. The core idea is decoupling the Feishu channel from the agent backend; see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- **Structure**: `src/bridge/` (Feishu channel) `src/onboard/` (scan binding) `src/session/` (routing) `src/workspace/` (git worktree isolation) `src/adapters/` (sdk/acp/headless/web) `src/card/` (streaming cards & Card 2.0 i18n) `src/bot/` (run registry & policy) `src/commands/` (slash commands) `src/cli/` (setup/upgrade/service/bot) `src/guardian/` (safety-net guardian).
- **Author**: **PlutoKeating**, focused on automation & developer tools ([profile](https://github.com/PlutoKeating)). Thanks to [koprivnikarurnaa-oss](https://github.com/koprivnikarurnaa-oss) (web single-writer + self-heal v2 + guardian auto-restart) and [Normanyin](https://github.com/Normanyin) (`/newg`).
- **Roadmap**: [`docs/roadmap.md`](docs/roadmap.md); **References**: `zarazhangrui/lark-coding-agent-bridge` · `deepseek-ai/deepseek-harness` · `grinev/opencode-telegram-bot`.

## Documentation index

To take over this project, start with [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) and [`docs/RESEARCH.md`](docs/RESEARCH.md).
Others: `QUICK_START` (install / quick start) · `MANUAL` (full manual + commands + env vars) · `FEATURES` (deep capability notes) ·
`COMPATIBILITY` (compat matrix & upgrade policy) · `ADAPTER_NOTES` (adapter integration) · `UPGRADE` (update-path architecture) ·
`ECOSYSTEM` (delivery standards) · `ARCHITECTURE` · `API` · `PLAN` · `roadmap`.

## Community listings

<div align="center">
<a href="https://dshfind.com/zh/plugins/PlutoKeating/dsh-lark-bot?ref=badge"><img src="https://dshfind.com/api/card/PlutoKeating/dsh-lark-bot?lang=en" alt="dshfind" width="440"></a>
</div>

As of v0.15.9 (reviewed 2026-08-20):

| Platform | Status | Notes |
| :--- | :--- | :--- |
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | 📨 listing PR submitted · pending | 7.2k+ star community select list (`dsh-plugin` ecosystem traffic) — PR [#1408](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/1408) |
| [awesome-dsh-plugins](https://github.com/AdamPlatin123/awesome-dsh-plugins) | ✅ listed · runtime-verified | marked `✅ runtime-verified`; v0.15.1 refresh [PR #230](https://github.com/AdamPlatin123/awesome-dsh-plugins/pull/230) pending |
| [dshfind](https://dshfind.com/zh/plugins/PlutoKeating/dsh-lark-bot) | ✅ listed | top badge / card from dshfind |
| [dshbase](https://dshbase.com/zh/plugins/dsh-lark-bot) | ✅ listed · install-verified | Chinese plugin directory; CI verified install & start |
| [dsh-plugin.org](https://dsh-plugin.org/zh/plugins/plutokeating/dsh-lark-bot) | ✅ listed · official source verified | platform removed a name-squatting parasitic entry |
| [omdsh-dev/community](https://github.com/orgs/omdsh-dev/discussions/11) | ✅ accepted · active | org-level discussion update pending manual paste |

Full update-request progress & history is in [`docs/MARKETING.md`](docs/MARKETING.md).

## Impostor Repository Warning

> On 2026-08-17 a fake repo **`tarraencompassing61/dsh-lark-bot`** was found: a non-fork re-upload, 113 of 114
> commits authored as PlutoKeating, all CI removed, Issues closed, 0 Releases, yet posing as the official
> distribution with a "download Windows exe & run" SEO-bait README. **This project never ships an exe; any such
> download is fake / malicious.**
>
> Evidence archive: [`docs/security/2026-08-17-impostor-repo-evidence/`](docs/security/2026-08-17-impostor-repo-evidence/README.md) ·
> Official download channel: [`docs/DOWNLOAD.md`](docs/DOWNLOAD.md) · Ongoing monitor: `pnpm security:monitor`.

## Disclaimer

> This is an unofficial community tool, unaffiliated with and not endorsed by DeepSeek or ByteDance / Feishu (Lark).
> DeepSeek Harness, Feishu / Lark, and related trademarks belong to their respective owners.
