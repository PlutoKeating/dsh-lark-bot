import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotifyMessage } from '../../src/notify/server.js';
import { NotifyServer } from '../../src/notify/server.js';
import { ScopeDirectory } from '../../src/bridge/scope-directory.js';
import { apply as applyNotifyTool } from '../../src/notify/tool.js';

const servers: NotifyServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

async function startServer(deps: {
  directory: ScopeDirectory;
  send?: ReturnType<typeof vi.fn>;
}) {
  const send = deps.send ?? vi.fn().mockResolvedValue(undefined);
  const server = new NotifyServer({
    token: 'test-token',
    resolve: (message: NotifyMessage) => {
      if (message.scope) return deps.directory.resolve(message.scope);
      if (message.chatId) return deps.directory.resolveChat(message.chatId);
      return undefined;
    },
    send,
  });
  servers.push(server);
  await server.start();
  return { server, send };
}

describe('NotifyServer', () => {
  it('sends messages with mentions to a resolved scope', async () => {
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-a', 'oc_group', undefined);
    const { server, send } = await startServer({ directory });

    const response = await fetch(server.url!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: 'test-token',
        scope: 'chat-a',
        text: 'task done',
        mentions: [{ userId: 'ou_user1', name: 'Alice' }],
      }),
    });
    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledWith(
      { chatId: 'oc_group', threadId: undefined },
      {
        text: 'task done',
        mentions: [{ userId: 'ou_user1', name: 'Alice' }],
      },
    );
  });

  it('rejects bad tokens and unknown scopes', async () => {
    const directory = new ScopeDirectory(':memory:');
    const { server, send } = await startServer({ directory });

    const badToken = await fetch(server.url!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'wrong', chatId: 'oc_group', text: 'x' }),
    });
    expect(badToken.status).toBe(401);

    const unknown = await fetch(server.url!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'test-token', scope: 'nope', text: 'x' }),
    });
    expect(unknown.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it('end-to-end: the lark_notify tool posts through the real server', async () => {
    const directory = new ScopeDirectory(':memory:');
    directory.register('chat-a', 'oc_group', undefined);
    const { server, send } = await startServer({ directory });

    let registered: unknown;
    applyNotifyTool(
      {
        logger: { warn: vi.fn() },
        tools: { register: vi.fn((definition) => { registered = definition; }) },
      } as never,
      {
        ...(server.url ? { endpoint: server.url } : {}),
        token: 'test-token',
      },
    );

    const tool = registered as { execute(args: unknown, exec: unknown): Promise<unknown> };
    const result = await tool.execute(
      { text: 'report ready', scope: 'chat-a', mention_user_ids: ['ou_user1'] },
      {} as never,
    );
    expect(result).toEqual({ ok: true, chatId: 'oc_group' });
    expect(send).toHaveBeenCalledWith(
      { chatId: 'oc_group', threadId: undefined },
      {
        text: 'report ready',
        mentions: [{ userId: 'ou_user1' }],
      },
    );
  });
});
