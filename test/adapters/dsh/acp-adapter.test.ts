import { describe, expect, it, vi } from 'vitest';
import {
  AcpDshAdapter,
  translateAcpUpdate,
} from '../../../src/adapters/dsh/acp-adapter.js';

const FAKE_ACP_SERVER = `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentInfo: { name: 'fake-acp', version: '0.0.1' } } }) + '\\n');
  } else if (msg.method === 'session/new') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'server-s1' } }) + '\\n');
    setTimeout(() => {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 'perm-1', method: 'session/request_permission', params: { sessionId: 'server-s1', toolCall: { toolCallId: 'call-1', title: 'bash' }, options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }] } }) + '\\n');
    }, 20);
  } else if (msg.method === 'session/prompt') {
    setTimeout(() => {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'server-s1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'done!' } } } }) + '\\n');
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } }) + '\\n');
    }, 20);
  }
});
`;

describe('translateAcpUpdate', () => {
  it('maps message and thought chunks to streaming events', () => {
    const events = [
      ...translateAcpUpdate({
        sessionId: 's1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } },
      }),
      ...translateAcpUpdate({
        sessionId: 's1',
        update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } },
      }),
    ];
    expect(events).toEqual([
      { type: 'text', delta: 'hi' },
      { type: 'thinking', delta: 'hmm' },
    ]);
  });
});

describe('AcpDshAdapter.run', () => {
  it('speaks ACP with a child runtime and routes approvals', async () => {
    const onApprovalRequest = vi.fn().mockResolvedValue('allowed-once' as const);
    const adapter = new AcpDshAdapter({
      launch: { command: 'node', args: ['-e', FAKE_ACP_SERVER], profile: 'dsh-lark-acp' },
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    });

    const run = adapter.run({
      runId: 'acp-1',
      prompt: 'do the thing',
      cwd: '/tmp',
      sessionId: undefined,
      model: undefined,
      images: undefined,
      stopGraceMs: undefined,
      onApprovalRequest,
    });

    const events = [];
    for await (const event of run.events) {
      events.push(event);
    }
    await run.waitForExit(2_000);

    expect(events[0]).toMatchObject({ type: 'system' });
    expect(events.map((event) => event.type)).toEqual(['system', 'text', 'done']);
    expect(events.at(-1)).toMatchObject({ terminationReason: 'normal' });
    expect(onApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'call-1', toolName: 'bash' }),
    );
  }, 10_000);
});
