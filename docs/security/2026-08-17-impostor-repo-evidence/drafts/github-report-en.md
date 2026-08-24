---
status: READY · awaiting PlutoKeating manual form submission (no API channel)
channel: GitHub "Report content" on the repository page (or https://support.github.com/contact/report-content)
category: Spam / Deceptive practices (NOT DMCA — AGPL and attribution are preserved)
---

# Repository report: tarraencompassing61/dsh-lark-bot — deceptive practices / spam

I am PlutoKeating, the author and sole maintainer of the official repository
https://github.com/PlutoKeating/dsh-lark-bot (npm packages `dsh-lark-bot` / `dsh-feishu-bot`,
~3,600 weekly downloads). I am reporting https://github.com/tarraencompassing61/dsh-lark-bot
as a deceptive, de-forked copy of my project.

## Facts (all verifiable via the GitHub API and git history)

1. **Re-uploaded, not a fork.** The repository has `fork: false`, yet its entire history is
   my own: of 114 commits, 113 are authored by `PlutoKeating <PlutoKeating@outlook.com>`.
   The contributors API returns PlutoKeating 113 / tarraencompassing61 1. The account
   cloned my repository and pushed it back as a new repository to sever the upstream link.

2. **Only 4 files differ from my v0.7.0 snapshot** (tree-level `git diff`):
   - `.github/workflows/ci.yml` (deleted)
   - `.github/workflows/dsh-upstream.yml` (deleted — this removes the upstream-change radar)
   - `.github/workflows/release.yml` (deleted)
   - `README.md` (rewritten from ~906 bilingual lines to ~160 lines)

3. **Disguised commit.** The account's only commit (`4d6c01a`) reuses the exact commit title
   of my upstream commit `e4d3422`; its actual content deletes the CI and rewrites the README.

4. **Bait README with fake download links.** The rewritten README instructs visitors to
   "Download dsh-lark-bot" from Releases and "double-click the Windows executable". The
   project never ships executables — it is an npm package (dsh profile bundle) installed via
   `npx dsh-lark-bot@latest setup --profile dsh-lark`. The repository has **0 releases**, so
   every download link returns 404.

5. **Issues disabled.** `has_issues: false` prevents visitors from asking questions or being
   redirected to the official repository; pull requests are left open to look like a normal
   project.

6. **Throwaway account profile.** Created 2026-04-14, exactly 1 public repository (this one),
   0 followers/following, empty bio/company, commit email `francozoppi61@gmail.com`.

## Assessment

This matches the reconnaissance phase of a software supply-chain poisoning setup: build
search ranking for "dsh-lark-bot download", then attach trojanized "Windows installers" to
Releases once the repository ranks. The AGPL license and attribution are preserved, so this
is not a license complaint — it is deceptive practice: a disguised non-fork copy of another
author's history, fake download instructions, and disabled issue reporting.

## Evidence

Full evidence package (GitHub API snapshots, complete git bundle of this repository's
history, tree diff): see
https://github.com/PlutoKeating/dsh-lark-bot/blob/staging/docs/security/2026-08-17-impostor-repo-evidence/README.md

Requested action: review and remove or disable this repository for deceptive practices
before it can be used to distribute malware.
