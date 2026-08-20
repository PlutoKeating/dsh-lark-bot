import { describe, expect, it } from 'vitest';
import { initialState, markFinalDeliveryFailed, reduce } from '../../src/card/run-state.js';
import { renderCard, renderLegacyCard } from '../../src/card/run-renderer.js';

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

  it('renders tool status without exposing reasoning or tool payloads', () => {
    let state = reduce(initialState, { type: 'thinking', delta: 'inspect the code' });
    state = reduce(state, { type: 'tool_use', id: 't1', name: 'read', input: 'src' });
    const running = renderCard(state, 'detailed') as {
      body: { elements: Array<Record<string, unknown>> };
    };
    const panel = running.body.elements.find((element) => element.tag === 'collapsible_panel');
    expect(panel).toMatchObject({ tag: 'collapsible_panel', expanded: true });
    expect(JSON.stringify(panel)).toContain('read');
    expect(JSON.stringify(panel)).not.toContain('inspect the code');
    expect(JSON.stringify(panel)).not.toContain('src');
    expect((running as unknown as { config: { summary: { content: string } } }).config.summary.content)
      .not.toContain('inspect the code');

    state = reduce(state, { type: 'tool_result', id: 't1', output: 'file contents', isError: false });
    const standard = renderCard(state, 'standard') as {
      config: { summary: { content: string } };
      body: { elements: Array<Record<string, unknown>> };
    };
    expect(JSON.stringify(standard.body.elements)).not.toContain('file contents');
    expect(standard.config.summary.content).not.toContain('file contents');
    const topLevelFallback = standard.body.elements.find(
      (element) => element.tag === 'markdown' && JSON.stringify(element).includes('执行状态'),
    );
    expect(JSON.stringify(topLevelFallback)).toContain('read');

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

  it('keeps untrusted agent and tool payloads out of every process-card variant', () => {
    let state = reduce(initialState, { type: 'thinking', delta: 'PRIVATE_REASONING_CANARY' });
    state = reduce(state, {
      type: 'tool_use',
      id: 't-private',
      name: 'read',
      input: { path: '/Users/example/.config', token: 'PRIVATE_INPUT_CANARY' },
    });
    state = reduce(state, {
      type: 'tool_result',
      id: 't-private',
      output: 'PRIVATE_OUTPUT_CANARY',
      isError: false,
    });
    state = reduce(state, { type: 'text', delta: 'PRIVATE_DRAFT_CANARY' });

    for (const card of [
      renderCard(state, 'compact'),
      renderCard(state, 'standard'),
      renderCard(state, 'detailed'),
      renderLegacyCard(state),
    ]) {
      const serialized = JSON.stringify(card);
      expect(serialized).toContain('read');
      expect(serialized).not.toMatch(/PRIVATE_(?:REASONING|INPUT|OUTPUT|DRAFT)_CANARY/);
      expect(serialized).not.toContain('/Users/example/.config');
    }
  });

  it('shows generic process-card failures without exposing underlying errors', () => {
    let state = reduce(initialState, {
      type: 'error',
      message: 'PRIVATE_ADAPTER_ERROR at /Users/example/private',
      terminationReason: 'failed',
    });
    state = markFinalDeliveryFailed(
      state,
      'PRIVATE_DELIVERY_ERROR',
      'intended final answer',
    );

    for (const card of [
      renderCard(state, 'compact'),
      renderCard(state, 'standard'),
      renderCard(state, 'detailed'),
      renderLegacyCard(state),
    ]) {
      const serialized = JSON.stringify(card);
      expect(serialized).toContain('intended final answer');
      expect(serialized).not.toContain('PRIVATE_ADAPTER_ERROR');
      expect(serialized).not.toContain('PRIVATE_DELIVERY_ERROR');
      expect(serialized).not.toContain('/Users/example/private');
    }
  });

  it('keeps long reasoning private while preserving a useful status', () => {
    const reasoning = `BEGIN-${'x'.repeat(2_400)}-LATEST`;
    const state = reduce(initialState, { type: 'thinking', delta: reasoning });
    const card = renderCard(state, 'detailed') as {
      body: { elements: Array<Record<string, unknown>> };
    };
    const panel = card.body.elements.find((element) => element.tag === 'collapsible_panel');
    expect(JSON.stringify(panel)).toContain('正在处理请求');
    expect(JSON.stringify(panel)).not.toContain('BEGIN-');
    expect(JSON.stringify(panel)).not.toContain('-LATEST');
    const snapshot = card.body.elements.find((element) => JSON.stringify(element).includes('执行状态'));
    expect(JSON.stringify(snapshot)).not.toContain('-LATEST');
  });
});
