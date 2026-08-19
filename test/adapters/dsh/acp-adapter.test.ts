import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentInfo: { name: 'fake-acp', version: '0.0.1' }, agentCapabilities: { promptCapabilities: { image: true, audio: false, embeddedContext: false } } } }) + '\\n');
  } else if (msg.method === 'session/new') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'server-s1' } }) + '\\n');
    setTimeout(() => {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 'perm-1', method: 'session/request_permission', params: { sessionId: 'server-s1', toolCall: { toolCallId: 'call-1', title: 'bash' }, options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }] } }) + '\\n');
    }, 20);
  } else if (msg.method === 'session/prompt') {
    const hasImage = msg.params.prompt.some((block) => block.type === 'image' && block.mimeType === 'image/png');
    setTimeout(() => {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'server-s1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'done! image=' + hasImage } } } }) + '\\n');
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn', usage: { totalTokens: 16, inputTokens: 5, outputTokens: 7, cachedReadTokens: 3, cachedWriteTokens: 1 } } }) + '\\n');
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

  it('maps ACP context usage updates without estimating missing values', () => {
    expect(translateAcpUpdate({
      sessionId: 's1',
      update: { sessionUpdate: 'usage_update', used: 12_000, size: 64_000 },
    })).toEqual([
      { type: 'context_usage', usedTokens: 12_000, contextWindow: 64_000 },
    ]);
  });

  it('surfaces an explicit fallback when ACP streams an outbound image', () => {
    expect(translateAcpUpdate({
      sessionId: 's1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'image', data: 'AA==', mimeType: 'image/png' },
      },
    })).toEqual([
      { type: 'text', delta: expect.stringContaining('暂不支持图片出站') },
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
    expect(events.map((event) => event.type)).toEqual(['system', 'text', 'usage', 'done']);
    expect(events).toContainEqual({ type: 'text', delta: 'done! image=false' });
    expect(events).toContainEqual({
      type: 'usage',
      inputTokens: 5,
      outputTokens: 7,
      cacheReadTokens: 3,
      cacheWriteTokens: 1,
    });
    expect(events.at(-1)).toMatchObject({ terminationReason: 'normal' });
    expect(onApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'call-1', toolName: 'bash' }),
    );
  }, 10_000);

  it('sends image attachments as native ACP image blocks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-acp-image-'));
    const image = join(root, 'upload');
    await writeFile(image, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const adapter = new AcpDshAdapter({
      launch: { command: 'node', args: ['-e', FAKE_ACP_SERVER], profile: 'dsh-lark-acp' },
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    });
    try {
      const run = adapter.run({
        runId: 'acp-image',
        prompt: 'inspect',
        cwd: root,
        sessionId: undefined,
        model: undefined,
        images: [image],
        stopGraceMs: undefined,
      });
      const events = [];
      for await (const event of run.events) events.push(event);
      expect(events).toContainEqual({ type: 'text', delta: 'done! image=true' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 10_000);
});
