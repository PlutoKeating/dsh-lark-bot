import { afterEach, describe, expect, it } from 'vitest';
import { resolveAppPaths } from '../../src/config/app-paths.js';

describe('resolveAppPaths', () => {
  const originalHome = process.env.DSH_LARK_HOME;

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.DSH_LARK_HOME;
    } else {
      process.env.DSH_LARK_HOME = originalHome;
    }
  });

  it('derives profile-scoped state paths from the root', () => {
    process.env.DSH_LARK_HOME = '/tmp/dsh-lark-test';
    const paths = resolveAppPaths();

    expect(paths.configFile).toBe('/tmp/dsh-lark-test/config.json');
    expect(paths.botDshHome('reviewer')).toBe('/tmp/dsh-lark-test/bots/reviewer/dsh');
    expect(paths.sessionsFile('main')).toBe(
      '/tmp/dsh-lark-test/profiles/main/sessions.json',
    );
    expect(paths.jobsFile('main')).toBe('/tmp/dsh-lark-test/profiles/main/jobs.json');
    expect(paths.notificationPreferencesFile('main')).toBe('/tmp/dsh-lark-test/profiles/main/notification-preferences.json');
    expect(paths.replyPoliciesFile('main')).toBe('/tmp/dsh-lark-test/profiles/main/reply-policies.json');
    expect(paths.mediaDir('main')).toBe('/tmp/dsh-lark-test/profiles/main/media');
    expect(paths.logsDir('main')).toBe('/tmp/dsh-lark-test/profiles/main/logs');
    expect(paths.archivesDir('main')).toBe(
      '/tmp/dsh-lark-test/profiles/main/archives',
    );
  });
});
