import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SdkDshAdapter } from '../../src/adapters/dsh/sdk-adapter.js';
import {
  ensureSdkProfile,
  resolveSdkLaunch,
} from '../../src/adapters/dsh/sdk-runtime.js';

const enabled = process.env.DSH_LARK_E2E === '1';

/**
 * Regression for issue #47: the dsh SDK runtime registers llm-pi-ai provider
 * routes asynchronously a few hundred ms after boot, so an immediate
 * initialize handshake used to fail with "no adapter registered for provider
 * <id>". The adapter must poll initialize on the same subprocess until the
 * routes are registered.
 *
 * Run with:
 *   DSH_LARK_E2E=1 DSH_LARK_E2E_HOME=/tmp/dshrepro-fixed \
 *     pnpm vitest run test/e2e/pi-ai-race.e2e.test.ts
 *
 * DSH_LARK_E2E_HOME must contain a prepared throwaway dsh home with
 * settings.yaml (llm-pi-ai.providers.kingapi) and a symlinked
 * profiles/node_modules shared store; the test creates the SDK runtime
 * profile there.
 */
describe.skipIf(!enabled)('pi-ai registration race (DSH_LARK_E2E=1)', () => {
  it('registers a pi-ai provider and survives the async boot race', async () => {
    const root =
      process.env.DSH_LARK_E2E_HOME ??
      (await mkdtemp(join('/tmp', 'dsh-repro-')));
    try {
      const profilesNodeModules = join(
        process.env.DSH_SHARED_STORE ?? '/home/pluto/.dsh/profiles/node_modules',
      );
      await mkdir(join(root, 'profiles'), { recursive: true });
      try {
        await symlink(profilesNodeModules, join(root, 'profiles', 'node_modules'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      await writeFile(
        join(root, 'settings.yaml'),
        [
          'llm-deepseek:',
          '  apiKeyEnv: DEEPSEEK_API_KEY',
          'llm-pi-ai:',
          '  providers:',
          '    kingapi:',
          '      api: openai-completions',
          '      baseURL: https://www.kingapi.xyz/v1',
          '      apiKeyEnv: KINGAI_API_KEY',
          '      models:',
          '        - id: doubao-seed-2-0-lite-260428',
          '',
        ].join('\n'),
      );
      await writeFile(
        join(root, '.credentials.yaml'),
        'DEEPSEEK_API_KEY: sk-dummy-deepseek\nKINGAI_API_KEY: sk-dummy-kingapi\n',
        { mode: 0o600 },
      );

      const env = {
        ...process.env,
        DSH_HOME: root,
        DSH_LARK_NOTIFY_URL: 'http://127.0.0.1:1/n',
        DSH_LARK_NOTIFY_TOKEN: 't',
        DSH_LARK_ASK_URL: 'http://127.0.0.1:1/a',
      };
      const ensure = await ensureSdkProfile({ home: homedir(), env });
      expect(ensure.ok).toBe(true);

      const launch = resolveSdkLaunch({ home: homedir(), env });
      const previousDshHome = process.env.DSH_HOME;
      process.env.DSH_HOME = root;
      try {
        const adapter = new SdkDshAdapter({
          launch,
          provider: 'deepseek-official',
          model: 'deepseek-v4-flash',
          probeTimeoutMs: 30_000,
        });
        try {
          // Handshake must survive the race; with a dummy key the actual
          // gateway call may 401, but initialize must not fail with
          // "no adapter registered".
          const availability = await adapter.checkAvailability();
          expect(availability.ok).toBe(true);

          const run = adapter.run({
            runId: 'e2e-pi-ai',
            prompt: 'hello',
            cwd: '/tmp',
            sessionId: undefined,
            provider: 'kingapi',
            model: 'doubao-seed-2-0-lite-260428',
            images: undefined,
            stopGraceMs: undefined,
          });
          const events = [];
          for await (const event of run.events) events.push(event);
          const error = events.find((event) => event.type === 'error');
          expect(String(error?.message ?? '')).not.toMatch(/no adapter registered/i);
        } finally {
          await adapter.dispose();
        }
      } finally {
        if (previousDshHome === undefined) delete process.env.DSH_HOME;
        else process.env.DSH_HOME = previousDshHome;
      }
    } finally {
      if (!process.env.DSH_LARK_E2E_HOME) {
        await rm(root, { recursive: true, force: true });
      }
    }
  }, 120_000);
});
