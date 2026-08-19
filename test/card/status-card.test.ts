import { describe, expect, it } from 'vitest';
import { renderStatusCard } from '../../src/card/status-card.js';

describe('renderStatusCard', () => {
  it('shows session metrics, pending work and a scope-bound refresh action', () => {
    const card = renderStatusCard({
      scope: 'chat-a:member:user-1',
      cwd: '/tmp/project',
      model: 'gateway/deepseek-v4-flash',
      sessionId: 'session-1',
      activeRunIds: ['run-1'],
      version: '0.15.9',
      isolation: 'member',
      permissionPolicy: 'deny',
      role: 'coder (Coder)',
      metrics: {
        inputTokens: 10_000,
        outputTokens: 2_000,
        cacheReadTokens: 30_000,
        cacheWriteTokens: 1_000,
        contextUsedTokens: 32_000,
        contextWindow: 64_000,
      },
      pending: { approvals: 2, questions: 1, plans: 3 },
      jobs: { queued: 4, running: 1, completed: 8, failed: 2, interrupted: 3 },
    });

    const json = JSON.stringify(card);
    expect(json).toContain('32,000 / 64,000（50.0%）');
    expect(json).toContain('input `10,000`');
    expect(json).toContain('cache read `30,000`');
    expect(json).toContain('审批 `2` · 提问 `1` · 计划 `3`');
    expect(json).toContain('排队 `4` · 运行 `1` · 中断 `3` · 失败 `2`');
    expect(json).toContain('queued `4` · running `1` · interrupted `3` · failed `2`');
    expect(json).toContain('gateway/deepseek-v4-flash');
    expect(json).toContain('run-1');
    expect(json).toContain('0.15.9');
    expect(json).toContain('工具权限**：`deny`');
    expect(json).toContain(
      '"value":{"cmd":"status-refresh","scope":"chat-a:member:user-1","isolation":"member"}',
    );
  });

  it('labels unavailable metrics instead of inventing zeroes', () => {
    const json = JSON.stringify(renderStatusCard({
      scope: 'chat-a',
      cwd: '/tmp/project',
      model: 'deepseek-v4-flash',
      sessionId: undefined,
      activeRunIds: [],
      version: '0.15.9',
      isolation: 'p2p',
      role: undefined,
      metrics: undefined,
      pending: { approvals: 0, questions: 0, plans: 0 },
    }));

    expect(json).toContain('暂无 / 暂无（暂无）');
    expect(json).toContain('input `暂无`');
    expect(json).toContain('cache read `暂无`');
    expect(json).not.toContain('0.0%');
  });
});
