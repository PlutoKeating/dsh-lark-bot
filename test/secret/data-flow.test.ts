import { describe, expect, it, vi } from 'vitest';
import { renderChannelContext } from '../../src/bridge/channel-context.js';
import { renderSecretCard } from '../../src/card/secret-card.js';
import { createDiagnosticBundle } from '../../src/diagnostics/bundle.js';
import { createLogger } from '../../src/core/logger.js';
import { SecretRequestRegistry } from '../../src/secret/registry.js';
import { Writable } from 'node:stream';

describe('secret data-flow boundary', () => {
  it('keeps a unique sentinel out of every agent and durable projection fixture', async () => {
    const sentinel = 'SENTINEL_secret_85_never_project';
    const stored: string[] = [];
    const registry = new SecretRequestRegistry({
      validate: vi.fn(), set: async (_target, _reference, value) => { stored.push(value); },
      remove: vi.fn(), configured: vi.fn(),
    });
    const request = registry.register({ scope: 'chat-a', ownerId: 'ou_admin', target: 'dsh-credential', reference: 'KEY', purpose: 'provider auth' });
    const view = registry.get('chat-a', request.id)!;
    const receipt = await registry.submit({ scope: 'chat-a', id: request.id, operatorId: 'ou_admin', value: sentinel });
    expect(stored).toEqual([sentinel]);

    let logs = '';
    const logger = createLogger(new Writable({ write(chunk, _encoding, done) { logs += String(chunk); done(); } }));
    logger.info('secret', 'configured', { target: receipt.target, reference: receipt.reference, configured: receipt.configured });
    const diagnostic = createDiagnosticBundle({
      version: 'test', node: process.version, platform: 'test', profile: 'default', dshProfile: 'dsh-lark', tenant: 'feishu', adapter: 'sdk',
      config: { credentialsConfigured: true, allowedUsers: 1, allowedChats: 0, admins: 1, groupNoAt: false },
      request: { scope: 'chat-a', chatMode: 'p2p', workspace: '/tmp/project', model: 'provider/model', activeRunIds: [], pending: { approvals: 0, questions: 0, plans: 0 } },
      runtimeLogs: logger.recent(), knownSecrets: [sentinel],
    });
    const projections = {
      prompt: renderChannelContext({ channel: 'dsh-lark-bot', tenant: 'feishu', chatType: 'p2p', scope: 'chat-a', bridgeProfile: 'default', adapter: 'sdk', tools: ['lark_request_secret'], language: { ui: 'per-viewer', plain: 'bilingual', agent: 'auto' }, secretCollection: 'available' }),
      session: [], jobs: [], archive: [], card: renderSecretCard(view), receipt, logs,
      diagnostic: diagnostic.content.toString('utf8'), response: `configured=${String(receipt.configured)}`,
    };
    expect(JSON.stringify(projections)).not.toContain(sentinel);
  });
});
