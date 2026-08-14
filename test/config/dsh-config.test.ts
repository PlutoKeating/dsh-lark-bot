import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  AGENT_DEFAULT_MODEL_NAMESPACE,
  DEEPSEEK_PROVIDER,
  PIAI_NAMESPACE,
  DshProviderManager,
} from '../../src/config/dsh-config.js';

async function withHome(run: (root: string, manager: DshProviderManager) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lark-dsh-'));
  const manager = new DshProviderManager({ home: root, env: {} });
  try {
    await run(root, manager);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('DshProviderManager', () => {
  it('reports the deepseek provider with default models when settings are empty', async () => {
    await withHome(async (_root, manager) => {
      const providers = await manager.listProviders();
      expect(providers.length).toBe(1);
      const deepseek = providers[0];
      expect(deepseek?.id).toBe(DEEPSEEK_PROVIDER);
      expect(deepseek?.models.map((model) => model.id)).toEqual([
        'deepseek-v4-flash',
        'deepseek-v4-pro',
      ]);
      expect(deepseek?.credentialRef).toBe('DEEPSEEK_API_KEY');
      expect(deepseek?.credentialReady).toBe(false);
    });
  });

  it('writes and reads the official agent-default-model section without touching other namespaces', async () => {
    await withHome(async (_root, manager) => {
      await manager.setDefaultModel('deepseek-v4-pro');
      expect(await manager.defaultModel()).toBe('deepseek-v4-pro');

      await manager.upsertDeepseekProvider({ baseURL: 'https://api.deepseek.com' });
      const settings = await manager.readSettings();
      expect(settings[AGENT_DEFAULT_MODEL_NAMESPACE]).toEqual({ model: 'deepseek-v4-pro' });
      expect((settings['llm-deepseek'] as { baseURL: string }).baseURL).toBe('https://api.deepseek.com');
    });
  });

  it('adds a pi-ai custom provider matching the official schema and preserves exotic model fields', async () => {
    await withHome(async (root, manager) => {
      await manager.upsertPiAiProvider({
        id: 'acme-gateway',
        displayName: 'Acme Gateway',
        apiKeyEnv: 'ACME_API_KEY',
        api: 'openai-completions',
        baseURL: 'https://gateway.example/v1',
        models: [
          { id: 'acme-large', name: 'Acme Large', contextWindow: 65536, maxTokens: 4096 },
        ],
      });

      let settings = await manager.readSettings();
      const piAi = settings[PIAI_NAMESPACE] as {
        providers: Record<string, { api: string; baseURL: string; models: Array<Record<string, unknown>> }>;
      };
      expect(piAi.providers['acme-gateway']?.api).toBe('openai-completions');
      expect(piAi.providers['acme-gateway']?.models[0]?.id).toBe('acme-large');

      // The Web UI may write fields the bot does not model (input); a later
      // bot model operation must not drop them.
      const raw = (await manager.readSettings())[PIAI_NAMESPACE] as {
        providers: Record<string, { models: Array<Record<string, unknown>> }>;
      };
      raw.providers['acme-gateway']!.models.push({ id: 'vision-preview' });
      raw.providers['acme-gateway']!.models.push({ id: 'extra', input: ['text', 'image'] });
      await writeFile(join(root, '.dsh', 'settings.yaml'), stringify({ [PIAI_NAMESPACE]: raw }));
      await manager.removePiAiModel('acme-gateway', 'vision-preview');

      settings = await manager.readSettings();
      const models = (settings[PIAI_NAMESPACE] as {
        providers: Record<string, { models: Array<Record<string, unknown>> }>;
      }).providers['acme-gateway']!.models;
      expect(models.map((model) => model.id)).toEqual(['acme-large', 'extra']);
      expect(models[1]?.input).toEqual(['text', 'image']);
    });
  });

  it('rejects a new pi-ai provider without api/base-url/models and rejects unknown protocols', async () => {
    await withHome(async (_root, manager) => {
      await expect(
        manager.upsertPiAiProvider({ id: 'bad-gateway' }),
      ).rejects.toThrow(/--api/);
      await expect(
        manager.upsertPiAiProvider({
          id: 'bad-gateway',
          api: 'chat-completions',
          baseURL: 'https://gateway.example/v1',
          models: [{ id: 'm', name: undefined, contextWindow: undefined, maxTokens: undefined }],
        }),
      ).rejects.toThrow(/不支持的 API 协议/);
    });
  });

  it('removes the last pi-ai provider and drops the whole namespace', async () => {
    await withHome(async (_root, manager) => {
      await manager.upsertPiAiProvider({
        id: 'only-gateway',
        api: 'openai-completions',
        baseURL: 'https://gateway.example/v1',
        models: [{ id: 'm', name: undefined, contextWindow: undefined, maxTokens: undefined }],
      });
      expect(await manager.removePiAiProvider('only-gateway')).toBe(true);
      const settings = await manager.readSettings();
      expect(settings[PIAI_NAMESPACE]).toBeUndefined();
    });
  });

  it('stores credentials with 0600 permissions, preserves comments and validates refs', async () => {
    await withHome(async (root, manager) => {
      await manager.setCredential('OPENAI_API_KEY', 'sk-test');
      const file = join(root, '.dsh', '.credentials.yaml');
      const mode = (await stat(file)).mode & 0o777;
      expect(mode).toBe(0o600);

      // a comment above an entry must survive the next patch
      await writeFile(file, '# my key\nOPENAI_API_KEY: sk-test\n', { mode: 0o600 });
      await manager.setCredential('ANOTHER_KEY', 'v2');
      const text = await readFile(file, 'utf8');
      expect(text).toContain('# my key');
      expect(text).toContain('ANOTHER_KEY: v2');
      expect(text).toContain('OPENAI_API_KEY: sk-test');

      expect(await manager.listCredentialRefs()).toEqual(
        expect.arrayContaining(['OPENAI_API_KEY', 'ANOTHER_KEY']),
      );
      expect(await manager.hasCredential('OPENAI_API_KEY')).toBe(true);
      expect(await manager.removeCredential('OPENAI_API_KEY')).toBe(true);
      expect(await manager.hasCredential('OPENAI_API_KEY')).toBe(false);

      await expect(manager.setCredential('not valid!', 'x')).rejects.toThrow(/非法凭据引用名/);
      // env wins for existence checks
      const envManager = new DshProviderManager({
        home: root,
        env: { DEEPSEEK_API_KEY: 'sk-env' },
      });
      expect(await envManager.hasCredential('DEEPSEEK_API_KEY')).toBe(true);
    });
  });
});
