import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ModelStore } from '../../src/bot/model-store.js';
import { WizardStore } from '../../src/bot/wizard-store.js';
import type { AccessManager } from '../../src/config/access-manager.js';
import { DshProviderManager } from '../../src/config/dsh-config.js';
import type { CommandChannel } from '../../src/commands/index.js';
import {
  beginWizard,
  handleConfigHubAction,
  handleWizardCardAction,
  type ConfigWizardContext,
} from '../../src/commands/config-wizard.js';

interface CardCapture {
  cards: object[];
  markdowns: string[];
  sendCard: CommandChannel['sendCard'];
  sendMarkdown: CommandChannel['sendMarkdown'];
}

function fakeChannel(): CardCapture & CommandChannel {
  const cards: object[] = [];
  const markdowns: string[] = [];
  return {
    cards,
    markdowns,
    sendCard: vi.fn(async (_chatId: string, card: object) => {
      cards.push(card);
    }) as unknown as CommandChannel['sendCard'],
    sendMarkdown: vi.fn(async (_chatId: string, text: string) => {
      markdowns.push(text);
    }),
    createChat: undefined,
  } as unknown as CommandChannel & CardCapture;
}

function adminAccess(): AccessManager {
  return {
    snapshot: () => ({ admins: ['ou_admin'] }),
    isAdmin: (id: string | undefined) => id === 'ou_admin',
  } as unknown as AccessManager;
}

