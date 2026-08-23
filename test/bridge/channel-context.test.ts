import { describe, expect, it } from 'vitest';
import { renderChannelContext, type ChannelContext } from '../../src/bridge/channel-context.js';

const context: ChannelContext = {
  channel: 'dsh-lark-bot', tenant: 'feishu', chatType: 'topic', scope: 'oc_x:thread_y',
  bridgeProfile: 'ops', adapter: 'dsh-sdk', tools: ['lark_notify', 'lark_request_secret'],
  language: { ui: 'per-viewer', plain: 'bilingual', agent: 'zh' },
  secretCollection: 'available',
};

describe('channel context', () => {
  it('renders stable identity and capabilities without secret-bearing fields', () => {
    const rendered = renderChannelContext(context);
    expect(rendered).toContain('channel: dsh-lark-bot');
    expect(rendered).toContain('tenant: feishu');
    expect(rendered).toContain('scope: oc_x:thread_y');
    expect(rendered).toContain('adapter: dsh-sdk');
    expect(rendered).toContain('lark_request_secret');
    expect(rendered).toContain('Slash commands are handled by the bridge before the agent');
    expect(rendered).toContain('do not infer their absence from available_channel_tools');
    expect(rendered).toContain('tell the user to run /help');
    expect(rendered).not.toMatch(/app.?secret|api.?key|token/i);
  });
});
