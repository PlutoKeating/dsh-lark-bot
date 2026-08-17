---
status: Published · https://github.com/tarraencompassing61/dsh-lark-bot/pull/1
channel: pull request to tarraencompassing61/dsh-lark-bot
---

# PR title

`This repository is an outdated copy of the official project — please point visitors to the official repo`

# PR body

Hi maintainers,

This repository is not an independent project: it is a re-uploaded copy of
[PlutoKeating/dsh-lark-bot](https://github.com/PlutoKeating/dsh-lark-bot). Of the 114 commits
here, 113 are authored by PlutoKeating (the official maintainer); only the CI workflows and
the README differ from the official v0.7.0 snapshot. The README's "download the Windows
executable" instructions are inaccurate — the official project is an npm package (dsh
profile bundle) installed with:

```bash
npx dsh-lark-bot@latest setup --profile dsh-lark
```

It never ships executables, and this repository currently has zero releases (every download
link 404s).

The official repository is at https://github.com/PlutoKeating/dsh-lark-bot (currently
v0.14.0; this copy is stuck at v0.7.0). Evidence:
https://github.com/PlutoKeating/dsh-lark-bot/blob/staging/docs/security/2026-08-17-impostor-repo-evidence/README.md

I suggest pointing this repository's README at the official project or archiving this
repository to avoid confusing visitors.

---

> This post was guided and reviewed by PlutoKeating and published via dsh-lark-bot.