async function withContext(
  run: (ctx: ConfigWizardContext, root: string, channel: CardCapture & CommandChannel) => Promise<void>,
  overrides: { senderId?: string } = {},
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lark-wizard-'));
  const channel = fakeChannel();
  const ctx: ConfigWizardContext = {
    scope: 'chat-a',
    chatId: 'chat-a',
    senderId: overrides.senderId ?? 'ou_admin',
    channel,
    dshConfig: new DshProviderManager({ home: root, env: {} }),
    accessManager: adminAccess(),
    models: new ModelStore(),
    wizards: new WizardStore(),
    defaultModel: 'deepseek-v4-flash',
  };
  try {
    await run(ctx, root, channel);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function lastCard(channel: CardCapture): Record<string, unknown> {
  return channel.cards[channel.cards.length - 1] as Record<string, unknown>;
}

interface CardElement {
  tag?: string;
  elements?: unknown[];
  columns?: unknown[];
  actions?: unknown[];
  value?: Record<string, unknown>;
  behaviors?: Array<{ type?: string; value?: Record<string, unknown> }>;
}

/** Walk the schema-2.0 card tree and collect every button element. */
function collectButtons(elements: unknown[]): Array<{ value?: Record<string, unknown> }> {
  const buttons: Array<{ value?: Record<string, unknown> }> = [];
  for (const element of elements as CardElement[]) {
    if (element?.tag === 'button') {
      const value = element.behaviors?.find((behavior) => behavior.type === 'callback')?.value;
      buttons.push(value === undefined ? {} : { value });
    }
    if (element?.tag === 'column_set' && Array.isArray(element.columns)) {
      for (const column of element.columns as CardElement[]) {
        if (Array.isArray(column?.elements)) buttons.push(...collectButtons(column.elements));
      }
    }
    if (element?.tag === 'form' && Array.isArray(element.elements)) {
      buttons.push(...collectButtons(element.elements));
    }
    if (element?.tag === 'action' && Array.isArray(element.actions)) {
      buttons.push(...(element.actions as Array<{ value?: Record<string, unknown> }>));
    }
  }
  return buttons;
}

function buttonsOf(card: Record<string, unknown>): Array<{ value?: Record<string, unknown> }> {
  return collectButtons((card.body as { elements: unknown[] }).elements);
}

function wizardValue(card: Record<string, unknown>): Record<string, unknown> {
  return buttonsOf(card)[0]?.value ?? {};
}

function choose(card: Record<string, unknown>, index: number): Record<string, unknown> {
  const values = buttonsOf(card)
    .map((button) => button.value)
    .filter((value) => typeof value?.choose === 'number');
  return values[index] ?? {};
}

function confirmValue(card: Record<string, unknown>): Record<string, unknown> {
  return buttonsOf(card).find((button) => button.value?.confirm !== undefined)?.value ?? {};
}

function cancelValue(card: Record<string, unknown>): Record<string, unknown> {
  return buttonsOf(card).find((button) => button.value?.cancel !== undefined)?.value ?? {};
}

describe('config wizard', () => {
  it('walks the provider-add flow to confirmation and applies it on confirm', async () => {
    await withContext(async (ctx, root, channel) => {
      await beginWizard(ctx, 'provider-add');
      expect(wizardValue(lastCard(channel)).flow).toBe('provider-add');
      expect(wizardValue(lastCard(channel)).step).toBe(0);

      // 1. protocol
      await handleWizardCardAction(choose(lastCard(channel), 0), undefined, ctx);
      expect(wizardValue(lastCard(channel)).step).toBe(1);

      // 2. provider id
      await handleWizardCardAction(wizardValue(lastCard(channel)), { answer: 'kingapi' }, ctx);
      expect(wizardValue(lastCard(channel)).step).toBe(2);
      expect(JSON.stringify(lastCard(channel))).toContain('"required":true');

      // 3. base url (bare origin is normalized to /v1)
      await handleWizardCardAction(
        wizardValue(lastCard(channel)),
        { answer: 'https://www.kingapi.xyz' },
        ctx,
      );
      expect(wizardValue(lastCard(channel)).step).toBe(3);
      expect(JSON.stringify(lastCard(channel))).not.toContain('"required":true');

      // 4. display name (optional, empty)
      await handleWizardCardAction(wizardValue(lastCard(channel)), { answer: '  ' }, ctx);
      expect(wizardValue(lastCard(channel)).step).toBe(4);

      // 5. models
      await handleWizardCardAction(
        wizardValue(lastCard(channel)),
        { answer: 'doubao-seed-2-0-lite-260428, doubao-1.5-pro' },
        ctx,
      );
      expect(wizardValue(lastCard(channel)).step).toBe(5);

      // 6. api key env ref
      await handleWizardCardAction(
        wizardValue(lastCard(channel)),
        { answer: 'KINGAI_API_KEY' },
        ctx,
      );
      expect(wizardValue(lastCard(channel)).step).toBe(6);

      // 7. set key now -> now
      await handleWizardCardAction(choose(lastCard(channel), 0), undefined, ctx);
      expect(wizardValue(lastCard(channel)).step).toBe(7);

      // 8. key value
      await handleWizardCardAction(
        wizardValue(lastCard(channel)),
        { answer: 'sk-test-secret' },
        ctx,
      );
      // All steps done -> confirm card.
      expect(confirmValue(lastCard(channel)).confirm).toBe(true);

      // Confirm applies the provider and credential.
      await handleWizardCardAction(confirmValue(lastCard(channel)), undefined, ctx);
      expect(ctx.wizards.get('chat-a')).toBeUndefined();
      expect(channel.markdowns.join('\n')).toContain('已添加 provider：`kingapi`');
      expect(channel.markdowns.join('\n')).toContain('值已隐藏');
      expect(channel.cards.length).toBeGreaterThan(9); // final hub card re-rendered

      const settings = await ctx.dshConfig.readSettings();
      const provider = (
        (settings['llm-pi-ai'] as { providers: Record<string, Record<string, unknown>> })
          .providers
      )['kingapi'];
      expect(provider?.['baseURL']).toBe('https://www.kingapi.xyz/v1');
      expect(provider?.['models']).toHaveLength(2);

      const credentialsText = await readFile(join(root, '.dsh', '.credentials.yaml'), 'utf8');
      expect(credentialsText).toContain('KINGAI_API_KEY: sk-test-secret');
    });
  });

  it('blocks non-admin users from admin flows', async () => {
    await withContext(async (ctx, _root, channel) => {
      const context = { ...ctx, senderId: 'ou_bystander' };
      await beginWizard(context, 'key-set');
      expect(channel.markdowns.join('\n')).toContain('仅管理员可执行');
      expect(context.wizards.get('chat-a')).toBeUndefined();
    });
  });

  it('cancel clears the wizard state', async () => {
    await withContext(async (ctx, _root, channel) => {
      await beginWizard(ctx, 'model-use');
      const card = lastCard(channel);
      await handleWizardCardAction(cancelValue(card), undefined, ctx);
      expect(ctx.wizards.get('chat-a')).toBeUndefined();
      expect(channel.markdowns.join('\n')).toContain('已取消');
    });
  });

  it('renders schema-2.0 cards without the deprecated action container', async () => {
    await withContext(async (ctx, _root, channel) => {
      await handleConfigHubAction('refresh', ctx);
      const hub = lastCard(channel);
      expect(JSON.stringify(hub)).not.toContain('"tag":"action"');
      expect(JSON.stringify(hub)).toContain('"tag":"column_set"');

      await beginWizard(ctx, 'provider-add');
      const options = lastCard(channel);
      expect(JSON.stringify(options)).not.toContain('"tag":"action"');

      await handleWizardCardAction(choose(options, 0), undefined, ctx);
      const text = lastCard(channel);
      expect(JSON.stringify(text)).toContain('"tag":"form"');
      expect(JSON.stringify(text)).toContain('"form_action_type":"submit"');
      expect(JSON.stringify(text)).not.toContain('"tag":"action"');
    });
  });

  it('model-use applies the scope override without admin', async () => {
    await withContext(async (ctx, _root, channel) => {
      await beginWizard(ctx, 'model-use');
      await handleWizardCardAction(choose(lastCard(channel), 0), undefined, ctx);
      expect(ctx.models.get('chat-a')).toBe('deepseek-v4-flash');
      expect(channel.markdowns.join('\n')).toContain('已热切换当前会话模型');
    });
  });

  it('model-default also persists the profile preference for new sessions', async () => {
    await withContext(async (ctx, _root, channel) => {
      const preferenceSaved: string[] = [];
      ctx.setDefaultModelPreference = async (model: string) => {
        preferenceSaved.push(model);
      };
      await beginWizard(ctx, 'model-default');
      await handleWizardCardAction(choose(lastCard(channel), 0), undefined, ctx);
      await handleWizardCardAction(confirmValue(lastCard(channel)), undefined, ctx);
      expect(preferenceSaved).toEqual(['deepseek-v4-flash']);
      expect(channel.markdowns.join('\n')).toContain('同时更新 profile 默认模型');
    });
  });

  it('hub refresh renders direct model choices, marks the current model, and offers reset', async () => {
    await withContext(async (ctx, _root, channel) => {
      await handleConfigHubAction('refresh', ctx);
      const card = lastCard(channel);
      const content = JSON.stringify(card);
      expect(content).toContain('provider-add');
      expect(content).toContain('key-set');
      expect(content).toContain('model-use');
      expect(content).toContain('✅ deepseek-v4-flash');
      expect(content).toContain('model-use-direct');
      expect(content).toContain('model-reset');
    });
  });

  it('applies and resets a model directly from the hub card', async () => {
    await withContext(async (ctx, _root, channel) => {
      await handleConfigHubAction(
        'model-use-direct',
        ctx,
        { model: 'deepseek-v4-pro' },
      );
      expect(ctx.models.get('chat-a')).toBe('deepseek-official/deepseek-v4-pro');
      expect(channel.markdowns.join('\n')).toContain('下一轮消息生效');

      await handleConfigHubAction('model-reset', ctx);
      expect(ctx.models.get('chat-a')).toBeUndefined();
      expect(channel.markdowns.join('\n')).toContain('已恢复默认模型');
    });
  });

  it('uses the effective role/default precedence when marking and resetting models', async () => {
    await withContext(async (ctx, _root, channel) => {
      ctx.resolveDefaultModel = async () => 'deepseek-v4-pro';
      await handleConfigHubAction('refresh', ctx);
      expect(JSON.stringify(lastCard(channel))).toContain('✅ deepseek-v4-pro');

      ctx.models.set(ctx.scope, 'deepseek-official/deepseek-v4-flash');
      await handleConfigHubAction('model-reset', ctx);
      expect(channel.markdowns.join('\n')).toContain('`deepseek-v4-pro`');
    });
  });

  it('keeps reset available without models and routes direct choices by provider', async () => {
    await withContext(async (ctx, _root, channel) => {
      await ctx.dshConfig.removeDeepseekModel('deepseek-v4-flash');
      await ctx.dshConfig.removeDeepseekModel('deepseek-v4-pro');
      await handleConfigHubAction('refresh', ctx);
      expect(JSON.stringify(lastCard(channel))).toContain('model-reset');

      await ctx.dshConfig.upsertPiAiProvider({
        id: 'gateway',
        api: 'openai-completions',
        baseURL: 'https://gateway.example/v1',
        models: [{ id: 'shared-model', name: undefined, contextWindow: undefined, maxTokens: undefined }],
      });
      await handleConfigHubAction('model-use-direct', ctx, {
        provider: 'gateway',
        model: 'shared-model',
      });
      expect(ctx.models.get(ctx.scope)).toBe('gateway/shared-model');
    });
  });

  it('preserves the provider from dsh default selection for duplicate model ids', async () => {
    await withContext(async (ctx, _root, channel) => {
      for (const id of ['gateway-a', 'gateway-b']) {
        await ctx.dshConfig.upsertPiAiProvider({
          id,
          displayName: id,
          api: 'openai-completions',
          baseURL: `https://${id}.example/v1`,
          models: [{ id: 'shared', name: undefined, contextWindow: undefined, maxTokens: undefined }],
        });
      }
      await ctx.dshConfig.setDefaultModel('gateway-b/shared');
      ctx.resolveDefaultModel = async () => {
        const selection = await ctx.dshConfig.defaultModelSelection();
        return selection ? `${selection.provider}/${selection.model}` : undefined;
      };

      await handleConfigHubAction('refresh', ctx);
      const card = JSON.stringify(lastCard(channel));
      expect(card).toContain('shared · gateway-a');
      expect(card).toContain('✅ shared · gateway-b');
      expect(card).not.toContain('✅ shared · gateway-a');
    });
  });

  it('keeps the deepseek official base URL root (no /v1 normalization) on update', async () => {
    await withContext(async (ctx, root, channel) => {
      await ctx.dshConfig.upsertDeepseekProvider({ baseURL: 'https://api.deepseek.com' });
      await beginWizard(ctx, 'provider-update');

      // Select deepseek-official, then the base-url field.
      await handleWizardCardAction(choose(lastCard(channel), 0), undefined, ctx);
      expect(wizardValue(lastCard(channel)).step).toBe(1);
      await handleWizardCardAction(choose(lastCard(channel), 0), undefined, ctx);
      expect(wizardValue(lastCard(channel)).step).toBe(2);

      await handleWizardCardAction(
        wizardValue(lastCard(channel)),
        { answer: 'https://api.deepseek.com' },
        ctx,
      );
      await handleWizardCardAction(confirmValue(lastCard(channel)), undefined, ctx);

      const settings = await ctx.dshConfig.readSettings();
      expect(
        (settings['llm-deepseek'] as Record<string, unknown>)['baseURL'],
      ).toBe('https://api.deepseek.com');
      void root;
    });
  });

  it('falls back to markdown when the hub card send fails', async () => {
    await withContext(async (ctx, _root, channel) => {
      channel.sendCard = vi.fn(async () => {
        throw new Error('card api unavailable');
      }) as unknown as CommandChannel['sendCard'];
      await handleConfigHubAction('refresh', ctx);
      expect(channel.markdowns.join('\n')).toContain('Provider / 模型 / 凭据管理');
      expect(channel.markdowns.join('\n')).toContain('deepseek-official');
    });
  });

  it('key-set auto-links the ref to the matching pi-ai provider', async () => {
    await withContext(async (ctx, _root, channel) => {
      await ctx.dshConfig.upsertPiAiProvider({
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
      await beginWizard(ctx, 'key-set');
      await handleWizardCardAction(
        wizardValue(lastCard(channel)),
        { answer: 'kingapi' },
        ctx,
      );
      await handleWizardCardAction(
        wizardValue(lastCard(channel)),
        { answer: 'sk-auto-link' },
        ctx,
      );
      await handleWizardCardAction(confirmValue(lastCard(channel)), undefined, ctx);
      expect(channel.markdowns.join('\n')).toContain('已自动把 provider `kingapi` 的 apiKeyEnv 关联');
      const settings = await ctx.dshConfig.readSettings();
      expect(
        (
          (settings['llm-pi-ai'] as { providers: Record<string, Record<string, unknown>> })
            .providers
        )['kingapi']?.['apiKeyEnv'],
      ).toBe('kingapi');
    });
  });
});
