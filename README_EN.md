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

> **⚠️ Official channels only:** The only official repository is [PlutoKeating/dsh-lark-bot](https://github.com/PlutoKeating/dsh-lark-bot); the only official npm packages are `dsh-lark-bot` (with the twin package `dsh-feishu-bot`, maintainer `plutokeating`). **This project never ships Windows executables (.exe) or any "download-and-run" installer.** Any page, repository, or third-party channel offering executables under this project's name is a **counterfeit / malicious source** — do not download or run anything from it. The only official install command: `npx dsh-lark-bot@latest setup --profile dsh-lark`. Evidence and the full statement live in the "Impostor Repository Warning" section below and [docs/security/2026-08-17-impostor-repo-evidence/](docs/security/2026-08-17-impostor-repo-evidence/README.md).

---

## The Problem

Tired of being chained to your desk to drive DeepSeek Harness? dsh runs on your local machine, so checking progress and adjusting tasks means going back to your computer; once you leave your desk, a run can stall, drift, or dsh itself can crash without you ever hearing about it — until you come back and find you wasted hours.

dsh-lark-bot puts the remote control in your Feishu: drive your local dsh coding agent from DMs, group chats and topics, with a native collapsible panel showing phase, elapsed time, and tool names/statuses in real time and the final answer delivered as a separate message; get proactive notifications pushed to any chat you're in with @mentions when tasks finish; and even when dsh crashes, Feishu still answers — send `/safemode` to enter core-only safe mode and locate the problem and restart the engine right from the chat. **It is the only bridge where you never lose contact when dsh goes down.**

**Who it is for**: developers and teams who drive a local dsh coding agent from Feishu / Lark (DMs, groups, topics) — especially those needing multi-project isolation, role-based collaboration, parallel tasks and session archival.

Bot-owned command help, status/error messages and interactive cards are available in Chinese and English. Card JSON 2.0 uses native component-level `i18n_content`, so members of the same group see one shared card in their own client language. Plain Markdown, toast messages and legacy fallbacks cannot detect each viewer's locale and therefore show both languages. Agent answers and user-authored text are never translated; raw reasoning and tool payloads remain local and are not rendered into process cards.

## What you get

**Core**:

- Drive your local dsh coding agent from private chats, group chats and threads; images / text files can be sent straight to the bot;
- A streaming process card with a native collapsible panel for phase, elapsed time, and tool names/statuses; raw reasoning, tool payloads, and underlying errors stay out of the card. The final answer arrives separately, with interactive buttons for stop / plan gate / approval / questions. Failed card patches are retried finitely and degrade to a plain notice—the agent and final reply continue instead of taking down the bridge;
- Automatic session archival and retention policies; per-session isolated git worktrees inside Git repositories, so multiple projects never interfere with each other.

**Twelve exclusive capabilities**:

- 🆘 **Guardian safety net — "always reachable"**: Feishu still replies after dsh crashes; `/safemode` enters core-only safe mode to locate the problem and restart directly.
- 👥 **Multi-role agents — "one bot, a whole team"**: switch or assign PM / dev / docs roles with `/role`; each role has its own persona, model preference and rules.
- 🤝 **Multi-bot handoff — "multiple independent agents in one group"**: `bot add` creates an isolated identity/service/context; trusted bots hand work off with a real @mention and a bounded conversation counter.
- ⚡ **Parallel tasks — "no queueing"**: run multiple tasks in the same chat simultaneously with isolated sessions; other solutions serialize everything.
- 🧾 **Crash-safe reconciliation — "sent does not mean vanished"**: persist messages before queueing, replay queued work after restart, and inspect/retry interrupted checkpoints with `/jobs`.
- 🧭 **Plan before action — "review it before it moves"**: receive the complete plan first, then approve execution or add feedback and request another planning pass without restarting the task.
- 🗂 **Session archival & cleanup — "your session list never rots"**: archive old tasks with `/archive` and configure auto-retention with `/retention`.
- 📣 **Cross-session proactive notifications + @mentions — "it comes to you when done"**: after a task in chat A finishes, push a report to chat B / DMs and @mention you.
- ⚙️ **Visual dsh Web settings — "no environment variables to memorize"**: edit the app, workspace, model, concurrency and reminders from the official Plugins settings page, with diagnostic shortcuts.
- 🔑 **In-chat model & key management — "never leave Feishu"**: `/providers` `/provider` `/key` to view, switch vendors and hot-update keys.
- 🎚️ **Quick / balanced / deep modes — "pick the right task intensity"**: `/mode` persists per scope and applies on the next turn without interrupting active work.
- 🔄 **In-chat self-update — "upgrade without a terminal"**: an admin sends `/upgrade`, confirms an owner-bound card, and Guardian updates, verifies, and reloads the bot in the background; `/new` emits only a short reminder when a newer version exists.

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

③ On first boot the terminal prints a QR code → scan it with the Feishu / Lark app to create or choose a PersonalAgent app → after binding, DM the bot directly; groups/topics use `@bot` by default, with an explicitly enabled allowlist-protected no-@ mode available.

Buttons use Card JSON 2.0 `behaviors.callback`, and the QR flow explicitly requests the
`card.action.trigger` callback capability required by plan, approval, and
question-card buttons. If an existing app was created by an older flow, enable card callbacks under Developer
Console → Events & Callbacks → Callback Configuration and publish the app again. Without it, messages still work
while card clicks never reach the bot.

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
| `/cd <path>` | Switch to that directory's independent session (resume when returning) |
| `/ws list` | List named workspaces |
| `/ws save <name>` | Save the current workspace |
| `/ws use <name>` | Switch to a named workspace |
| `/ws remove <name>` | Remove a named workspace |
| `/status` | Show a refreshable status card (workspace / model / session / runs / context / tokens / pending cards / job ledger) |
| `/version` | Show the running version and npm latest version |
| `/upgrade` | Check for an update and confirm a Guardian-managed background update, verification, and reload (admin) |
| `/doctor` | Generate and upload a redacted diagnostic bundle (admin; downloadable and forwardable) |
| `/jobs [list\|show <message-id>\|retry <message-id>]` | Reconcile queued/running/completed/failed/interrupted jobs and explicitly retry after review |
| `/resume` | Show the session's recent context |
| `/session`, `/session bind <sessionId>`, `/session current` | Browse sessions in the current canonical workspace, explicitly confirm disclosure/binding, or inspect the binding (`web` adapter) |
| `/stop` | Stop the current task |
| `/timeout [N\|off\|default]` | View or set the current session run timeout |
| `/concurrency [N\|default]` | View or set the concurrent-run limit for this scope (default 2) |
| `/permission [ask\|allow\|deny] [scope]` | View or set tool permission policy (admin; optional same-chat scope) |
| `/isolation [group\|topic\|member]` | View or set this group's session isolation (admin to change) |
| `/role list`、`/role show <id>` | List roles / show a role |
| `/role set <id>`、`/role clear` | Bind / unbind a role for this scope |
| `/role save <id> <name> [--persona text] [--model <id>] [--tools <csv>] [--rules text]` | Create / update a role (admin) |
| `/role remove <id>` | Remove a role (admin) |
| `/notify <scope\|chatId> <text>` | Push a cross-session notification (admin) |
| `/notify list` | List scopes known to the bridge |
| `/notifications [show\|off\|default\|on …]` | Configure scope reminders or restore the dsh Web default |
| `/replies [show\|default\|set …]` | Configure reply batching, send intervals, batch limits, and near-deduplication (profile admins or current-group admins can write) |
| `/retention [N\|default]` | View or set the live message retention window (overflow is archived) |
| `/archive [note]`, `/archive send <id> [scope\|chatId]`, `/archive list [N]`, `/archive clean` | Archive and upload / resend here or to another session (admin) / list / clean |
| `/density [compact\|standard\|detailed]` | View or set card density |
| `/mode [quick\|balanced\|deep]` (alias `/effort`) | Choose this session's execution strength by card or command; effective next turn |
| `/model`, `/providers`, `/provider`, `/key` | Open the interactive hub (tap a model or restore the default; management writes use a multi-turn wizard) |
| `/model use <provider/model>` | Hot-switch the current session model (a unique bare model ID also works; effective next message, no restart) |
| `/model default <id>` | Write the dsh default model `agent-default-model` (admin) |
| `/model add\|remove <provider> <modelId> [--input-modalities text,image]` | Add / remove a provider model and declare vision input (admin) |
| `/provider add\|update\|remove <id>` | Manage providers (admin; deepseek-official and custom pi-ai) |
| `/key set <ref>`, `/key remove\|list <ref>` | Set dsh credentials through an owner-only secure form; remove requires admin |
| `/secret status\|set\|remove <dsh-credential\|app-secret> <ref>` | Inspect status or securely collect/remove a supported secret (admin writes) |
| `/language show\|set plain\|agent …\|reset …` | Manage plain-message and agent-answer language policy (admin writes) |
| `/ask <question>` | Send a Q&A card; the answer is written back to session context |
| `/invite user\|admin\|group <id>`、`/invite list`、`/invite remove user\|group <id>` | Manage the access allowlist (mutating commands require admin) |
| `/help` | Show help |

Every SDK, ACP, and Web turn receives structured, secret-free channel context and the official runtime
`dsh-lark-bot` skill. API keys, tokens, and App Secrets must be entered through the owner-only password form opened
by `/key set <ref>`, `/secret set …`, or `lark_request_secret`. Ordinary chat, legacy `/key set <ref> <value>`, and
`--api-key` no longer consume values. The value never enters prompts, sessions, jobs, archives, logs, diagnostics,
or replies. Guardian safe mode is a degraded recovery surface without the full configuration/secret seam.
The form payload still traverses Feishu/Lark; platform-side auditing and retention are outside this project's control,
so use a trusted direct chat. The bridge guarantees that the value is not an ordinary chat message and is never sent
to the cloud LLM.

Feishu images are detected by content as PNG/JPEG/WebP/GIF and receive a safe extension. The default
SDK validates them through dsh's attachment store and sends native image blocks instead of path text.
Unreadable or unsupported images fail explicitly, and the agent is instructed never to substitute another
workspace image. Text files are read and injected into the task context.
The `/model` card merges the dsh default into its switchable catalogue even when a provider's explicit
list omits it, and uses compact distinguishing labels with at most two buttons per mobile row. Provider
names, models, input modalities, and reasoning-effort options are discovered from the models.dev runtime
catalogue and cached in memory for 15 minutes. If it is unavailable, only explicit dsh settings and the
configured default are shown—there is no hardcoded fallback list. Override the feed with
`DSH_LARK_MODEL_CATALOG_URL`; model commands and the wizard preserve `inputModalities`.

**Message-level DSH session sync (`web` adapter)**: `/session` lists metadata only for non-subagent sessions
in the current canonical workspace—never message bodies. The confirmation card freezes the title, ID,
workspace, update time, backfill count, current scope, replacement, and exclusive-migration target. Only a
confirmed action sends a count- and byte-bounded transcript card and durably binds the session. Authorized DM
users may bind; a member scope is owner-only; shared group/topic scopes and cross-scope exclusive migration are
profile-admin-only. WebUI or dsh-TUI open/resume/activity **never** changes a Feishu binding or broadcasts to
known scopes. Once bound, the DSH `session/event` log is the sole source: external user messages become clearly
labelled bot-owned mirrors, assistant chunks throttle-update one card, and the final message finalizes it in
place; update failure appends a marked increment. An exclusive claim keeps initial history pending and blocks
live delivery until its durable seq cursor is acknowledged; failed history delivery retries on startup/reconnect.
New projection cards use stable Feishu `uuid` values so a crash after remote acceptance but before cursor commit
does not duplicate them. Durable turn origin, message IDs, event seqs and prompt `rpcId` suppress Feishu echo across restart. Tool/thinking
events stay hidden by default. `session-projections.json` (0600) stores routing, pending/cursor, turn origin and
message mappings, plus only the unfinished card body needed to resume that card—not a second transcript.

**`/newg <group name>`**: auto-creates a private group, invites the sender and replies with a group link — chatting in the new group starts a fresh scope/session while the current session is untouched. Requires the `im:chat` and `im:chat.members:write_only` scopes.

Each scope (DM / group / topic) runs up to **2 tasks in parallel** by default (adjust with `DSH_LARK_SCOPE_CONCURRENCY` or `/concurrency`): successive messages become independent runs, each with its own dsh session and run id. SDK runtimes use `scope + workspace` as their cancellation domain, and concurrent sessions in one scope are split into separate runtimes, so a card stop affects only that run and `/stop` affects only the current scope—never another group. `/status` lists runs for the current workspace; `/new` stops only that workspace.

**Session status card**: `/status` shows the workspace, effective model, session, explicit projection binding/cursor, active runs, version,
context occupancy, cumulative input/output/cache tokens, and pending approvals/questions/plans. **Refresh**
updates the same card in place. Values are shown only when the adapter or model catalog reports them: ACP can
report real context `used / size` and cumulative usage, while SDK reports per-model-call token/cache usage.
Unavailable fields say “暂无” rather than being estimated. Sessions and metrics persist by `scope + workspace`;
`/cd` and `/ws use` interrupt active runs in the previous workspace but preserve its session, metrics, and archives
so returning resumes it; `/new` and `/reset` clear only the current workspace. Pending cards and archive list/clean
operations are likewise scoped to the current workspace. Recent context snapshots are retained separately by native session and
canonical provider/model, so concurrent runs do not overwrite each other and stale identities remain hidden. Only the owner may refresh a member-isolated status card.

**Message and job reliability**: ordinary agent messages are deduplicated by Feishu `messageId` and atomically
written to the profile's mode-0600 `jobs.json` before entering the in-memory queue. After a process restart,
queued messages return to their original scope, thread, and workspace. Jobs that were running become
`interrupted`, retain their last safe checkpoint and run/native-session identity, and are not automatically
rerun because external side effects may already have happened. Reconcile with `/jobs`, inspect with
`/jobs show <message-id>`, and retry explicitly with `/jobs retry <message-id>`. `/status` and reconnect notices
include current-workspace ledger counts. This guarantee starts only after the bridge received and persisted an
event; an event that Feishu never delivered while the WebSocket was offline cannot be reconstructed locally.
If the initial write fails, the bot explicitly says the message was not accepted or executed and asks for a
resend. If the pre-execution `running` receipt fails, execution does not start and the job is either durably marked
`failed` or left `queued` for startup replay. A failed terminal write also produces a reconciliation warning; any
remaining `running` receipt becomes `interrupted` only after outbound delivery is ready, and its notice retries across restarts.

**Group session isolation**: admins can switch `/isolation group|topic|member` between one shared
group scope, per-topic scopes, and per-member scopes. `topic` remains the default. Switching only changes
how future messages are routed; existing sessions are retained and resume when their mode is selected again.
Stop, plan, approval and question actions created before a switch remain bound to their original scope, while
`/stop` also covers the actor's reachable pre-switch scopes. Member-isolated run cards show the sender open_id. Policies persist in
`~/.dsh-lark/profiles/<profile>/isolation.json`.

**Multi-role agents**: admins define roles (PM / dev / docs / …) with `/role save <id> <name> --persona <text> [--model <id>] [--tools <csv>] [--rules <text>]` and bind one to the current scope with `/role set <id>`; every run carries the role instructions, and the role model wins below the per-session `/model use` override. Role definitions persist in `~/.dsh-lark/profiles/<profile>/roles.json`.

**Multiple bot instances and @ handoff**:

```bash
dsh-lark-bot bot add reviewer --model gateway/review-model
dsh-lark-bot bot list
dsh-lark-bot bot status reviewer
dsh-lark-bot bot remove reviewer   # keeps session/worktree data
```

Each instance owns a bridge profile, `dsh-lark-<name>` profile, isolated
`~/.dsh-lark/bots/<name>/dsh` DSH_HOME, user service, Feishu/provider credentials,
model catalog and sessions/scopes/worktrees/archives. Set that instance's `DEEPSEEK_API_KEY` while running
`bot add`; custom provider secrets can be written to its isolated credential store with `/key set` after startup.
Adding or removing one does not restart the others.
`fleet.json` trusts only registered bot open_ids; an inbound bot must really @ this bot, and slash-prefixed bot text
is task input rather than an admin command. Agents receive exact peer open_ids and can use `lark_notify` for a
real handoff mention. The shared, message-id-deduplicated `handoffs.json` stops the fleet after six consecutive
bot handoffs by default; any fresh human message resets it, even without an @mention. Bot handoffs in a
member-isolated group use the receiving instance's group/topic scope so human approval cards remain operable.
Additional instances are kept alive by their own service; the guardian still rescues only its configured primary instance.
The primary `default` bot cannot be deleted with `bot remove`, so fleet lifecycle cannot damage the existing bot.
Additional instances support isolated `sdk` / `acp` runtimes (and legacy `headless`). Both `bot add` and startup
reject `web`, because a shared Web agent broadcast stream cannot isolate sessions between bot instances.

**Outbound mentions & cross-session notify**: `/notify <scope|chatId> <text>` pushes a report to another session (admin); the agent also gets a built-in `lark_notify` dsh tool (wired into both SDK and ACP runtime profiles) to push messages to other groups/topics and @mention members after a task finishes. The callback runs on 127.0.0.1 with a random per-boot token — nothing is exposed to the public network.

**Configurable proactive reminders**: the dsh Web profile default is off, and can be changed to completed/failed or all events. Any user can run `/notifications on current` for a scope override with one-time approval-wait reminders (10 minutes by default, mentioning the caller). `events=`, `mentions=`, and `remind=` customize it; admins may route to another registered `scope|chatId`. Preferences are atomically persisted and visible in `/status`; `/notifications off` is an explicit scope opt-out and `/notifications default` restores the Web default.

**Reply flow control**: immediate one-answer-per-task delivery remains the default. A profile admin or the current group owner/manager can run `/replies set merge=5 batch=3 interval=10 dedupe=60` for the current scope to group answers for 5 seconds, include at most 3 tasks per grouped message, wait at least 10 seconds between batches, and suppress near-identical tasks from the same sender and workspace for 60 seconds. While the bridge process remains alive, overflow stays queued and is not discarded because of the batch cap. `/replies` and `/status` show the effective policy; `/replies default` restores compatibility mode.

**Task execution modes**: send `/mode` to choose `quick` (direct answers with only necessary checks), `balanced` (the default balance of speed and reliability), or `deep` (thorough investigation and verification) from a bilingual card. `/mode quick|balanced|deep` and the `/effort` alias provide the text path. The selection persists per isolated scope and appears in `/status`. Each run snapshots its mode at startup, so changes affect only the next turn and never interrupt active work, clear context, or bypass permission/plan approval.

**Direct result-file delivery**: SDK / ACP / Web agents can call `lark_send_file` to upload a file from the current session workspace, its actual execution worktree, its scope archive, or the instance logs to the originating Feishu chat/topic. `/archive [note]` uploads its Markdown and JSONL after the durable local write; `/archive send <id> [scope|chatId]` retries locally or lets an admin forward it to a registered session. Only regular files up to 20 MiB are accepted by default. The resolved path must remain inside roots computed by the bridge; a runtime-supplied cwd never expands access.

**Per-action approval and scope policy**: the default SDK and Web host enforce a `tools/pre-execute` gate and wire dsh rc.8's official `approval/request` seam into Feishu; ACP uses native `session/request_permission`. The default `ask` policy shows **Allow once** / **Reject**. An admin may use `/permission allow` to auto-allow tool approvals in the current isolated scope, `/permission deny` to reject them with an explicit chat notice, or `/permission ask` to restore prompts. In member isolation, copy the target from `/status` and use `/permission <policy> <scope>`; cross-chat targets are rejected. Success is confirmed only after the owner-only `permission-policies.json` write completes, so policies survive restarts and appear in `/status`. They never bypass the separate plan gate; legacy `headless` has no tool callback channel.

**Plan gate for substantial tasks**: SDK / ACP / Web agents use `lark_request_plan_approval` before file
changes, scripts, or other substantial/high-risk actions. A runtime pre-execute policy denies writes, deletes,
moves, non-read-only shell commands and `run_code` until a plan is approved. Each approval grants only the next
high-risk call; later unplanned calls require approval again. Single read-only inspections such as `date`, `pwd`,
`ls`, `find`, `rg`, and `git status/log/diff` run directly. Inert SDK `bash` metadata (`description`,
`workdir`, and `run_in_background:false`) does not change that decision; unknown metadata, shell chaining,
redirection, command substitution, and unknown executables remain behind the conservative plan gate. The bridge sends the complete Markdown plan as a normal
message, then a card with **Approve and execute** / **Continue planning** plus optional feedback. The tool blocks
and pauses the idle watchdog; approval resumes the original turn, while revision returns the feedback and requires
another plan. There is no fixed ten-minute deadline: the gate follows the owning run's cancellation signal, and
stopping it cancels and recalls only that session's pending card. Trusted deployments may set
`DSH_LARK_PLAN_GATE=off` to disable this separate gate (ordinary per-tool approval still applies). The legacy headless adapter cannot use callback tools.

Plugin-controlled refusals now use `[policy-denial layer=<plan-gate|permission-policy|tool-approval>]`
followed by `reason` and `to change`; Harness `[sandbox: ...]` errors are identified as the
`file-sandbox` layer. The high-risk classifier, persona read-only guidance, and denial text share
`src/policy/tool-policy.ts`, so policy changes cannot update only the prompt or only enforcement.
The plan gate and per-tool approval retain distinct semantics: `/permission allow` neither expands
the file sandbox nor replaces plan confirmation.

**Mid-task questions (question cards)**: when the agent needs a decision, confirmation, or missing information, it sends a **question card** via the `lark_ask_user` tool (single choice / multi choice / free text). Submit the form or reply directly to that card with any text—even when none of the listed choices fits. The replied card message id selects the exact pending question, the agent resumes automatically, and the run-timeout watchdog pauses while it waits. (The opposite direction of `/ask`, where you ask the agent.)

Plan, approval and question-card submissions immediately show a native toast, post a terminal confirmation and recall the original card. Stale cards return an explicit error toast, while received actions and stale reasons are written to structured logs. Confirmation/recall failures do not change the decision already delivered to the agent. Local human-decision callbacks stream insignificant JSON whitespace while waiting so Node's HTTP client cannot invalidate a live card after five minutes.

**Safety-net guardian**: a minimal system-level resident process (systemd / LaunchAgent / Windows startup), independent of the dsh process and installed **by default with `setup`**. Silent while dsh runs, it takes over the Feishu channel when dsh goes down or fails to boot (e.g. a third-party plugin breaks the profile composition), so you can self-heal without touching the command line:

- `/safemode`: enter **core-only safe mode** (only the official `dsh-base` + `dsh-headless` bundles, **no third-party plugins**) — prefers the SDK streaming engine, falls back to headless, and lets you locate / fix / disable the offending plugin right from the chat;
- `/safemode plugins`: list the plugins installed into the broken profile; `/safemode status`: show state; `/safemode stop`: interrupt the current safe-mode task (or tap ⏹ on the card); `/safemode exit`: relaunch the full profile and hand the channel back.

Safe-mode tasks are bounded by an **idle timeout** (`DSH_LARK_GUARDIAN_SAFE_TIMEOUT_MS`, default 10 minutes, stopping only after a task has been silent the whole window); timeouts and failures always surface a clear terminal state. Install:

```bash
# Installed by default with setup (no extra flag); can also be installed / refreshed later:
dsh-lark-bot guardian install --dsh-profile dsh-lark
```

Skip it with `setup --no-guardian`; remove it later with `dsh-lark-bot guardian uninstall`.

**Normal-engine background service (issue #23)**: `setup` remains the only installation path. To keep the
same standard dsh profile running after the terminal closes and start it at login, opt into OS supervision:

```bash
dsh-lark-bot service install --profile dsh-lark
dsh-lark-bot service status --profile dsh-lark
dsh-lark-bot service logs --profile dsh-lark -n 200 -f
dsh-lark-bot service restart --profile dsh-lark
dsh-lark-bot service stop --profile dsh-lark
dsh-lark-bot service start --profile dsh-lark
dsh-lark-bot service uninstall --profile dsh-lark
```

Linux uses a systemd user unit when available and an XDG supervisor otherwise; macOS uses LaunchAgent and
Windows an at-logon scheduled task. Crashes restart automatically. Guardian and `upgrade --restart` prefer the
installed service, preventing duplicate launches. Sleep/offline periods cannot receive messages; after wake or
network recovery the SDK reconnects and posts a recovery notice to the most recently active conversation.
`stop`/`uninstall` persist an intentional-stop marker that guardian respects; install/start reject an existing
unmanaged foreground instance, and a lifecycle lock prevents concurrent double starts.

### Models / Providers / Credentials

Configuration is persisted the official dsh way (the same storage protocol as the dsh Web **Settings → Models** page); changes take effect on the next request without restarting the bot:

- **Interactive management hub**: `/providers` (or bare `/provider`, `/model`, `/key`) opens a
  management card. The active model is marked with ✅; tap another model or restore the default,
  effective on the next turn without losing context. BotFather-style multi-turn wizards cover add/update/remove flows — pick
  options (API protocol, provider, model, credential ref) with buttons, type values (ID, Base URL,
  model list, key value) into card inputs, review on a confirm card, and cancel any time.
- `/model use <provider/model>`: hot-switch an exact provider route (a unique bare model ID also works; effective next message); `/model default <id>`: write the dsh default model.
- `/providers`: show providers, models and credential status; `/provider add|update|remove`: manage custom providers (needs `--api` / `--base-url` / at least one `--model`, matching the official schema) or `deepseek-official`.
- `/key set|remove|list`: read / write `~/.dsh/.credentials.yaml` (0600); settings keep only `apiKeyEnv` references — literal keys never enter settings or chat history.
- **Hot reload**: before each run the bridge resolves the model into a `provider + model` route and
  passes it to the dsh runtime; the SDK adapter re-spawns the runtime automatically when the route
  changes (effective on the next message). A bare pi-ai Base URL (e.g. `https://www.kingapi.xyz`)
  is completed with `/v1` automatically.

Security note: never type a key in ordinary Feishu chat. Use the secure form or an `--api-key-env` environment reference. Legacy value-bearing commands are not consumed, and replies never echo values.

## Upgrade, Disable & Uninstall

### Upgrade

**No terminal required:** a profile admin sends `/upgrade` in Feishu/Lark. When a newer release exists, the bot sends an owner-bound confirmation card. Confirming hands the exact npm version to an isolated Guardian worker, which runs the full package/runtime-profile/guardian/profile upgrade and verification path, reloads the bot, and reports the result back to the original chat or thread. Cancel makes no changes. Reloading can interrupt active tasks; configuration, sessions, archives, and credentials are preserved. Every `/new` or `/reset` performs a best-effort npm check and emits one short plain reminder only when a newer version exists.

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
- **Runtime-profile consistency repair**: after upgrading, the own-package links of `dsh-lark-sdk` / `dsh-lark-acp` are re-pointed and stale SDK-server / ACP dependencies are idempotently reinstalled immediately.

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

**A:** Yes. After the one-command install and a QR scan, message the bot from the Feishu mobile app to drive your local dsh coding agent; tasks can also push cross-session notifications with @mentions when done. Install: `npx dsh-lark-bot@latest setup --profile dsh-lark` → `dsh --profile dsh-lark` → scan → start chatting.

**Q: How do I isolate projects and split work across a team?**

**A:** Each session automatically lands in an isolated git worktree with project-level `AGENTS.md` injected; admins define and bind roles with `/role` and manage the allowlist with `/invite`; up to 2 tasks run in parallel per chat by default (`/concurrency` to adjust), with `/archive` + `/retention` controlling archival and retention.

**Q: Does the bot still work if dsh crashes or goes offline?**

**A:** Yes. `setup` installs the safety-net guardian by default: when dsh crashes, the guardian takes over the Feishu channel and first tries to relaunch the full profile; if that still fails, send `/safemode` to enter core-only safe mode, fix the problem from the chat, and `/safemode exit` restores the full profile. No command line is needed.

### Common questions

**Q: How do I connect DeepSeek Harness to Feishu?**

**A:** Install Node.js ≥ 22 and DeepSeek Harness (with `DEEPSEEK_API_KEY` configured), run `npx dsh-lark-bot@latest setup --profile dsh-lark`, then `dsh --profile dsh-lark` and scan to bind. DM the bot directly; groups/topics use `@bot` by default, or can use the opt-in no-@ mode described below.

**Q: Do I need a public IP, domain or server?**

**A:** No. The Feishu channel uses an outbound WebSocket long connection, so it works behind NAT — no public server, domain or tunneling required.

**Q: How is dsh-lark-bot different from other DeepSeek Harness Feishu plugins (e.g. harness-lark)?**

**A:** The most complete nine-part feature set: safety-net guardian, multi-role agents, trusted multi-bot handoffs, parallel tasks, durable job reconciliation, session archival, cross-session proactive notifications, in-chat model/key management, and a plan-before-action gate. `setup` is the single install path; optional `service install` only asks the OS to supervise that same profile, not a second runtime.

**Q: Where do I download the project? Are there impostors?**

**A:** The only official repository is [github.com/PlutoKeating/dsh-lark-bot](https://github.com/PlutoKeating/dsh-lark-bot) and the only official npm packages are `dsh-lark-bot` / `dsh-feishu-bot` (maintainer `plutokeating`). This project never ships .exe or "download-and-run" installers; any repository or page distributing executables under the project's name is an impostor — do not run anything from it (see the "Impostor Repository Warning" at the end).

---

## Keywords

`dsh` · `deepseek` · `deepseek harness` · `feishu` · `lark` · `bridge` · `bot` ·
`chatbot` · `messaging` · `qrcode` · `typescript` · `feishu-bot` · `lark-bot` ·
`dsh-plugin` · `deepseek-harness` · `im-bridge` · `ai-agent` · `workspace` · `self-healing`

## Compatibility

- **DeepSeek Harness (`dsh`)**: verified against **dsh 0.1.0-rc.8** (last verified 2026-08-22: clean temporary install, SDK JSON-RPC / ACP initialize, tool/approval, live-session resume, and restart-collision probes), connected through the official `@deepseek-ai/dsh-sdk-client` / `@deepseek-ai/dsh-acp`; see [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) for exact pins and probing, [`docs/adapter-notes.md`](docs/adapter-notes.md) for adapter details, and [`docs/DSH_RC8_AUDIT.md`](docs/DSH_RC8_AUDIT.md) for rc.8 risks and verification boundaries.
- **Runtime**: Node.js ≥ 22.19 (see `engines` in `package.json`).
- **Platform**: Linux / macOS / Windows (Feishu outbound WebSocket long connection; no public server, domain or tunneling required).
- The default adapter is the official **`@deepseek-ai/dsh-sdk-client`** (SDK JSON-RPC runtime with native continuation, streaming events, dsh attachment-store image blocks, and the rc.8 approval answerer); `DSH_LARK_ADAPTER=acp` switches to the official **ACP server** with protocol-native approval; `headless` keeps the legacy subprocess fallback; `DSH_LARK_ADAPTER=web` drives the **local dsh web agent** (`session.prompt` + `/api/events.mux` — the web agent becomes the single writer, eliminating multi-writer session-log corruption at the root). On first start the bot creates the runtime profile at `~/.dsh/profiles/dsh-lark-sdk` (or `dsh-lark-acp`).

## Known limitations

- ACP sessions are always fresh (an upstream limit); the SDK protocol has no mid-turn cancel, so stopping a run closes and recreates only that run's isolated runtime. Other scopes and concurrent runs keep their own runtimes. Native SDK continuation is used only while this bridge process still owns the same live runtime; after restart, stop, or model switch the bridge creates a fresh session and replays its transcript instead of handing rc.8 a stale ID that would trigger `id collision`.
- The engine runs in-process as a dsh plugin; agent execution uses the official dsh SDK runtime subprocess — a deliberate nested-runtime design for scope/workspace cancellation domains and parallel runs. The one process-level exception is the safety-net guardian installed by default — a minimal resident process independent of dsh / Cordis that only takes over the Feishu channel after dsh goes down and stays silent otherwise.
- Feishu doc comments and rich-text replies are planned, not yet implemented.
- pnpm ≥ 10 build policy is handled by `setup`; when installing manually and `ERR_PNPM_IGNORED_BUILDS` appears, add `allowBuilds: { protobufjs: true }` to the profile's `pnpm-workspace.yaml` and retry.

## Configuration

### Visual settings in dsh Web (recommended)

Open local dsh Web and go to **Settings → Plugins → Plugin configuration → dsh-lark-bot**. The package ships its own browser half, so no fork or Web rebuild is required. The card edits the effective Feishu/Lark region, App ID and write-only App Secret, default workspace, model, per-session concurrency, adapter, and notification default. Credential, region, workspace and adapter changes safely reload the bridge generation; model, concurrency and reminder defaults hot-apply to subsequent work without interrupting an active run. The diagnostics panel directly checks common Web configuration failures, with `/status` and `/doctor` copy actions retained for deeper runtime diagnosis in bot chat. Remote read-only browsers are told to make changes from local Web; Feishu commands and environment variables remain the fallback when the settings service is unavailable.

- Local config: `~/.dsh-lark/config.json`
- The state root can be overridden with `DSH_LARK_HOME`
- Environment variables use the `DSH_LARK_*` prefix
- Template: [`.env.example`](.env.example)
- Sensitive values: credentials (`DSH_LARK_APP_SECRET`, `DEEPSEEK_API_KEY`, …) stay in local config/env only; logs and cards are redacted; only `.env.example` is committed.

When the session runs inside a Git repository, an isolated worktree is created at `~/.dsh-lark/profiles/<profile>/worktrees/<scope-slug>-<path-hash>/` and a project-level `AGENTS.md` is copied in. On upgrade, the legacy `<scope-slug>` worktree's owning repo is verified through Git: its session and retention archives are rebound to that real project and the tree is moved in place when it matches; if the current pointer already names another project, the old tree is preserved and a separate hashed tree is created for the new project.

Each Feishu scope + workspace keeps the last 40 conversation messages by default (adjustable with `/retention` or `DSH_LARK_RETENTION_MSGS`); messages beyond the retention window are archived to `~/.dsh-lark/profiles/<profile>/archives/` (Markdown + JSONL inside a Git repository, one commit per archive), and `/archive` exports, lists, and prunes only the current workspace session. The SDK mode continues the native dsh session, while headless mode approximates memory by injecting history into the next prompt.

Core environment variables:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `DSH_LARK_HOME` | `~/.dsh-lark` | Local state root directory |
| `DSH_LARK_TENANT` | `feishu` | `feishu` or `lark` |
| `DSH_LARK_WORKSPACE` | unset | Default working directory for new sessions |
| `DSH_LARK_DSH_COMMAND` | auto-discovered | dsh launch command; usually not needed |
| `DSH_LARK_DSH_ARGS` | auto-discovered | dsh launch args, comma-separated; usually not needed |
| `DSH_LARK_ADAPTER` | `sdk` | `sdk` (default, approval answerer) / `acp` (protocol-native approval) / `headless` (legacy) / `web` (local dsh web agent, single writer) |
| `DSH_LARK_PROVIDER` | unset | Model provider; may come from an object-form dsh default selection |
| `DSH_LARK_MODEL` | unset | Default model; may come from dsh `agent-default-model` |
| `DSH_LARK_MODEL_CATALOG_URL` | `https://models.dev/api.json` | Live provider/model capability feed or compatible mirror |
| `DSH_LARK_MAX_TOKENS` | unset | Per-request output token cap for SDK agents |
| `DSH_LARK_WEB_URL` | `http://127.0.0.1:3080` | `web` adapter: base URL of the local dsh web agent |
| `DSH_LARK_SESSION_PROJECTION` | `true` | `web` adapter: enable history/live message projection after explicit user binding; never auto-switches (`0` disables) |
| `DSH_LARK_SESSION_BACKFILL_MESSAGES` | `20` | Maximum human-facing messages in a confirmed history backfill |
| `DSH_LARK_SESSION_BACKFILL_BYTES` | `65536` | Maximum UTF-8 bytes disclosed by one transcript card |
| `DSH_LARK_SESSION_STREAM_UPDATE_MS` | `800` | Minimum update interval for one assistant projection card (minimum 400ms) |
| `DSH_LARK_WEB_PUSH` | unset | Deprecated compatibility alias, read as `DSH_LARK_SESSION_PROJECTION` only when the new switch is absent |
| `DSH_LARK_ACCESS_DEFAULT_DENY` | `false` | Reject private chats when no allowlist is configured |
| `DSH_LARK_EVENT_FRESHNESS_MS` | `600000` | Stale-message rejection window (0 disables) |
| `DSH_LARK_GROUP_NO_AT` | `false` | Process allowlisted live no-@ messages and poll registered group history; requires `im:message.group_msg` and a non-empty `allowed_users` list |
| `DSH_LARK_GROUP_POLL_MS` | `3000` | No-@ group polling interval in milliseconds (minimum 1000) |
| `DSH_LARK_BOT_HANDOFF_MAX` | `6` | Fleet-wide consecutive trusted-bot @ handoff limit (minimum 2; a human message resets it) |
| `DSH_LARK_RUN_TIMEOUT_MS` | `300000` | Idle timeout for a single run: stops only after the run has been silent for this long |
| `DSH_LARK_STOP_GRACE_MS` | `5000` | Grace period after SIGTERM before SIGKILL |
| `DSH_LARK_SCOPE_CONCURRENCY` | `2` | Concurrent runs per scope (1 = strictly serial) |
| `DSH_LARK_NOTIFICATION_DEFAULT` | `off` | Proactive default for scopes without an override: `off`, `completed`, or `all` |
| `DSH_LARK_RETENTION_MSGS` | `40` | Messages kept per scope + workspace (0 keeps everything) |
| `DSH_LARK_ARCHIVE_MAX` | `50` | Max archives kept per scope + workspace (0 disables pruning) |
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
| `DSH_LARK_UPGRADE_CHECK` | `1` | Whether `doctor` / `/version` / `/upgrade` / `/new` probe npm latest (`0` disables; best-effort) |
| `DSH_LARK_UPGRADE_CHECK_INTERVAL_MS` | `21600000` | Bridge new-version check interval (`0` disables; default 6h) |
| `DSH_LARK_UPGRADE_NOTIFY` | `false` | Push a Feishu notification to the target chat when a newer version is found (default: log-only) |
| `DSH_LARK_UPGRADE_NOTIFY_CHAT` | — | Chat receiving update notifications (with `DSH_LARK_UPGRADE_NOTIFY=true`) |

On startup the bot auto-discovers common local `@deepseek-ai/dsh` installations. Set these two variables only when auto-discovery fails or a special profile is required.

## Permissions & Data

This tool runs **locally**; before installing, be aware that it accesses:

- **Feishu credentials**: the PersonalAgent app `app_id` / `app_secret`, stored in plaintext at `~/.dsh-lark/config.json` (file mode 600).
- **Multi-bot identities and handoff state**: `fleet.json` (0600) stores instance/profile names, isolated DSH_HOME and bot open_id/name,
  never secrets; `handoffs.json` (0600) stores chat ids, recent handoff message ids and counters. Only a registered
  peer's real @mention enters the agent. Registered peer names/open_ids are included in every agent prompt and sent
  to the model provider so it can produce an exact @ handoff; handoff prompts/cards/replies remain visible to the shared group.
  Removing an instance deletes its Feishu config credentials, isolated `.credentials.yaml` and service env while
  retaining provider settings/runtime sessions in DSH_HOME and `profiles/<name>/` session/worktree data for recovery.
- **File system**: reads / writes the working directories you choose with `/cd` and `/ws` (including running shell commands and modifying files).
- **Network**: an outbound WebSocket long connection to the Feishu open platform for messages, and task context sent to the DeepSeek API.
- **Group events and optional history**: to recognize direct replies to question cards, live group events reach the bridge before its mention gate; unmentioned events that do not match a pending card are ignored. With `DSH_LARK_GROUP_NO_AT=true`, unmentioned live events enter the task pipeline and the bridge also polls previously registered groups/topics. Both paths enforce the current user/chat allowlists; historical messages must additionally be post-start and non-deleted, and are deduplicated against live events. Grant `im:message.group_msg` only after confirming that this matches your team's privacy policy.
- **Member-isolation identity and group visibility**: `member` mode writes the sender `open_id` into local
  session/scope-directory/worktree/archive indexes or paths derived from `isolation.json`, and shows it on the
  shared group run card. It isolates agent context, not group-message visibility: prompts, progress cards and
  replies remain visible to the group; other members cannot operate that member's run cards.
- **Local session usage**: adapter-reported input/output/cache tokens and context used/limit are stored per scope
  in `~/.dsh-lark/profiles/<profile>/sessions.json` (mode 0600) and displayed by `/status`. Only the member-scope
  owner can refresh its card, but a status card already sent to a shared group follows normal group visibility.
- **Diagnostic bundle**: an admin can send `/doctor` to generate an in-memory Markdown file and upload it to
  the original chat/thread. It contains versions, platform, non-sensitive configuration counts, current-workspace
  run/pending/job summaries, managed-service state, and bounded recent in-process bridge events; shared dsh host
  stdout is not read. It omits App ID/Secret,
  credential values, message bodies, and session transcripts; common secret patterns, known sensitive environment
  values, and the local home path are redacted again. A file posted in a group remains visible to group members, so
  prefer a DM and review it before forwarding. Generation waits and service commands are bounded. If an upload wait
  times out, the bot reports that delivery is unknown and may still arrive, preventing an immediate duplicate retry.
- **Durable job ledger**: `profiles/<profile>/jobs.json` (mode 0600) stores the original message body,
  attachment/mention metadata, chat/thread/scope, workspace, state, and safe checkpoints for jobs accepted by
  the bridge, retaining at most 500 terminal records. `/jobs` redacts its output and isolates it by current scope
  and workspace. Like `sessions.json`, the file can contain sensitive text deliberately placed in a prompt, so
  protect the profile directory and sanitize it before sharing. Hidden reasoning and tool arguments are not stored.
- **Scope routing**: `scopes.json` stores the chat/thread and latest inbound message id; that id is used only as
  the reply anchor that places later agent question cards back in the original topic.
- **Local callback**: `lark_notify`, `lark_send_file`, `lark_ask_user`, `lark_request_plan_approval`, and per-tool approval call the bridge over a
  random 127.0.0.1 port with a per-boot token (loopback only). Human-wait callbacks send response headers immediately
  and JSON-whitespace heartbeats while pending, so Node's default five-minute HTTP idle boundary cannot cancel a
  legitimate approval wait. Plan text and its decision card are sent to the
  current Feishu / Lark conversation. Approval reasons/arguments are visible to members of a shared group.
- **Processes**: spawns local `dsh` runtime subprocesses (`dsh-sdk-jsonrpc-server` / `dsh-acp` profiles) to run agent tasks.
- **dsh configuration**: `/model` `/providers` `/provider` `/key` read / write `~/.dsh/settings.yaml` and `~/.dsh/.credentials.yaml` using the official dsh storage protocol (admin-only writes; settings keep only `apiKeyEnv` references; credentials file mode 0600, directory 0700; literal keys never enter settings or chat history).
- **Safety-net guardian (installed by default with `setup`)**: a system-level resident process reads the Feishu credentials from `~/.dsh-lark/config.json`; it takes over the same bot's Feishu long connection only after dsh goes down and scans local processes (command lines via `ps` only, no memory access). On `/safemode` it provisions a core-only dsh profile (headless or SDK JSON-RPC runtime, both without third-party plugins) and runs one task per message; the SDK engine provides real-time streaming events via the official `dsh-sdk-jsonrpc-server` subprocess.
- **Optional normal-engine service**: `service install` registers the same standard dsh profile with the current
  user's OS service manager. A strict environment allowlist is snapshotted to
  `~/.dsh-lark/service/<profile>.env` (POSIX 0600; owner-only ACL on Windows); plist/task definitions contain no credentials. Logs go to
  `profiles/<profile>/logs/service.log`; uninstall removes the service entry and env snapshot while retaining configuration, sessions and logs.

All data flows only between this machine, Feishu and DeepSeek; nothing is collected or uploaded as telemetry. Keys are never committed to the repository (see `.gitignore`).

## Troubleshooting

Run `dsh-lark-bot doctor` first; it checks the profile and working directory and performs a real availability probe for the current adapter (`sdk` / `acp` / `headless` runtime handshake). When no-@ group polling is enabled, it also probes the history API against one registered group.
When the terminal is unavailable, an admin can send `/doctor` in Feishu/Lark to download a redacted runtime snapshot.
The chat command does not start a second adapter probe; the CLI command remains the full availability check.

Common issues:

- **Silent bot / long-connection failure**: run `service status` and `service logs -f` (or inspect stderr for a foreground profile), focusing on `channel` and `channel-command`. The SDK reconnects and posts a recovery notice to the latest active conversation. Messages cannot be received while the machine sleeps.
- **Unresponsive agent**: send `/status` to view the scope, cwd and active run; send `/stop` to terminate the current task; the idle watchdog terminates it automatically after it has been silent for `DSH_LARK_RUN_TIMEOUT_MS` (active streaming work is never cut short).
- **First QR binding fails**: make sure the local clock is accurate and the Feishu open platform is reachable; with an existing App ID/Secret you can skip scanning via `--app-id` / `--app-secret`.

The bridge engine logs JSON Lines to stderr (captured by the dsh host; `logs/bot.log` is a leftover path from the 0.6.0 standalone-service era and is no longer written since 0.7.0); the dsh host uses its own logging.

**Rollback**: remove the plugin and reinstall a pinned version (e.g. `dsh plugin --profile dsh-lark add dsh-lark-bot@0.6.0`); `~/.dsh-lark` state is independent of the package, so config and sessions survive upgrades / rollbacks.

## Development

**dsh-TUI compatibility boundary:** this package declares one root `dsh-plugin.json` with a v0.15 host facet
and runs `pnpm check:tui-admission` plus the real-PTY `pnpm check:tui-tty` after build. Optional TUI seams fail
softly; synchronization relies only on DSH history/events and never intercepts TUI input or session switches.
The facet is `trusted-in-process`, not a security sandbox. The project remains GNU AGPLv3; ecosystem listing
does not change the license or imply compatibility certification, security review, or endorsement.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm check:publish-bundle   # verifies dist matches every export & the CLI entry (release gate)
pnpm ci:local
pnpm release:check   # ci:local + upstream consistency check
pnpm compat:probe    # temp-installs pinned dsh; probes SDK/ACP plus SDK tool/resume
pnpm upstream:report # read-only dsh + dsh-TUI GitHub Release/npm source report
pnpm dsh:upstream    # backward-compatible alias for upstream:report
pnpm security:monitor # impostor-repo & npm copycat monitor (recommended weekly)
```

The repository's `upstream-release-watch` GitHub Actions workflow runs daily and can also be dispatched
manually. Its reviewed `trackFrom` baselines live in `scripts/upstream-release-config.mjs`. It merges every
non-draft GitHub Release with npm versions, publish times, and dist-tags, then creates one `upstream-update`
Issue per upstream/version. A later GitHub Release enriches the existing npm-only Issue, while hidden markers
deduplicate both open and closed Issues. This automation only transports sanitized, bounded release data; it
does not assess compatibility, modify dependencies/code, or create adaptation PRs.

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

The core idea: **decouple the Feishu channel from the agent backend**. The bridge layer follows the battle-tested `lark-channel-bridge` approach (WebSocket long-connection + streaming cards + session routing); the agent backend is abstracted behind an adapter, defaulting to the approval-enabled official DeepSeek Harness SDK (`DSH_LARK_ADAPTER=sdk`), with protocol-native ACP approval and a legacy headless fallback.

The safety-net guardian (`src/guardian/`) installed by default runs as a separate resident process: silent while dsh is up, it takes over the Feishu channel when dsh goes down, accepts `/safemode` control signals, runs a restricted core-only conversation (`dsh-base` + `dsh-headless`) for self-healing, and relaunches the full profile on `/safemode exit`.

## Directory Structure

| Directory | Responsibility |
| :--- | :--- |
| `src/bridge/` | Feishu channel integration |
| `src/onboard/` | First-run QR onboarding |
| `src/session/` | Session routing, queueing, access control |
| `src/workspace/` | Project workspace, git worktree isolation & rule injection |
| `src/adapters/` | Agent backend adapters (sdk / acp / headless / web single-writer) |
| `src/card/` | Streaming, approval, question and plan-decision cards |
| `src/bot/` | Run/queue, decision/isolation registries, multi-bot fleet and handoff guard |
| `src/commands/` | Slash commands |
| `src/diagnostics/` | In-memory `/doctor` bundle rendering, bounds, and second-pass redaction |
| `src/cli/` | CLI entry: setup / bot add/list/status/remove / service / doctor / upgrade / hidden runtime entries |
| `src/service/` | Cross-platform normal-profile supervision, private environment snapshot, status and logs |
| `src/upgrade/` | One-command upgrade (issues #10/#51): version/state detection, restarts, runtime links and dependency migration |
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

**Historical highlights follow-ups** (the then-current six capabilities and issue #6 design; see the nine-part list above for the current product):

- awesome-dsh-plugins leaderboard row sync (repo description → latest) & agent-test name anomaly: [#139](https://github.com/AdamPlatin123/awesome-dsh-plugins/issues/139) — 📨 submitted (maintainer confirmed; awaiting the snapshot/render cycle)
- dshfind detail page: add the in-chat model/key management highlight: [#2 follow-up](https://github.com/hikariming/dshfind/issues/2#issuecomment-5301019067) — 📨 submitted
- omdsh then-six-exclusive-highlights summary (incl. the Guardian design): [Discussion #11 highlights comment](https://github.com/orgs/omdsh-dev/discussions/11#discussioncomment-18026370) — 📨 submitted

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
