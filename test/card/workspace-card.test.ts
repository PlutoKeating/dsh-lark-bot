import { describe, expect, it } from 'vitest';
import { renderWorkspaceCard } from '../../src/card/workspace-card.js';

describe('renderWorkspaceCard', () => {
  it('renders current cwd and named workspaces as markdown', () => {
    const card = renderWorkspaceCard({
      current: '/tmp/project',
      named: { web: '/tmp/web', api: '/tmp/api' },
    }) as { body: { elements: Array<{ content?: string }> } };

    const markdown = card.body.elements[0]?.content ?? '';
    expect(markdown).toContain('/tmp/project');
    expect(markdown).toContain('web');
    expect(markdown).toContain('/tmp/api');
  });
});
