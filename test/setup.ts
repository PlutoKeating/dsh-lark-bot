import { afterEach, beforeEach } from 'vitest';

// Hermetic test harness (wired as vitest `setupFiles`).
//
// The dsh runtime resolves its home from the ambient `DSH_HOME` whenever a
// caller does not pass an explicit `env` (see `src/config/dsh-runtime.ts`,
// `resolveDshHome`). A live dsh-lark-bot always sets `DSH_HOME`, so without
// isolation the profile-building tests (`sdk-runtime`, `acp-runtime`,
// `own-package`, `safe-profile`, and the channel config suite) silently resolve
// to the LIVE dsh profile instead of the temp `home` they construct.
//
// That live profile's `node_modules/dsh-lark-bot` is a symlink back to this
// repository, so a fixture that writes a fake `package.json` under it follows
// the symlink and overwrites the real repository manifest. This was reproduced
// as a workspace-corrupting failure (`git status` showing `package.json`
// replaced by `{"name":"dsh-lark-bot","version":"0.9.0",...}`).
//
// To keep the suite hermetic we clear the ambient `DSH_HOME` before every
// test, so profile helpers fall back to `join(home, '.dsh')` under each test's
// own temp home. Tests that deliberately exercise a `DSH_HOME` override set it
// explicitly inside their body (they are unaffected: the delete runs before the
// test, and their assignment runs after).
const DSH_HOME = 'DSH_HOME';
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[DSH_HOME];
  delete process.env[DSH_HOME];
});

afterEach(() => {
  if (saved === undefined) {
    delete process.env[DSH_HOME];
  } else {
    process.env[DSH_HOME] = saved;
  }
});
