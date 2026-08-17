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

function wizardValue(card: Record<string, unknown>): Record<string, unknown> {
  const elements = (card.body as { elements: unknown[] }).elements;
  const action = elements.find(
    (element) =>
      typeof element === 'object' &&
      element !== null &&
      (element as { tag?: string }).tag === 'action',
  ) as { actions?: Array<{ value?: Record<string, unknown> }> } | undefined;
  return action?.actions?.[0]?.value ?? {};
}

function choose(card: Record<string, unknown>, index: number): Record<string, unknown> {
  const elements = (card.body as { elements: unknown[] }).elements;
  const action = elements.find(
    (element) =>
      typeof element === 'object' &&
      element !== null &&
      (element as { tag?: string }).tag === 'action' &&
      ((element as { actions?: Array<{ value?: Record<string, unknown> }> }).actions?.some(
        (button) => typeof button.value?.choose === 'number',
      ) ??
        false),
  ) as { actions: Array<{ value: Record<string, unknown> }> };
  return action.actions[index]!.value;
}

function confirmValue(card: Record<string, unknown>): Record<string, unknown> {
  const elements = (card.body as { elements: unknown[] }).elements;
  const action = elements.find(
    (element) =>
      typeof element === 'object' &&
      element !== null &&
      (element as { tag?: string }).tag === 'action' &&
      (element as { actions?: Array<{ value?: Record<string, unknown> }> }).actions?.some(
        (button) => button.value?.confirm !== undefined,
      ),
  ) as { actions: Array<{ value: Record<string, unknown> }> };
  return action.actions[0]!.value;
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

      // 3. base url (bare origin is normalized to /v1)
      await handleWizardCardAction(
        wizardValue(lastCard(channel)),
        { answer: 'https://www.kingapi.xyz' },
        ctx,
      );
      expect(wizardValue(lastCard(channel)).step).toBe(3);

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
      const elements = (card.body as { elements: unknown[] }).elements;
      const action = elements.find(
        (element) =>
          typeof element === 'object' &&
          element !== null &&
          (element as { tag?: string }).tag === 'action' &&
          (element as { actions?: Array<{ value?: Record<string, unknown> }> }).actions?.some(
            (button) => button.value?.cancel !== undefined,
          ),
      ) as { actions: Array<{ value: Record<string, unknown> }> };
      await handleWizardCardAction(action.actions[0]!.value, undefined, ctx);
      expect(ctx.wizards.get('chat-a')).toBeUndefined();
      expect(channel.markdowns.join('\n')).toContain('已取消');
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

  it('hub refresh renders a card with management buttons', async () => {
    await withContext(async (ctx, _root, channel) => {
      await handleConfigHubAction('refresh', ctx);
      const card = lastCard(channel);
      const content = JSON.stringify(card);
      expect(content).toContain('provider-add');
      expect(content).toContain('key-set');
      expect(content).toContain('model-use');
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
});
