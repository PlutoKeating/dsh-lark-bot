import { describe, expect, it } from 'vitest';
import { bilingualMarkdown, localizedCard } from '../../src/card/i18n.js';
import { renderQuestionCard } from '../../src/card/question-card.js';
import { renderCard, renderLegacyCard } from '../../src/card/run-renderer.js';
import { initialState, reduce } from '../../src/card/run-state.js';
import { renderStatusCard } from '../../src/card/status-card.js';
import { renderWorkspaceCard } from '../../src/card/workspace-card.js';
import { renderApprovalCard } from '../../src/card/approval-card.js';
import { renderPlanApprovalCard } from '../../src/card/plan-approval-card.js';
import { configEnglish, renderConfigHubCard } from '../../src/card/config-cards.js';

describe('card i18n', () => {
  it('renders one Card 2.0 payload with per-viewer Chinese and English bodies', () => {
    const value = { cmd: 'refresh', scope: 'chat-1' };
    const card = localizedCard({
      zhCn: {
        summary: '会话状态',
        body: { elements: [{ tag: 'button', text: { tag: 'plain_text', content: '刷新' }, value }] },
      },
      enUs: {
        summary: 'Session status',
        body: { elements: [{ tag: 'button', text: { tag: 'plain_text', content: 'Refresh' }, value }] },
      },
    }) as Record<string, any>;

    expect(card.schema).toBe('2.0');
    expect(card.body.elements[0].text.content).toBe('刷新');
    expect(card.body.elements[0].text.i18n_content).toEqual({
      zh_cn: '刷新',
      en_us: 'Refresh',
    });
    expect(card.i18n_body).toBeUndefined();
    expect(card.config.locales).toEqual(['zh_cn', 'en_us']);
    expect(card.config.use_custom_translation).toBe(true);
    expect(card.config.summary.i18n_content).toEqual({
      zh_cn: '会话状态',
      en_us: 'Session status',
    });
    expect(card.body.elements[0].value).toBeUndefined();
    expect(card.body.elements[0].behaviors).toEqual([
      { type: 'callback', value },
    ]);
  });

  it('rejects localized variants whose callback behavior differs', () => {
    expect(() => localizedCard({
      zhCn: {
        summary: '问题',
        body: { elements: [{ tag: 'button', value: { cmd: 'approve' } }] },
      },
      enUs: {
        summary: 'Question',
        body: { elements: [{ tag: 'button', value: { cmd: 'reject' } }] },
      },
    })).toThrow(/callback/i);
  });

  it('uses a readable bilingual fallback without changing either source text', () => {
    expect(bilingualMarkdown('已停止 `run-1`。', 'Stopped `run-1`.')).toBe(
      '已停止 `run-1`。\n\n---\n\nStopped `run-1`.',
    );
  });

  it('keeps a bilingual protocol fallback on the legacy run card', () => {
    const card = renderLegacyCard(initialState) as Record<string, any>;
    const content = card.body.elements[0].content as string;
    expect(content).toContain('执行状态');
    expect(content).toContain('Execution status');
  });

  it('translates only fixed config chrome and preserves dynamic values', () => {
    expect(configEnglish('Provider：`显示名称`')).toBe('Provider: `显示名称`');
    expect(configEnglish('显示名称')).toBe('Display name');

    const adapterLabel = '团队自定义批准方式';
    const card = renderApprovalCard({
      id: 'a-dynamic', toolName: 'custom', reason: undefined,
      options: [{ optionId: 'custom', name: adapterLabel, kind: 'allow_once' }],
    }) as Record<string, any>;
    expect(i18nPairs(card.body).some((pair) =>
      pair.zh_cn.includes(adapterLabel) && pair.en_us.includes(adapterLabel))).toBe(true);
  });

  it('keeps intended agent content byte-identical but never localizes raw reasoning', () => {
    const question = '¿Deploy 版本 α now?';
    const questionCard = renderQuestionCard({ id: 'q-agent', kind: 'text', question }) as Record<string, any>;
    expect(i18nPairs(questionCard.body).some((pair) =>
      pair.zh_cn.includes(question) && pair.en_us.includes(question))).toBe(true);

    const reasoning = '用户原文 / agent reasoning / 日本語';
    const state = reduce(initialState, { type: 'thinking', delta: reasoning });
    const runCard = renderCard(state) as Record<string, any>;
    expect(JSON.stringify(runCard)).not.toContain(reasoning);
  });

  it('localizes every bot-owned interactive card surface', () => {
    const cards = [
      renderStatusCard({
        scope: 'chat-1', cwd: '/repo', model: 'p/m', sessionId: 's1', activeRunIds: [],
        version: '1.0.0', isolation: 'group', role: undefined, metrics: undefined,
        pending: { approvals: 0, questions: 0, plans: 0 },
      }),
      renderWorkspaceCard({ current: '/repo', index: [] }),
      renderQuestionCard({ id: 'q1', kind: 'text', question: 'Keep this?' }),
      renderApprovalCard({
        id: 'a1', toolName: 'bash', reason: 'Keep this reason', options: [
          { optionId: 'yes', name: '允许执行一次', kind: 'allow_once' },
          { optionId: 'no', name: '拒绝', kind: 'reject_once' },
        ],
      }),
      renderPlanApprovalCard({ id: 'p1', actionScope: 'chat-1' }),
      renderConfigHubCard({ providers: [], defaultSelection: undefined, currentModel: 'm', currentSelection: 'p/m' }),
    ] as Array<Record<string, any>>;

    for (const card of cards) {
      expect(card.schema).toBe('2.0');
      expect(JSON.stringify(card.body)).toContain('i18n_content');
      expect(card.i18n_body).toBeUndefined();
      expect(card.config.summary.i18n_content.en_us).toBeTruthy();
    }
  });
});

function i18nPairs(value: unknown): Array<{ zh_cn: string; en_us: string }> {
  const pairs: Array<{ zh_cn: string; en_us: string }> = [];
  if (Array.isArray(value)) {
    for (const item of value) pairs.push(...i18nPairs(item));
    return pairs;
  }
  if (!value || typeof value !== 'object') return pairs;
  const record = value as Record<string, unknown>;
  const translation = record.i18n_content as Record<string, unknown> | undefined;
  if (typeof translation?.zh_cn === 'string' && typeof translation.en_us === 'string') {
    pairs.push({ zh_cn: translation.zh_cn, en_us: translation.en_us });
  }
  for (const child of Object.values(record)) pairs.push(...i18nPairs(child));
  return pairs;
}
