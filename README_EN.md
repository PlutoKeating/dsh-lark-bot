> **⚠️ Official channels only:** The only official repository is [PlutoKeating/dsh-lark-bot](https://github.com/PlutoKeating/dsh-lark-bot); the only official npm packages are `dsh-lark-bot` (with the twin package `dsh-feishu-bot`, maintainer `plutokeating`). **This project never ships Windows executables (.exe) or any "download-and-run" installer.** Any page, repository, or third-party channel offering executables under this project's name is a **counterfeit / malicious source** — do not download or run anything from it. The only official install command: `npx dsh-lark-bot@latest setup --profile dsh-lark`. Evidence and the full statement live in the "Impostor Repository Warning" section below and [docs/security/2026-08-17-impostor-repo-evidence/](docs/security/2026-08-17-impostor-repo-evidence/README.md).

<h1 align="center">dsh-lark-bot</h1>

<p align="center">🌏 中文版 / Chinese version：[README.md](README.md)</p>

<p align="center">
  <strong>Bridge DeepSeek Harness into Feishu / Lark</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Feishu%20%2F%20Lark-3370FF" alt="Platform">
  <img src="https://img.shields.io/badge/agent-DeepSeek%20Harness-4D6BFE" alt="Agent">
  <img src="https://img.shields.io/badge/runtime-Node.js%20%E2%89%A5%2022-339933" alt="Node">
  <img src="https://img.shields.io/badge/License-AGPLv3-blue" alt="License">
  <img src="https://img.shields.io/badge/status-released-blue" alt="Status">
  <a href="https://dshfind.com/zh/plugins/PlutoKeating/dsh-lark-bot?ref=badge"><img src="https://dshfind.com/api/badge/PlutoKeating/dsh-lark-bot?lang=zh" alt="dshfind"></a>
  <a href="https://dshbase.com/zh/plugins/dsh-lark-bot"><img src="https://dshbase.com/badges/dsh-lark-bot.svg" alt="dshbase verified"></a>
  <a href="https://github.com/PlutoKeating/dsh-lark-bot/releases"><img src="https://img.shields.io/github/v/release/PlutoKeating/dsh-lark-bot?sort=semver&label=latest%20release" alt="Latest release"></a>
  <a href="https://github.com/PlutoKeating/dsh-lark-bot/commits/main"><img src="https://img.shields.io/github/commits-since/PlutoKeating/dsh-lark-bot/v0.7.0?label=commits%20since%20v0.7.0" alt="Commits since v0.7.0"></a>
</p>

<br>

<div align="center">

Turn **DeepSeek Harness (`dsh`)** into a member of your Feishu / Lark workspace — drive your local coding agent from mobile, group chats and topics, and fold conversations, tasks, cards and **project workspaces** into one collaborative flow.

</div>

<p align="center">
  🌐 Landing page <a href="https://dsh-lark-bot.arr2018.dpdns.org">dsh-lark-bot.arr2018.dpdns.org</a>
  · Backup <a href="https://plutokeating.github.io/dsh-lark-bot/">GitHub Pages</a>
</p>

---

## The Problem

Tired of being chained to your desk to drive DeepSeek Harness? dsh runs on your local machine, so checking progress and adjusting tasks means going back to your computer; once you leave your desk, a run can stall, drift, or dsh itself can crash without you ever hearing about it — until you come back and find you wasted hours.

dsh-lark-bot puts the remote control in your Feishu: drive your local dsh coding agent from DMs, group chats and topics, with streaming cards showing reasoning and tool calls in real time; get proactive notifications pushed to any chat you're in with @mentions when tasks finish; and even when dsh crashes, Feishu still answers — send `/safemode` to enter core-only safe mode and locate the problem and restart the engine right from the chat. **It is the only bridge where you never lose contact when dsh goes down.**

## What you get

**Core**:

- Drive your local dsh coding agent from private chats, group chats and threads; images / text files can be sent straight to the bot;
- Streaming cards showing reasoning, tool calls and results in real time, with interactive buttons (stop / approval / question cards);
- Automatic session archival and retention policies; per-session isolated git worktrees inside Git repositories, so multiple projects never interfere with each other.

**Six exclusive capabilities**:

- 🆘 **Guardian safety net — "always reachable"**: Feishu still replies after dsh crashes; `/safemode` enters core-only safe mode to locate the problem and restart directly.
- 👥 **Multi-role agents — "one bot, a whole team"**: switch or assign PM / dev / docs roles with `/role`; each role has its own persona, model preference and rules.
- ⚡ **Parallel tasks — "no queueing"**: run multiple tasks in the same chat simultaneously with isolated sessions; other solutions serialize everything.
- 🗂 **Session archival & cleanup — "your session list never rots"**: archive old tasks with `/archive` and configure auto-retention with `/retention`.
- 📣 **Cross-session proactive notifications + @mentions — "it comes to you when done"**: after a task in chat A finishes, push a report to chat B / DMs and @mention you.
- 🔑 **In-chat model & key management — "never leave Feishu"**: `/providers` `/provider` `/key` to view, switch vendors and hot-update keys.

## Quick Start

**Prerequisites (install the engine first, then the remote)**:

1. **DeepSeek Harness (`dsh`) installed with `DEEPSEEK_API_KEY` configured** — dsh-lark-bot is a dsh plugin; dsh is the local agent engine and cannot be skipped;
2. **Node.js ≥ 22.19** (see `engines` in `package.json`) and a Feishu / Lark account.

**Three steps**:

```bash
# ① One-command install (no prior global install; installs into a dsh profile and installs the safety-net guardian by default)
npx dsh-lark-bot@latest setup --profile dsh-lark

# ② Start
dsh --profile dsh-lark
```

③ On first boot the terminal prints a QR code → scan it with the Feishu / Lark app to create or choose a PersonalAgent app → after binding, DM the bot directly or use `@bot` in groups/topics.

`setup` automatically: locates your local dsh → pre-approves pnpm's build policy (protobufjs) → runs the standard `dsh plugin --profile dsh-lark add dsh-lark-bot@<version>` (pinned to the running package) → installs the safety-net guardian system service. One command installs everything.

> **No public IP / domain / server / tunneling required** (Feishu outbound WebSocket long connection); works on Linux / macOS / Windows.
> With an existing PersonalAgent app you can skip the QR step (see Configuration): `DSH_LARK_APP_ID=cli_xxx DSH_LARK_APP_SECRET=<secret> DSH_LARK_TENANT=feishu dsh --profile dsh-lark`
> Upgrading is also one command: `npx dsh-lark-bot@latest upgrade --profile dsh-lark --yes`

## Full usage

### Common commands

Send a normal message to the bot in Feishu to get started. Common commands:

| Command | Description |
| --- | --- |
| `/new` `/reset` | Start a new session |
| `/newg <group name>` | Auto-create a group chat (with you invited) and start a fresh session there; the current session is untouched |
| `/cd <path>` | Change working directory and reset the session |
| `/ws list` | List named workspaces |
| `/ws save <name>` | Save the current workspace |
| `/ws use <name>` | Switch to a named workspace |
| `/ws remove <name>` | Remove a named workspace |
| `/status` | Show current status |
| `/resume` | Show the session's recent context |
| `/stop` | Stop the current task |
| `/timeout [N\|off\|default]` | View or set the current session run timeout |
| `/concurrency [N\|default]` | View or set the concurrent-run limit for this scope (default 2) |
| `/role list`、`/role show <id>` | List roles / show a role |
| `/role set <id>`、`/role clear` | Bind / unbind a role for this scope |
| `/role save <id> <name> [--persona text] [--model <id>] [--tools <csv>] [--rules text]` | Create / update a role (admin) |
| `/role remove <id>` | Remove a role (admin) |
| `/notify <scope\|chatId> <text>` | Push a cross-session notification (admin) |
| `/notify list` | List scopes known to the bridge |
| `/retention [N\|default]` | View or set the live message retention window (overflow is archived) |
| `/archive [note]`、`/archive list [N]`、`/archive clean` | Archive / list / clean session transcripts |
| `/density [compact\|standard\|detailed]` | View or set card density |
| `/model` | View current model, dsh default model and available models |
| `/model use <id>` | Hot-switch the current session model (effective next message, no restart) |
| `/model default <id>` | Write the dsh default model `agent-default-model` (admin) |
| `/model add\|remove <provider> <modelId>` | Add / remove a provider model (admin) |
| `/providers` | View configured dsh providers, models and credential status |
| `/provider add\|update\|remove <id>` | Manage providers (admin; deepseek-official and custom pi-ai) |
| `/key set\|remove\|list <ref>` | Manage dsh credentials (set / remove require admin) |
| `/ask <question>` | Send a Q&A card; the answer is written back to session context |
| `/invite user\|admin\|group <id>`、`/invite list`、`/invite remove user\|group <id>` | Manage the access allowlist |
| `/help` | Show help |

Images in Feishu messages are downloaded to the local media directory and passed to dsh; text files are read and their content is injected into the task context.

**`/newg <group name>`**: auto-creates a private group via the Feishu API, invites the sender, and replies with a group link — chatting in the new group starts a fresh scope/session while the current session is untouched. Requires the `im:chat` and `im:chat.members:write_only` scopes (apply in the developer console).

Each scope (DM / group / topic) runs up to **2 tasks in parallel** by default (adjust with `DSH_LARK_SCOPE_CONCURRENCY` or `/concurrency`): successive messages become independent runs, each with its own dsh session and run id. `/status` lists every active run and `/stop` interrupts them all.

**Multi-role agents**: admins define roles (PM / dev / docs / …) with `/role save <id> <name> --persona <text> [--model <id>] [--tools <csv>] [--rules <text>]` — persona, model preference, tool guidance and role rules — then bind one to the current scope with `/role set <id>`. Every run in that scope carries the role instructions, and the role model wins below the per-session `/model use` override. Role definitions persist in `~/.dsh-lark/profiles/<profile>/roles.json`.

**Outbound mentions & cross-session notify**: the outbound contract supports `mentions` and cross-chat/thread sends; `/notify <scope|chatId> <text>` pushes a report to another session (admin). The agent also gets a built-in `lark_notify` dsh tool (wired into both SDK and ACP runtime profiles): after a task finishes it can push messages to other groups/topics and @mention members. The bridge listens on 127.0.0.1 with a random per-boot token — nothing is exposed to the public network.

**Mid-task questions (question cards)**: when the agent needs a decision, confirmation, or missing information, it proactively sends a **question card** to the current chat via the `lark_ask_user` tool (single choice / multi choice / free text) and resumes automatically once you answer — no extra command needed. The run-timeout watchdog pauses while a card is waiting. (This is the opposite direction of `/ask`, which is you asking the agent.)

**Safety-net guardian**: a minimal system-level resident process installed **by default with `setup`**, independent of the dsh process (Linux systemd user unit / macOS LaunchAgent / Windows startup). While dsh runs, the guardian stays silent; once dsh goes down or fails to boot (e.g. a third-party plugin breaks the whole profile composition), the guardian takes over the Feishu channel so you can self-heal without touching the command line:

- `/safemode`: enter **core-only safe mode** — the guardian provisions `~/.dsh/profiles/<profile>-safe` with only the two official core bundles (`dsh-base` + `dsh-headless`, **no third-party plugins**) and proxies a restricted conversation to that core dsh so you can locate / fix / disable the offending plugin. Safe mode prefers the official **SDK streaming engine** (real-time reasoning / tool calls / web search / typewriter text on the same streaming card as normal mode) and falls back to headless with a live activity card ("thinking / elapsed Ns / no response Ns") when the SDK runtime cannot be provisioned;
- `/safemode plugins`: list the plugins installed into the broken profile;
- `/safemode status`: show guardian / dsh / safe-mode state;
- `/safemode stop`: interrupt the currently running safe-mode task (or use the ⏹ button on the card);
- `/safemode exit`: leave safe mode — the guardian relaunches the full profile and hands the Feishu channel back;

Safe-mode tasks are bounded by an **idle timeout** (`DSH_LARK_GUARDIAN_SAFE_TIMEOUT_MS`, default 10 minutes: a task is stopped only after it has been silent for the whole window, so active streaming work is never cut short); timeouts and failures always surface a clear terminal state on the card instead of hanging silently. No command line is needed for the whole rescue flow; once dsh is back, the guardian releases the channel automatically. Install:

```bash
# Installed by default with setup (no extra flag); can also be installed / refreshed later:
dsh-lark-bot guardian install --dsh-profile dsh-lark
```

Pass `--no-guardian` to setup to skip it; remove it later with `dsh-lark-bot guardian uninstall`.

### Models / Providers / Credentials

Model and provider configuration is persisted the official dsh way (the exact storage protocol used by the dsh Web **Settings → Models** page); changes take effect on the next request without restarting the bot:

- `/model use <id>`: hot-switch the model for this session; the next message uses it.
- `/model default <id>`: write the dsh `agent-default-model` as the default for new sessions.
- `/providers`: show configured providers, models and credential status (official DeepSeek + custom pi-ai).
- `/provider add|update|remove`: manage custom providers (`llm-pi-ai`) or `deepseek-official`; a custom provider needs `--api` (`openai-completions` / `openai-responses` / `anthropic-messages`), `--base-url` and at least one `--model`, matching the official schema.
- `/key set|remove|list`: read / write `~/.dsh/.credentials.yaml` (0600). Settings keep only `apiKeyEnv` references; literal keys never enter settings or chat history.

Security note: typing a key in a Feishu conversation exposes it to everyone who can see that chat; prefer private chats, `--api-key-env` references to existing environment variables, or the dsh Web UI. The bot never echoes key values in any reply.

## Install & Uninstall

### Install

The only install path (a standard dsh profile bundle):

```bash
npx dsh-lark-bot@latest setup --profile dsh-lark
```

`setup` locates your dsh, pre-approves pnpm's build policy (protobufjs) and runs the standard `dsh plugin --profile dsh-lark add dsh-lark-bot`. It **also installs the safety-net guardian by default** (see the "Safety-net guardian" section above; pass `--no-guardian` to skip). Re-running it upgrades to the latest version.

### Upgrade

**Recommended: one-command full upgrade (new in v0.12.0, issue #10)**

```bash
npx dsh-lark-bot@latest upgrade --profile dsh-lark --yes
```

`upgrade` detects the installed / running / npm-latest versions, upgrades the **package** (`dsh plugin add <name>@<latest>`), **idempotently reinstalls and restarts the guardian service**, then runs `doctor` verification. Running instances are handled safely:

- By default the running dsh profile is never interrupted — you only get the restart command (config / sessions / credentials are untouched);
- `--restart`: also restarts the guardian service and (managed/detached) dsh profile processes;
- `--check`: report versions and running state only, no changes;
- `--rollback`: reinstall the version recorded before the last upgrade (`~/.dsh-lark/upgrade-state.json`);
- `--force`: reinstall the running version when npm is unreachable (offline);
- `--no-guardian`: skip the guardian upgrade;
- **Runtime-profile consistency repair**: after upgrading, the own-package links of `dsh-lark-sdk` / `dsh-lark-acp` are re-pointed to the new version (avoiding re-provisioning on the next start).

Pass `--yes` to skip the interactive confirmation (non-interactive runs fail closed without it). Alternatives:

- Plugin: re-run `setup` (or `dsh plugin --profile <name> add dsh-lark-bot`) to pull the latest npm release.
- Safety-net guardian: installed / upgraded together with `upgrade` / `setup` (idempotent), or standalone via `dsh-lark-bot guardian install`.
- CLI tool (optional): `npm i -g dsh-lark-bot@latest`; not needed when using `npx`.
- Restart the profile after upgrading (when not using `--restart`): `dsh --profile dsh-lark`.

### Disable

Keep the plugin loaded but stop the bridge engine: export `DSH_LARK_DISABLED=1` before booting the profile. For full removal see the next subsection.

### Uninstall

```bash
dsh plugin --profile dsh-lark remove dsh-lark-bot
```

Removal unloads the plugin from the profile. Local state (config / sessions / archives / roles) stays in `~/.dsh-lark`; back it up before deleting it.

See [`docs/QUICK_START.md`](docs/QUICK_START.md) for installation details, state directories, logs and troubleshooting.

---

## FAQ (use cases & common questions)

### Typical use cases

**Q: Can I drive my local DeepSeek Harness from my phone?**

**A:** Yes. After the one-command install and a QR scan, message the bot from the Feishu mobile app to read code, run commands and complete tasks on your local dsh coding agent; proactive cross-session notifications with @mentions are supported when tasks finish. Install: `npx dsh-lark-bot@latest setup --profile dsh-lark` → `dsh --profile dsh-lark` → scan the QR code → start chatting.

**Q: How do I isolate projects and split work across a team?**

**A:** Each session automatically lands in an isolated git worktree (`~/.dsh-lark/profiles/<profile>/worktrees/<scope>/`) with project-level `AGENTS.md` rules injected, so multiple projects never interfere; admins define PM / dev / docs roles with `/role` and bind them to a chat, and manage the access allowlist with `/invite`; up to 2 tasks run in parallel per chat by default (`/concurrency` to adjust), with `/archive` + `/retention` controlling archival and retention.

**Q: Does the bot still work if dsh crashes or goes offline?**

**A:** Yes. `setup` installs the safety-net guardian by default (systemd / LaunchAgent / Windows startup). When dsh crashes or fails to boot, the guardian takes over the Feishu channel and first tries to relaunch the full profile automatically; if that still fails, send `/safemode` to enter core-only safe mode (official core bundles only, no third-party plugins), locate / fix the problem from the chat, and `/safemode exit` relaunches the full profile and hands the channel back. No command line is needed for the whole flow.

### Common questions

**Q: How do I connect DeepSeek Harness to Feishu?**

**A:** Install Node.js ≥ 22 and DeepSeek Harness (with `DEEPSEEK_API_KEY` configured), run `npx dsh-lark-bot@latest setup --profile dsh-lark`, then start with `dsh --profile dsh-lark` and scan the terminal QR code with the Feishu app to bind a PersonalAgent app. DM the bot directly, or use `@bot` in groups/topics.

**Q: Do I need a public IP, domain or server?**

**A:** No. The Feishu channel uses an outbound WebSocket long connection, so it works behind NAT — no public server, domain or tunneling required.

**Q: How is dsh-lark-bot different from other DeepSeek Harness Feishu plugins (e.g. harness-lark)?**

**A:** The most complete feature set: safety-net guardian (still reachable in Feishu after a dsh crash), multi-role agents, parallel tasks, session archival, cross-session proactive notifications, and in-chat model/key management — all in one. It ships as a standard dsh profile bundle installed with a single `npx dsh-lark-bot@latest setup` command — no separate Docker / background service.

**Q: Where do I download the project? Are there impostors?**

**A:** The only official repository is [github.com/PlutoKeating/dsh-lark-bot](https://github.com/PlutoKeating/dsh-lark-bot) and the only official npm packages are `dsh-lark-bot` / `dsh-feishu-bot` (maintainer `plutokeating`). This project never ships .exe or "download-and-run" installers; any repository or page distributing executables under the project's name is an impostor — do not run anything from it (see the "Impostor Repository Warning" at the end).

---

## Keywords

`dsh` · `deepseek` · `deepseek harness` · `feishu` · `lark` · `bridge` · `bot` ·
`chatbot` · `messaging` · `qrcode` · `typescript` · `feishu-bot` · `lark-bot` ·
`dsh-plugin` · `deepseek-harness` · `im-bridge` · `ai-agent` · `workspace` · `self-healing`

## What it is

**dsh-lark-bot** is a lightweight bridge that connects your local DeepSeek Harness (`dsh`) into Feishu / Lark, recreating the beloved OpenCode / MiMoCode Telegram-bot experience — chat with your coding agent, receive streaming cards, review diffs — and adds **full project workspace management** on top.

**Who it is for**: developers and teams who drive a local dsh coding agent from Feishu / Lark (DMs, groups, topics) — especially those needing multi-project isolation, role-based collaboration, parallel tasks and session archival.

## Goals

- **One-command install & deploy**: `npx dsh-lark-bot@latest setup --profile dsh-lark` installs into a dsh profile; then `dsh --profile dsh-lark` starts and scans once — the bridge engine runs as a standard plugin inside the dsh process.
- **Native Feishu experience**: streaming cards, interactive buttons, images / files (doc comments are planned).
- **Full workspace management**: multi-project isolation, git worktrees, per-project rules, persistent context.

## Compatibility

- **DeepSeek Harness (`dsh`)**: verified against **dsh 0.1.0-rc.6** (last verified 2026-08-15: SDK JSON-RPC / ACP runtime handshake + real streaming task verification), connected through the official `@deepseek-ai/dsh-sdk-client` / `@deepseek-ai/dsh-acp`; see [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) for pinned versions, the upgrade policy and automated probing, and [`docs/adapter-notes.md`](docs/adapter-notes.md) for adapter details.
- **Runtime**: Node.js ≥ 22.19 (see `engines` in `package.json`).
- **Platform**: Linux / macOS / Windows (Feishu outbound WebSocket long connection; no public server, domain or tunneling required).
- The default adapter is the official **`@deepseek-ai/dsh-sdk-client`** (SDK JSON-RPC runtime with native session continuation and token-level streaming events); `DSH_LARK_ADAPTER=acp` switches to the official **ACP server** (approval cards); `headless` keeps the legacy subprocess fallback; `DSH_LARK_ADAPTER=web` drives the **local dsh web agent** (`session.prompt` + `/api/events.mux` — the web agent becomes the single writer, eliminating multi-writer session-log corruption at the root). On first start the bot creates the runtime profile at `~/.dsh/profiles/dsh-lark-sdk` (or `dsh-lark-acp`).

## Known limitations

- ACP sessions are always fresh (an upstream limit); the SDK protocol has no mid-turn cancel, so `/stop` closes and recreates the runtime.
- The engine runs in-process as a dsh plugin; agent execution uses the official dsh SDK runtime subprocess — a deliberate nested-runtime design for per-workspace runtime pools and parallel runs. The one process-level exception is the safety-net guardian installed by default — a minimal resident process independent of dsh / Cordis that only takes over the Feishu channel after dsh goes down and stays silent otherwise.
- Feishu doc comments and rich-text replies are planned, not yet implemented.
- pnpm ≥ 10 build policy is handled by `setup`; when installing manually and `ERR_PNPM_IGNORED_BUILDS` appears, add `allowBuilds: { protobufjs: true }` to the profile's `pnpm-workspace.yaml` and retry.

## Configuration

- Local config: `~/.dsh-lark/config.json`
- The state root can be overridden with `DSH_LARK_HOME`
- Environment variables use the `DSH_LARK_*` prefix
- Template: [`.env.example`](.env.example)
- Sensitive values: credentials (`DSH_LARK_APP_SECRET`, `DEEPSEEK_API_KEY`, …) stay in local config/env only; logs and cards are redacted; only `.env.example` is committed.

When the session runs inside a Git repository, an isolated worktree is created at `~/.dsh-lark/profiles/<profile>/worktrees/<scope>/` and a project-level `AGENTS.md` is copied in.

Each Feishu scope keeps the last 40 conversation messages by default (adjustable with `/retention` or `DSH_LARK_RETENTION_MSGS`); messages beyond the retention window are archived to `~/.dsh-lark/profiles/<profile>/archives/` (Markdown + JSONL inside a Git repository, one commit per archive), and `/archive` exports the full session on demand. The SDK mode continues the native dsh session, while headless mode approximates memory by injecting history into the next prompt.

Core environment variables:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `DSH_LARK_HOME` | `~/.dsh-lark` | Local state root directory |
| `DSH_LARK_TENANT` | `feishu` | `feishu` or `lark` |
| `DSH_LARK_WORKSPACE` | unset | Default working directory for new sessions |
| `DSH_LARK_DSH_COMMAND` | auto-discovered | dsh launch command; usually not needed |
| `DSH_LARK_DSH_ARGS` | auto-discovered | dsh launch args, comma-separated; usually not needed |
| `DSH_LARK_ADAPTER` | `sdk` | `sdk` (default) / `acp` (approval) / `headless` (legacy) / `web` (local dsh web agent, single writer) |
| `DSH_LARK_PROVIDER` | `deepseek-official` | Model provider |
| `DSH_LARK_MODEL` | `deepseek-v4-flash` | Default model |
| `DSH_LARK_MAX_TOKENS` | unset | Per-request output token cap for SDK agents |
| `DSH_LARK_WEB_URL` | `http://127.0.0.1:3080` | `web` adapter: base URL of the local dsh web agent |
| `DSH_LARK_WEB_PUSH` | `true` | `web` adapter: push web-GUI turn completions to Feishu and auto-switch the chat mapping (`0` disables) |
| `DSH_LARK_ACCESS_DEFAULT_DENY` | `false` | Reject private chats when no allowlist is configured |
| `DSH_LARK_EVENT_FRESHNESS_MS` | `600000` | Stale-message rejection window (0 disables) |
| `DSH_LARK_RUN_TIMEOUT_MS` | `300000` | Idle timeout for a single run: stops only after the run has been silent for this long |
| `DSH_LARK_STOP_GRACE_MS` | `5000` | Grace period after SIGTERM before SIGKILL |
| `DSH_LARK_SCOPE_CONCURRENCY` | `2` | Concurrent runs per scope (1 = strictly serial) |
| `DSH_LARK_RETENTION_MSGS` | `40` | Messages kept per scope (0 keeps everything) |
| `DSH_LARK_ARCHIVE_MAX` | `50` | Max archives kept per scope (0 disables pruning) |
| `DSH_LARK_ARCHIVE_MAX_AGE_DAYS` | `90` | Max archive age in days (0 disables pruning) |
| `DSH_LARK_HEARTBEAT_MS` | `5000` | Bridge heartbeat write interval (guardian liveness signal) |
| `DSH_LARK_GUARDIAN_DISABLED` | `false` | `1` keeps the safety-net guardian stopped |
| `DSH_LARK_GUARDIAN_PROFILE` | `dsh-lark` | dsh profile the guardian watches / relaunches (persisted on install) |
| `DSH_LARK_GUARDIAN_BRIDGE_PROFILE` | `default` | Bridge state profile providing Feishu credentials / allowlist |
| `DSH_LARK_GUARDIAN_POLL_MS` | `2000` | Guardian watchdog poll interval |
| `DSH_LARK_GUARDIAN_STALE_MS` | `15000` | Heartbeat staleness threshold before channel takeover |
| `DSH_LARK_GUARDIAN_ENGINE_DEAD_MS` | `120000` | Live dsh process with heartbeat stale this long is treated as engine-dead (takeover) |
| `DSH_LARK_GUARDIAN_SAFE_ADAPTER` | `auto` | Safe-mode engine: `auto` tries the SDK streaming runtime then falls back to headless; `sdk` requires it; `headless` skips provisioning |
| `DSH_LARK_GUARDIAN_SAFE_TIMEOUT_MS` | `600000` | Safe-mode per-task idle timeout (stops the run after it has been silent this long and renders a timeout card) |
| `DSH_LARK_GUARDIAN_CARD_DENSITY` | `detailed` | Card density for safe-mode run cards (compact / standard / detailed) |
| `DSH_LARK_UPGRADE_REGISTRY` | `https://registry.npmjs.org` | npm registry used by `upgrade` to discover the latest version (mirrors supported) |
| `DSH_LARK_UPGRADE_CHECK` | `1` | Whether `doctor` / `/version` probe npm latest (`0` disables; best-effort) |
| `DSH_LARK_UPGRADE_CHECK_INTERVAL_MS` | `21600000` | Bridge new-version check interval (`0` disables; default 6h) |
| `DSH_LARK_UPGRADE_NOTIFY` | `false` | Push a Feishu notification to the target chat when a newer version is found (default: log-only) |
| `DSH_LARK_UPGRADE_NOTIFY_CHAT` | — | Chat receiving update notifications (with `DSH_LARK_UPGRADE_NOTIFY=true`) |

On startup the bot auto-discovers common local `@deepseek-ai/dsh` installations. Set these two variables only when auto-discovery fails or a special profile is required.

## Permissions & Data

This tool runs **locally**; before installing, be aware that it accesses:

- **Feishu credentials**: the PersonalAgent app `app_id` / `app_secret`, stored in plaintext at `~/.dsh-lark/config.json` (file mode 600).
- **File system**: reads / writes the working directories you choose with `/cd` and `/ws` (including running shell commands and modifying files).
- **Network**: an outbound WebSocket long connection to the Feishu open platform for messages, and task context sent to the DeepSeek API.
- **Local callback**: when the `lark_notify` tool runs, the dsh runtime subprocess calls the bridge process back over a random 127.0.0.1 port with a per-boot token (loopback only).
- **Processes**: spawns local `dsh` runtime subprocesses (`dsh-sdk-jsonrpc-server` / `dsh-acp` profiles) to run agent tasks.
- **dsh configuration**: `/model` `/providers` `/provider` `/key` read / write `~/.dsh/settings.yaml` and `~/.dsh/.credentials.yaml` using the official dsh storage protocol (admin-only writes; settings keep only `apiKeyEnv` references; credentials file mode 0600, directory 0700; literal keys never enter settings or chat history).
- **Safety-net guardian (installed by default with `setup`)**: a system-level resident process reads the Feishu credentials from `~/.dsh-lark/config.json`; it takes over the same bot's Feishu long connection only after dsh goes down and scans local processes (command lines via `ps` only, no memory access). On `/safemode` it provisions a core-only dsh profile (headless or SDK JSON-RPC runtime, both without third-party plugins) and runs one task per message; the SDK engine provides real-time streaming events via the official `dsh-sdk-jsonrpc-server` subprocess.

All data flows only between this machine, Feishu and DeepSeek; nothing is collected or uploaded as telemetry. Keys are never committed to the repository (see `.gitignore`).

## Troubleshooting

Run `dsh-lark-bot doctor` first; it checks the profile and working directory and performs a real availability probe for the current adapter (`sdk` / `acp` / `headless` runtime handshake).

Common issues:

- **Silent bot / long-connection failure**: check the JSONL logs on stderr, focusing on the `channel` and `channel-command` categories; the SDK reconnects automatically.
- **Unresponsive agent**: send `/status` to view the scope, cwd and active run; send `/stop` to terminate the current task; the idle watchdog terminates it automatically after it has been silent for `DSH_LARK_RUN_TIMEOUT_MS` (active streaming work is never cut short).
- **First QR binding fails**: make sure the local clock is accurate and the Feishu open platform is reachable; with an existing App ID/Secret you can skip scanning via `--app-id` / `--app-secret`.

The bridge engine logs JSON Lines to stderr (captured by the dsh host; `logs/bot.log` is a leftover path from the 0.6.0 standalone-service era and is no longer written since 0.7.0); the dsh host uses its own logging.

**Rollback**: remove the plugin and reinstall a pinned version (e.g. `dsh plugin --profile dsh-lark add dsh-lark-bot@0.6.0`); `~/.dsh-lark` state is independent of the package, so config and sessions survive upgrades / rollbacks.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm check:publish-bundle   # verifies dist matches every export & the CLI entry (release gate)
pnpm ci:local
pnpm release:check   # ci:local + upstream consistency check
pnpm compat:probe    # installs pinned dsh into a temp DSH_HOME and runs a real SDK handshake
pnpm dsh:upstream    # compares npm upstream stable with the pinned matrix
pnpm security:monitor # impostor-repo & npm copycat monitor (recommended weekly)
```

See [`AGENTS.md`](AGENTS.md) for the development workflow, [`docs/API.md`](docs/API.md) for module contracts, and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the architecture. See [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) for the compatibility matrix, upgrade policy and automation.

Contributions are welcome via Issues and PRs; see [`AGENTS.md`](AGENTS.md) for the workflow (required reading, commit conventions, push policy) and [`docs/ECOSYSTEM.md`](docs/ECOSYSTEM.md) for ecosystem delivery standards.

Publishing both packages (`dsh-lark-bot` and `dsh-feishu-bot` share the same dist / version / dependencies):

```bash
pnpm publish:dual:dry-run
pnpm publish:dual
```

`scripts/publish-dual-packages.mjs` generates two publish manifests from the root `package.json`, differing only in `name` / `bin`, so the two copies never drift. A GitHub tag `v*` triggers [`release.yml`](.github/workflows/release.yml) to publish both npm packages and create a Release automatically.

The same dist is also published to GitHub Packages as `@plutokeating/dsh-lark-bot` and `@plutokeating/dsh-feishu-bot`, viewable on the GitHub Packages page.

## Maintenance

- Status: **active**. Primary maintainer: **PlutoKeating**.
- Bugs / feature requests: GitHub Issues; security issues via the private channel in [`SECURITY.md`](SECURITY.md).

See the next section for ecosystem registration status.

## Author

This project is developed and maintained by **PlutoKeating**, who focuses on automation and developer tooling and prefers building software from real usage. It grew out of the daily need to drive DeepSeek agents from Feishu/Lark group chats, evolving into a complete bridge with guardian, self-healing, and one-command upgrade capabilities. See the author's profile: [PlutoKeating](https://github.com/PlutoKeating).

## Contributors

Thanks to the following contributors (by merge / submission time):

| Contributor | Contribution | Status |
| :--- | :--- | :--- |
| [koprivnikarurnaa-oss](https://github.com/koprivnikarurnaa-oss) | [PR #9](https://github.com/PlutoKeating/dsh-lark-bot/pull/9): Web single-writer adapter + self-heal v2 + guardian auto-relaunch | ✅ Merged |
| [Normanyin](https://github.com/Normanyin) | [PR #11](https://github.com/PlutoKeating/dsh-lark-bot/pull/11): `/newg` auto-create group chat command | ✅ Merged (cherry-pick) |

> Note: GitHub's contributor graph attributes commits by author email. The commits merged via PR #9 carried a local generic identity (`dsh-user <dsh-user@local>`, not linked to a GitHub account), so they are not auto-counted in the graph; this table is the repository's explicit acknowledgment. PR #11's commits are authored under the contributor's linked account and will be credited automatically once merged.

## License & Security

- **License**: GNU Affero General Public License v3.0 (see `LICENSE`).
- **Copyright**: source is owned by the maintainers and licensed under AGPL-3.0; "DeepSeek" and "Feishu / Lark" trademarks belong to their respective owners.
- **Security reports**: report vulnerabilities privately via GitHub Security Advisory; do not open a public issue.
- **Security model**: default-deny, secret redaction, path containment, SSRF protection, stale event rejection and default-disabled interactive tools — see [`SECURITY.md`](SECURITY.md).

## Documentation

> Engineers taking over this project: **read [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) and [`docs/RESEARCH.md`](docs/RESEARCH.md) first**.

| Doc | Content |
| :--- | :--- |
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | Complete requirements, outputs & specifications |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | Research: official status, references, feasibility |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Architecture layering & directory mapping |
| [`docs/API.md`](docs/API.md) | Module interfaces & contracts |
| [`docs/QUICK_START.md`](docs/QUICK_START.md) | Install & quick start |
| [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) | Compatibility matrix, upgrade policy & automation |
| [`docs/MANUAL.md`](docs/MANUAL.md) | Complete user manual |
| [`docs/adapter-notes.md`](docs/adapter-notes.md) | How to plug the dsh adapter |
| [`docs/UPGRADE.md`](docs/UPGRADE.md) | Upgrade flow architecture, activation & known boundaries (issue #15) |
| [`docs/ECOSYSTEM.md`](docs/ECOSYSTEM.md) | Ecosystem & delivery standards (for engineers) |
| [`docs/roadmap.md`](docs/roadmap.md) | Roadmap & milestones |
| [`docs/PLAN.md`](docs/PLAN.md) | Development plan & acceptance criteria |
| [`SECURITY.md`](SECURITY.md) | Security model & reporting |
| [`AGENTS.md`](AGENTS.md) | AI agent workflow spec |

## Architecture

> See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for details.

```
Feishu / Lark ──WebSocket long connection──▶ bridge/ ──▶ session/ ──▶ workspace/ ──▶ adapters/ ──▶ dsh ──▶ DeepSeek V4
```

The core idea: **decouple the Feishu channel from the agent backend**. The bridge layer follows the battle-tested `lark-channel-bridge` approach (WebSocket long-connection + streaming cards + session routing); the agent backend is abstracted behind an adapter, defaulting to the official DeepSeek Harness SDK (`DSH_LARK_ADAPTER=sdk`), with an optional ACP approval mode and the legacy headless fallback.

The safety-net guardian (`src/guardian/`) installed by default runs as a separate resident process: silent while dsh is up, it takes over the Feishu channel when dsh goes down, accepts `/safemode` control signals, runs a restricted core-only conversation (`dsh-base` + `dsh-headless`) for self-healing, and relaunches the full profile on `/safemode exit`.

## Directory Structure

| Directory | Responsibility |
| :--- | :--- |
| `src/bridge/` | Feishu channel integration |
| `src/onboard/` | First-run QR onboarding |
| `src/session/` | Session routing, queueing, access control |
| `src/workspace/` | Project workspace, git worktree isolation & rule injection |
| `src/adapters/` | Agent backend adapters (sdk / acp / headless / web single-writer) |
| `src/card/` | Streaming card state & rendering |
| `src/bot/` | Run registry, queueing, approval/question registries |
| `src/commands/` | Slash commands |
| `src/cli/` | CLI entry: setup / doctor / upgrade / hidden run |
| `src/upgrade/` | One-command upgrade (issue #10): version probe, upgrade state, running-state detection, restart helpers, runtime link repair |
| `src/guardian/` | Safety-net guardian: heartbeat, process watch, core-only safe profile, takeover state machine, service install |
| `src/config/` | Profile, config, access & dsh config management |
| `src/core/` | Structured logging |
| `src/media/` | Attachment download & text injection |
| `src/platform/` | Cross-platform atomic writes |
| `docs/` | Architecture, roadmap & docs |
| `reference/` | Cloned reference repos (not committed) |

## Roadmap

See [`docs/roadmap.md`](docs/roadmap.md).

## References

| Project | About |
| :--- | :--- |
| [`zarazhangrui/lark-coding-agent-bridge`](https://github.com/zarazhangrui/lark-coding-agent-bridge) | Feishu ↔ Claude Code / Codex bridge; the direct reference for this project |
| [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) | DeepSeek Harness (`dsh`), the agent backend |
| [`grinev/opencode-telegram-bot`](https://github.com/grinev/opencode-telegram-bot) | Telegram mobile client for OpenCode; another reference |

## Community Listings

> Community listing & recommendation status, kept current as update requests land. As of v0.15.1 (re-verified 2026-08-17):

| Platform | Status | Notes |
| :--- | :--- | :--- |
| [awesome-dsh-plugins](https://github.com/AdamPlatin123/awesome-dsh-plugins) | ✅ Listed · runtime-verified | Shown as `✅ 运行级可用` (agent-tested); v0.8.0 entry merged via [PR #127](https://github.com/AdamPlatin123/awesome-dsh-plugins/pull/127); leaderboard sync [#139](https://github.com/AdamPlatin123/awesome-dsh-plugins/issues/139) closed; **v0.15.1 refresh submitted via [PR #230](https://github.com/AdamPlatin123/awesome-dsh-plugins/pull/230), awaiting merge** |
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | 📨 Submission PR open · awaiting merge | The 7.2k+ star curated plugin list (the ecosystem traffic hub); submission [PR #1408](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/1408) open, status backfilled after merge |
| [dshfind](https://dshfind.com/zh/plugins/PlutoKeating/dsh-lark-bot) | ✅ Listed · detail page live | Entry name fixed ([issue #2](https://github.com/hikariming/dshfind/issues/2) closed); **v0.15.1 refresh requested via [#6 follow-up comment](https://github.com/hikariming/dshfind/issues/6#issuecomment-5317081509), awaiting maintainer**; the header badge / card comes from dshfind |
| [dshbase](https://dshbase.com/zh/plugins/dsh-lark-bot) | ✅ Listed · CI-verified | Chinese plugin directory (1771+ plugins) with automated CI install verification, marked `✅ verified`; the header badge comes from dshbase |
| [omdsh-dev/community](https://github.com/orgs/omdsh-dev/discussions/11) | ✅ Accepted · discussion active | `[Plugin]` submission (Discussion #11) accepted and active, latest notes v0.10.2; **v0.15.1 update note prepared, paste manually (org-level discussions have no API)** |

**Update request status (as of 2026-08-17)**:

- awesome-dsh-plugins v0.8.0 entry: [#127](https://github.com/AdamPlatin123/awesome-dsh-plugins/pull/127) — ✅ merged; leaderboard sync: [#139](https://github.com/AdamPlatin123/awesome-dsh-plugins/issues/139) — ✅ closed
- awesome-dsh-plugin listing: [#1408](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/1408) — 📨 submitted (2026-08-17, v0.15.0 data; [v0.15.1 follow-up comment](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/1408#issuecomment-5317081726) submitted)
- dshfind name fix + v0.8.0 refresh: [#2](https://github.com/hikariming/dshfind/issues/2) — ✅ closed; v0.10.1 refresh: [#6](https://github.com/hikariming/dshfind/issues/6) — 📨 pending ([v0.15.1 follow-up](https://github.com/hikariming/dshfind/issues/6#issuecomment-5317081509) submitted)
- omdsh-dev/community listing: [Discussion #11](https://github.com/orgs/omdsh-dev/discussions/11) — ✅ accepted, discussion active (latest notes v0.10.2); v0.15.1 update note — 📨 prepared, paste manually
- Platform refresh (v0.14.0 → v0.15.1) — ✅ resumed (2026-08-17): awesome-dsh-plugins [PR #230](https://github.com/AdamPlatin123/awesome-dsh-plugins/pull/230) · dshfind [#6 follow-up](https://github.com/hikariming/dshfind/issues/6#issuecomment-5317081509) · omdsh note prepared

**Highlights follow-ups** (six exclusive capabilities & the issue #6 design):

- awesome-dsh-plugins leaderboard row sync (repo description → latest) & agent-test name anomaly: [#139](https://github.com/AdamPlatin123/awesome-dsh-plugins/issues/139) — 📨 submitted (maintainer confirmed; awaiting the snapshot/render cycle)
- dshfind detail page: add the in-chat model/key management highlight: [#2 follow-up](https://github.com/hikariming/dshfind/issues/2#issuecomment-5301019067) — 📨 submitted
- omdsh six-exclusive-highlights summary (incl. the Guardian design): [Discussion #11 highlights comment](https://github.com/orgs/omdsh-dev/discussions/11#discussioncomment-18026370) — 📨 submitted

## Impostor Repository Warning

> [!WARNING]
> On 2026-08-17 an impostor repository **`tarraencompassing61/dsh-lark-bot`** was found: re-uploaded as a non-fork with 113/114 commits authored by PlutoKeating, all CI deleted, Issues disabled, zero Releases, and a SEO-bait README offering "Windows exe download & run". **This project never ships executables — treat any such download as counterfeit / malicious.**
>
> Evidence: [`docs/security/2026-08-17-impostor-repo-evidence/`](docs/security/2026-08-17-impostor-repo-evidence/README.md) ·
> Official download: [`docs/DOWNLOAD.md`](docs/DOWNLOAD.md) ·
> Ongoing monitor: `pnpm security:monitor`

## Disclaimer

> [!NOTE]
> This is an unofficial community tool, not affiliated with or endorsed by DeepSeek or ByteDance / Feishu (Lark). DeepSeek Harness, Feishu / Lark and related trademarks belong to their respective owners.
