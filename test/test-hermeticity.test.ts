import { describe, expect, it } from 'vitest';

// Regression guard for the test-hermeticity invariant enforced by test/setup.ts.
//
// The dsh profile helpers resolve their home from the ambient `DSH_HOME`. A
// running dsh-lark-bot always sets it, so without isolation the profile tests
// would target the LIVE dsh profile, whose `node_modules/dsh-lark-bot` is a
// symlink back to this repo — letting a fixture write overwrite the real
// package.json (reproduced: `git status` showing the manifest replaced by
// `{"name":"dsh-lark-bot","version":"0.9.0",...}`).
//
// This test asserts the suite runs hermetically and fails loudly if the
// harness stops isolating `DSH_HOME` (e.g. setupFiles is dropped) on a machine
// that has `DSH_HOME` set. CI never sets `DSH_HOME`, so it stays green there.
describe('test hermeticity', () => {
  it('does not inherit the ambient DSH_HOME from the running bot', () => {
    expect(process.env.DSH_HOME).toBeUndefined();
  });
});
