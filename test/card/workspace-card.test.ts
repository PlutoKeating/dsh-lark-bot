import { describe, expect, it } from 'vitest';
import { renderWorkspaceCard } from '../../src/card/workspace-card.js';

describe('renderWorkspaceCard', () => {
  it('renders current cwd and named workspaces as markdown', () => {
    const card = renderWorkspaceCard({
      current: '/tmp/project',
      index: [
        { name: 'web', cwd: '/tmp/web', lastUsed: 1 },
        { name: 'api', cwd: '/tmp/api', lastUsed: undefined },
      ],
    }) as { body: { elements: Array<{ content?: string }> } };

    const markdown = card.body.elements[0]?.content ?? '';
    expect(markdown).toContain('/tmp/project');
    expect(markdown).toContain('web');
    expect(markdown).toContain('/tmp/api');
  });
});
