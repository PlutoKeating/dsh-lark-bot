import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  AGENT_DEFAULT_MODEL_NAMESPACE,
  DEEPSEEK_PROVIDER,
  PIAI_NAMESPACE,
  DshProviderManager,
  isVisionModelId,
  normalizeBaseUrl,
  normalizeDeepseekBaseUrl,
  normalizeVisionModelInputModalities,
} from '../../src/config/dsh-config.js';
import type { ModelCatalog } from '../../src/config/model-catalog.js';

const catalog: ModelCatalog = {
  listProviders: async () => [{
    id: 'catalog-provider',
    name: 'Catalog Provider',
    api: 'https://api.catalog.example',
    env: ['DEEPSEEK_API_KEY'],
    models: [
      { id: 'catalog-text', name: 'Catalog Text', contextWindow: 1000, maxTokens: 100 },
      {
        id: 'catalog-vision',
        name: 'Catalog Vision',
        contextWindow: 2000,
        maxTokens: 200,
        inputModalities: ['text', 'image'],
        reasoningEfforts: ['small', 'large'],
      },
    ],
  }],
};

async function withHome(run: (root: string, manager: DshProviderManager) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lark-dsh-'));
  const manager = new DshProviderManager({ home: root, env: {}, catalog });
  try {
    await run(root, manager);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('DshProviderManager', () => {
  it('keeps the configured default route available when the first catalog refresh fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-dsh-offline-'));
    const settingsFile = join(root, '.dsh', 'settings.yaml');
    await mkdir(join(root, '.dsh'), { recursive: true });
    await writeFile(settingsFile, stringify({
      [AGENT_DEFAULT_MODEL_NAMESPACE]: {
        provider: DEEPSEEK_PROVIDER,
        model: 'deepseek-v4-flash-vision-exp',
      },
    }), { mode: 0o600 });
    const manager = new DshProviderManager({
      home: root,
      env: {},
      catalog: {
        listProviders: async () => {
          throw new Error('catalog offline');
        },
      },
    });

    try {
      const providers = await manager.listProviders();
      expect(providers.find((provider) => provider.id === DEEPSEEK_PROVIDER)?.models)
        .toContainEqual(expect.objectContaining({ id: 'deepseek-v4-flash-vision-exp' }));
      expect(await manager.resolveModelRoute(
        `${DEEPSEEK_PROVIDER}/deepseek-v4-flash-vision-exp`,
      )).toEqual({
        provider: DEEPSEEK_PROVIDER,
        model: 'deepseek-v4-flash-vision-exp',
      });
      expect(await manager.resolveModelRoute(`${DEEPSEEK_PROVIDER}/unknown-model`))
        .toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('discovers provider names, models, modalities, and efforts from the runtime catalog', async () => {
    await withHome(async (_root, manager) => {
      const providers = await manager.listProviders();
      expect(providers.length).toBe(1);
      const deepseek = providers[0];
      expect(deepseek?.id).toBe(DEEPSEEK_PROVIDER);
      expect(deepseek?.displayName).toBe('Catalog Provider');
      expect(deepseek?.models.map((model) => model.id)).toEqual([
        'catalog-text',
        'catalog-vision',
      ]);
      expect(deepseek?.models[1]?.inputModalities).toEqual(['text', 'image']);
      expect(deepseek?.models[1]?.reasoningEfforts).toEqual(['small', 'large']);
      expect(deepseek?.credentialRef).toBe('DEEPSEEK_API_KEY');
      expect(deepseek?.credentialReady).toBe(false);
    });
  });

  it('writes provider+model into the official agent-default-model section without touching other namespaces', async () => {
    await withHome(async (_root, manager) => {
      await manager.setDefaultModel('catalog-text');
      expect(await manager.defaultModel()).toBe('catalog-text');
      expect(await manager.defaultModelSelection()).toEqual({
        provider: DEEPSEEK_PROVIDER,
        model: 'catalog-text',
      });

      await manager.upsertDeepseekProvider({ baseURL: 'https://api.deepseek.com' });
      const settings = await manager.readSettings();
      expect(settings[AGENT_DEFAULT_MODEL_NAMESPACE]).toEqual({
        provider: DEEPSEEK_PROVIDER,
        model: 'catalog-text',
      });
      expect((settings['llm-deepseek'] as { baseURL: string }).baseURL).toBe('https://api.deepseek.com');
    });
  });

  it('rejects a default model that no configured provider owns', async () => {
    await withHome(async (_root, manager) => {
      await expect(manager.setDefaultModel('no-such-model')).rejects.toThrow(/未在任何已配置 provider 中找到/);
    });
  });

  it('resolves a model to its owning provider, preferring explicit pi-ai entries over deepseek defaults', async () => {
    await withHome(async (_root, manager) => {
      expect(await manager.resolveModelRoute('catalog-text')).toEqual({
        provider: DEEPSEEK_PROVIDER,
        model: 'catalog-text',
      });
      expect(await manager.resolveModelRoute('deepseek-official/catalog-text')).toEqual({
        provider: DEEPSEEK_PROVIDER,
        model: 'catalog-text',
      });
      expect(await manager.resolveModelRoute('missing/catalog-text')).toBeUndefined();

      await manager.upsertPiAiProvider({
        id: 'kingapi',
        api: 'openai-completions',
        baseURL: 'https://www.kingapi.xyz',
        models: [
          {
            id: 'doubao-seed-2-0-lite-260428',
            name: undefined,
            contextWindow: undefined,
            maxTokens: undefined,
          },
          {
            id: 'catalog-text',
            name: undefined,
            contextWindow: undefined,
            maxTokens: undefined,
          },
        ],
      });
      expect(await manager.resolveModelRoute('doubao-seed-2-0-lite-260428')).toEqual({
        provider: 'kingapi',
        model: 'doubao-seed-2-0-lite-260428',
      });
      // Explicitly configured model wins over the deepseek built-in catalog.
      expect(await manager.resolveModelRoute('catalog-text')).toEqual({
        provider: 'kingapi',
        model: 'catalog-text',
      });
    });
  });

  it('normalizes base URLs: bare origin to /v1, full API endpoints trimmed', async () => {
    expect(normalizeBaseUrl('https://www.kingapi.xyz')).toBe('https://www.kingapi.xyz/v1');
    expect(normalizeBaseUrl('https://kingapi.xyz/')).toBe('https://kingapi.xyz/v1');
    expect(normalizeBaseUrl('https://kingapi.xyz/v1/chat/completions')).toBe(
      'https://kingapi.xyz/v1',
    );
    expect(normalizeBaseUrl('https://kingapi.xyz/chat/completions')).toBe(
      'https://kingapi.xyz/v1',
    );
    expect(normalizeBaseUrl('https://gateway.example/v1/messages')).toBe(
      'https://gateway.example/v1',
    );
    expect(normalizeBaseUrl('https://gateway.example/v1/responses')).toBe(
      'https://gateway.example/v1',
    );
    expect(normalizeBaseUrl('https://gateway.example/v1')).toBe('https://gateway.example/v1');
    expect(() => normalizeBaseUrl('not a url')).toThrow(/不是合法 URL/);
  });

  it('normalizes the deepseek official base URL without forcing /v1', async () => {
    expect(normalizeDeepseekBaseUrl('https://api.deepseek.com')).toBe('https://api.deepseek.com');
    expect(normalizeDeepseekBaseUrl('https://api.deepseek.com/v1/chat/completions')).toBe(
      'https://api.deepseek.com/v1',
    );
    expect(normalizeDeepseekBaseUrl('https://api.deepseek.com/chat/completions')).toBe(
      'https://api.deepseek.com',
    );
    expect(() => normalizeDeepseekBaseUrl('not a url')).toThrow(/不是合法 URL/);
  });

  it('links a credential ref to a same-named pi-ai provider missing apiKeyEnv', async () => {
    await withHome(async (_root, manager) => {
      await manager.upsertPiAiProvider({
        id: 'kingapi',
        api: 'openai-completions',
        baseURL: 'https://www.kingapi.xyz/v1',
        models: [
          {
            id: 'doubao-seed-2-0-lite-260428',
            name: undefined,
            contextWindow: undefined,
            maxTokens: undefined,
          },
        ],
      });
      // No credential yet -> no link.
      expect(await manager.linkCredentialRefIfMissing('kingapi')).toBe(false);
      await manager.setCredential('kingapi', 'sk-secret');
      expect(await manager.linkCredentialRefIfMissing('kingapi')).toBe(true);
      // Idempotent.
      expect(await manager.linkCredentialRefIfMissing('kingapi')).toBe(false);
      const settings = await manager.readSettings();
      const section = (
        (settings[PIAI_NAMESPACE] as { providers: Record<string, Record<string, unknown>> })
          .providers
      )['kingapi'];
      expect(section?.['apiKeyEnv']).toBe('kingapi');
      expect(section?.['baseURL']).toBe('https://www.kingapi.xyz/v1');
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

  it('persists and reports model input modalities added through the bot', async () => {
    await withHome(async (root, manager) => {
      await manager.addDeepseekModel({
        id: 'custom-vision',
        name: 'Custom Vision',
        contextWindow: undefined,
        maxTokens: undefined,
        inputModalities: ['text', 'image'],
      });

      const settings = await readFile(join(root, '.dsh', 'settings.yaml'), 'utf8');
      expect(settings).toContain('inputModalities:');
      expect(settings).toContain('- image');
      const provider = (await manager.listProviders())[0];
      expect(provider?.models.find((model) => model.id === 'custom-vision')?.inputModalities)
        .toEqual(['text', 'image']);
    });
  });

  it('defaults vision model modalities to text+image even when unset (issue #96)', async () => {
    await withHome(async (root, manager) => {
      // A vision model added through /model add WITHOUT --input-modalities must
      // still be persisted with ['text','image'] so the harness accepts images.
      await manager.addDeepseekModel({
        id: 'deepseek-v4-flash-vision-exp',
        name: 'Vision Flash',
        contextWindow: undefined,
        maxTokens: undefined,
        inputModalities: undefined,
      });

      const settings = await readFile(join(root, '.dsh', 'settings.yaml'), 'utf8');
      expect(settings).toContain('- image');
      const provider = (await manager.listProviders())[0];
      expect(
        provider?.models.find((model) => model.id === 'deepseek-v4-flash-vision-exp')
          ?.inputModalities,
      ).toEqual(['text', 'image']);
    });
  });

  it('persists the selected DeepSeek vision model in the runtime catalog idempotently', async () => {
    await withHome(async (root, manager) => {
      const settingsFile = join(root, '.dsh', 'settings.yaml');
      await mkdir(join(root, '.dsh'), { recursive: true });
      await writeFile(settingsFile, [
        '# keep this deployment comment',
        'llm-deepseek:',
        '  baseURL: https://api.deepseek.com',
        '  models:',
        '    - id: deepseek-chat',
        '      description: keep this exotic field',
        '    - id: deepseek-v4-flash-vision-exp',
        '      name: Vision Preview',
        'agent-default-model:',
        '  provider: deepseek-official',
        '  model: deepseek-v4-flash-vision-exp',
        '',
      ].join('\n'));

      expect(await manager.resolveRuntimeModelRoute(
        `${DEEPSEEK_PROVIDER}/deepseek-v4-flash-vision-exp`,
      )).toEqual({
        provider: DEEPSEEK_PROVIDER,
        model: 'deepseek-v4-flash-vision-exp',
      });
      const first = await readFile(settingsFile, 'utf8');
      expect(first).toContain('# keep this deployment comment');
      expect(first).toContain('description: keep this exotic field');
      const settings = await manager.readSettings();
      const models = (settings['llm-deepseek'] as {
        models: Array<Record<string, unknown>>;
      }).models;
      expect(models.find((model) => model.id === 'deepseek-v4-flash-vision-exp'))
        .toMatchObject({
          id: 'deepseek-v4-flash-vision-exp',
          name: 'Vision Preview',
          inputModalities: ['text', 'image'],
        });

      expect(await manager.resolveRuntimeModelRoute(
        `${DEEPSEEK_PROVIDER}/deepseek-v4-flash-vision-exp`,
      )).toEqual({
        provider: DEEPSEEK_PROVIDER,
        model: 'deepseek-v4-flash-vision-exp',
      });
      expect(await readFile(settingsFile, 'utf8')).toBe(first);
    });
  });

  it('does not rewrite runtime catalogs for text models or other providers', async () => {
    await withHome(async (root, manager) => {
      expect(await manager.ensureRuntimeModelModalities({
        provider: DEEPSEEK_PROVIDER,
        model: 'deepseek-chat',
      })).toBe(false);
      expect(await manager.ensureRuntimeModelModalities({
        provider: 'custom-provider',
        model: 'custom-vision',
      })).toBe(false);
      await expect(readFile(join(root, '.dsh', 'settings.yaml'), 'utf8')).rejects.toThrow();
    });
  });

  it('leaves non-vision model modalities unset (issue #96)', async () => {
    await withHome(async (_root, manager) => {
      await manager.addDeepseekModel({
        id: 'deepseek-chat',
        name: 'Chat',
        contextWindow: undefined,
        maxTokens: undefined,
        inputModalities: undefined,
      });
      const provider = (await manager.listProviders())[0];
      expect(
        provider?.models.find((model) => model.id === 'deepseek-chat')?.inputModalities,
      ).toBeUndefined();
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

describe('vision model modality normalization (issue #96)', () => {
  it('identifies vision-capable model ids', () => {
    expect(isVisionModelId('deepseek-v4-flash-vision-exp')).toBe(true);
    expect(isVisionModelId('qwen2-vl')).toBe(true);
    expect(isVisionModelId('gpt-4o')).toBe(true);
    expect(isVisionModelId('gpt-image-1')).toBe(true);
    expect(isVisionModelId('glm-4v')).toBe(true);
    expect(isVisionModelId('deepseek-chat')).toBe(false);
    expect(isVisionModelId('gpt-4')).toBe(false);
    expect(isVisionModelId('claude-3-5-sonnet')).toBe(false);
  });

  it('defaults a vision model with no configured modality to text+image', () => {
    expect(normalizeVisionModelInputModalities('deepseek-v4-flash-vision-exp', undefined, false))
      .toEqual(['text', 'image']);
    expect(normalizeVisionModelInputModalities('gpt-4o', ['text'], false))
      .toEqual(['text', 'image']);
    // A catalog that already declares image also upgrades the modality.
    expect(normalizeVisionModelInputModalities('some-model', undefined, true))
      .toEqual(['text', 'image']);
  });

  it('leaves non-vision models and explicitly image-capable models unchanged', () => {
    expect(normalizeVisionModelInputModalities('deepseek-chat', undefined, false))
      .toBeUndefined();
    expect(normalizeVisionModelInputModalities('deepseek-chat', ['text'], false))
      .toEqual(['text']);
    // An explicitly image-capable vision model keeps its declaration as-is.
    expect(normalizeVisionModelInputModalities('deepseek-v4-flash-vision-exp', ['text', 'image'], false))
      .toEqual(['text', 'image']);
  });
});
