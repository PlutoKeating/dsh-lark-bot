# dsh-TUI v0.15 conformance evidence

This directory binds the `io.github.plutokeating.dsh-lark-bot@0.19.1` host facet to the pinned
TUI Admission revision `e1b902b0f95f4280a8e68d414ec7a4d25d6ce106` and its vendored dsh-std revision
`614dfa1ac168db79fcf4577cf0ebb34e2e3b944b`.

- `host-descriptor.local.json` and `host-descriptor.remote.json` are separate test profiles.
- `claim.*.json` binds each descriptor digest to the exact built `dist/plugin.js` digest.
- `pnpm check:tui-admission` validates the unique manifest, all lockfile package integrities, then performs a
  real `npm pack` + clean temporary consumer install and re-hashes the installed host facet.
- `pnpm check:tui-tty` allocates a real PTY and loads the published `dist/plugin.js` inside it, using the
  util-linux `script` form on Linux and the positional BSD form on macOS. Windows fails closed until equivalent
  external ConPTY evidence is supplied.
- `test/tui/*.test.ts` covers all five decisions, local/remote/container profiles, repeated activation,
  optional-seam absence/failure and deterministic cleanup. The plugin never caches or consumes a Presentation.

On 2026-08-20, the pinned upstream `npm run test:standalone` suite passed, and the same built
`@dsh-std/manifest` parser accepted/projected this repository's `dsh-plugin.json` with no validation errors.
Reproduce from a clean temporary checkout:

```bash
git clone https://github.com/T-Auto/dsh-ecosystem-spec.git
git -C dsh-ecosystem-spec checkout e1b902b0f95f4280a8e68d414ec7a4d25d6ce106
npm --prefix dsh-ecosystem-spec run test:standalone
```

The claims are test evidence, not observation of every host deployment and not attestation. They do not mean
security certification, official endorsement, universal host compatibility, or a license exception. This project
remains independently maintained under GNU AGPLv3.
