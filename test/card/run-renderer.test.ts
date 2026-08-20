import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../../src/card/run-state.js';
import { renderCard } from '../../src/card/run-renderer.js';

describe('renderCard', () => {
  it('emits a streaming card while running', () => {
    const card = renderCard(
      reduce(initialState, { type: 'text', delta: 'thinking' }),
    ) as { config: { streaming_mode: boolean }; body: { elements: unknown[] } };

    expect(card.config.streaming_mode).toBe(true);
    expect(card.body.elements.some((element) => JSON.stringify(element).includes('终止'))).toBe(true);
  });

  it('shows elapsed time and a stall hint while running', () => {
    const now = 1_000_000;
    const state = {
      ...initialState,
      startedAtMs: now - 65_000,
      lastActivityMs: now - 65_000,
    };
    const card = renderCard(state, 'standard', now) as { body: { elements: unknown[] } };
    const text = JSON.stringify(card.body.elements);
    expect(text).toContain('⏱ 65s');
    expect(text).toContain('无响应 65s');
  });

  it('marks the owner of a member-isolated group run', () => {
    const card = renderCard({
      ...initialState,
      scopeOwner: 'ou_member',
      actionScope: 'chat:member:ou_member',
    }) as {
      body: { elements: unknown[] };
    };
    const serialized = JSON.stringify(card.body.elements);
    expect(serialized).toContain('成员隔离会话：ou_member');
    expect(serialized).toContain('"scope":"chat:member:ou_member"');
  });

  it('renders reasoning and tools in a native collapsible panel', () => {
    let state = reduce(initialState, { type: 'thinking', delta: 'inspect the code' });
    state = reduce(state, { type: 'tool_use', id: 't1', name: 'read', input: 'src' });
    const running = renderCard(state, 'detailed') as {
      body: { elements: Array<Record<string, unknown>> };
    };
    const panel = running.body.elements.find((element) => element.tag === 'collapsible_panel');
    expect(panel).toMatchObject({ tag: 'collapsible_panel', expanded: true });
    expect(JSON.stringify(panel)).toContain('inspect the code');
    expect(JSON.stringify(panel)).toContain('read');
    expect((running as unknown as { config: { summary: { content: string } } }).config.summary.content)
      .toContain('inspect the code');

    state = reduce(state, { type: 'tool_result', id: 't1', output: 'file contents', isError: false });
    const standard = renderCard(state, 'standard') as {
      config: { summary: { content: string } };
      body: { elements: Array<Record<string, unknown>> };
    };
    expect(JSON.stringify(standard.body.elements)).toContain('file contents');
    expect(standard.config.summary.content).toContain('file contents');
    const topLevelFallback = standard.body.elements.find(
      (element) => element.tag === 'markdown' && JSON.stringify(element).includes('过程快照'),
    );
    expect(JSON.stringify(topLevelFallback)).toContain('file contents');

    state = reduce(state, { type: 'done', sessionId: 's1', terminationReason: 'normal' });
    const finished = renderCard(state, 'detailed') as {
      body: { elements: Array<Record<string, unknown>> };
    };
    expect(finished.body.elements.find((element) => element.tag === 'collapsible_panel')).toMatchObject({
      expanded: false,
    });
  });

  it('keeps final answer text out of the process card', () => {
    let state = reduce(initialState, { type: 'text', delta: 'final answer' });
    state = reduce(state, { type: 'done', sessionId: 's1', terminationReason: 'normal' });
    expect(JSON.stringify(renderCard(state, 'detailed'))).not.toContain('final answer');
  });

  it('keeps both the beginning and latest part of long reasoning visible', () => {
    const reasoning = `BEGIN-${'x'.repeat(2_400)}-LATEST`;
    const state = reduce(initialState, { type: 'thinking', delta: reasoning });
    const card = renderCard(state, 'detailed') as {
      body: { elements: Array<Record<string, unknown>> };
    };
    const panel = card.body.elements.find((element) => element.tag === 'collapsible_panel');
    expect(JSON.stringify(panel)).toContain('BEGIN-');
    expect(JSON.stringify(panel)).toContain('-LATEST');
    expect(JSON.stringify(panel)).toContain('最新进展');
    const snapshot = card.body.elements.find((element) => JSON.stringify(element).includes('过程快照'));
    expect(JSON.stringify(snapshot)).toContain('-LATEST');
  });

  it.each(['compact', 'standard', 'detailed'] as const)(
    'keeps long %s run cards within the streaming transport budget',
    (density) => {
      let state = initialState;
      for (let index = 0; index < 80; index += 1) {
        const marker = index === 0 ? 'OLDEST' : index === 79 ? 'LATEST' : `${index}`;
        state = reduce(state, {
          type: 'tool_use',
          id: `tool-${index}`,
          name: `tool-${marker}-${'n'.repeat(80)}`,
          input: { query: `${marker}-${'i'.repeat(800)}` },
        });
        state = reduce(state, {
          type: 'tool_result',
          id: `tool-${index}`,
          output: `${marker}-${'o'.repeat(800)}`,
          isError: false,
        });
      }

      const serialized = JSON.stringify(renderCard(state, density));
      expect(serialized.length).toBeLessThanOrEqual(28_000);
      expect(serialized).toContain('tool-LATEST');
      expect(serialized).not.toContain('tool-OLDEST');
      expect(serialized).toContain('较早的工具调用');
      expect(serialized).toContain('older tool calls');
    },
  );
});
