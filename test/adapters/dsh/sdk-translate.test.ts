import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import {
  createSdkRun,
  translateSessionEvent,
} from '../../../src/adapters/dsh/sdk-translate.js';

describe('translateSessionEvent', () => {
  it('maps reasoning/text/tool chunks to streaming events', () => {
    const tracker = { emitted: new Set<string>() };
    const events = [
      ...translateSessionEvent(
        { type: 'assistant/chunk', data: { chunk: { type: 'reasoning-delta', text: 'think' } } },
        tracker,
      ),
      ...translateSessionEvent(
        { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'hello' } } },
        tracker,
      ),
      ...translateSessionEvent(
        {
          type: 'assistant/chunk',
          data: { chunk: { type: 'tool-call-delta', id: 't1', name: 'bash', argumentsDelta: '{}' } },
        },
        tracker,
      ),
      ...translateSessionEvent(
        { type: 'assistant/chunk', data: { chunk: { type: 'tool-call-delta', id: 't1', argumentsDelta: 'x' } } },
        tracker,
      ),
    ];
    expect(events).toContainEqual({ type: 'thinking', delta: 'think' });
    expect(events).toContainEqual({ type: 'text', delta: 'hello' });
    expect(events).toContainEqual({ type: 'tool_use', id: 't1', name: 'bash', input: {} });
    expect(events.filter((event) => event.type === 'tool_use')).toHaveLength(1);
  });

  it('maps tool/call and tool/result with errors', () => {
    const tracker = { emitted: new Set<string>() };
    const events = [
      ...translateSessionEvent(
        {
          type: 'tool/call',
          data: { callId: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' },
        },
        tracker,
      ),
      ...translateSessionEvent(
        {
          type: 'tool/result',
          data: {
            message: {
              content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] }],
            },
            error: { name: 'E', code: 'X' },
          },
        },
        tracker,
      ),
    ];
    expect(events).toContainEqual({
      type: 'tool_use',
      id: 'c1',
      name: 'bash',
      input: { cmd: 'ls' },
    });
    expect(events).toContainEqual({
      type: 'tool_result',
      id: 'c1',
      output: 'ok',
      isError: true,
    });
  });

  it('surfaces usage and turn errors', () => {
    const tracker = { emitted: new Set<string>() };
    const usage = translateSessionEvent(
      {
        type: 'assistant/message',
        data: {
          usage: {
            inputTokens: 1,
            outputTokens: 2,
            cacheReadTokens: 3,
            cacheWriteTokens: 4,
          },
        },
      },
      tracker,
    );
    expect(usage).toEqual([{
      type: 'usage',
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
    }]);
    const turnError = translateSessionEvent(
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: 'boom' } } } },
      tracker,
    );
    expect(turnError).toEqual([{ type: 'error', message: 'boom', terminationReason: 'failed' }]);
  });

  it('does not misclassify rc.8 max-token turn boundaries as fatal session errors', () => {
    const events = translateSessionEvent(
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'max-tokens' } } },
      { emitted: new Set<string>() },
    );
    expect(events).toEqual([]);
  });
});

function fakeHarness(request = vi.fn().mockResolvedValue({ attachments: [] })): DeepSeekHarness {
  return {
    run: async (_input: string, options?: { sessionId?: string; onNotification?: (n: unknown) => void }) => {
      const sessionId = options?.sessionId ?? 's';
      const emit = (event: unknown): void => {
        options?.onNotification?.({
          method: 'session.event',
          params: { sessionId, event },
        });
      };
      emit({ type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'hello ' } } });
      emit({ type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'world' } } });
      emit({ type: 'assistant/message', data: { usage: { inputTokens: 3, outputTokens: 4 } } });
      return {
        sessionId,
        finalResponse: 'hello world',
        events: [],
        notifications: [],
      };
    },
    start: async () => undefined,
    close: async () => undefined,
    session: () => {
      throw new Error('unused');
    },
    client: { request } as never,
    [Symbol.asyncDispose]: async () => undefined,
  } as unknown as DeepSeekHarness;
}

describe('createSdkRun', () => {
  it('uploads image bytes and sends native SDK image blocks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-sdk-image-'));
    try {
      const image = join(root, 'exact-image.png');
      await writeFile(image, Buffer.from('89504e470d0a1a0a00000000', 'hex'));
      const request = vi.fn().mockResolvedValue({
        attachments: [{
          attachmentId: 'attachment-1',
          mediaType: 'image/png',
          bytes: 12,
          width: 1,
          height: 1,
          name: 'exact-image.png',
        }],
      });
      const harness = fakeHarness(request);
      const run = vi.spyOn(harness, 'run');
      const handle = createSdkRun(harness, 'inspect this', {
        sessionId: 's-image',
        cwd: root,
        model: 'm',
        images: [image],
        stopRequested: { value: false },
      });
      for await (const _event of handle.events) void _event;

      expect(request).toHaveBeenCalledWith('attachment/upload', {
        images: [{
          mediaType: 'image/png',
          data: Buffer.from('89504e470d0a1a0a00000000', 'hex').toString('base64'),
          name: 'exact-image.png',
        }],
      });
      expect(run).toHaveBeenCalledWith(
        [
          { type: 'text', text: 'inspect this' },
          {
            type: 'image',
            attachment: expect.objectContaining({ attachmentId: 'attachment-1' }),
          },
        ],
        expect.objectContaining({ sessionId: 's-image' }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('streams events and settles with done', async () => {
    const harness = fakeHarness();
    const handle = createSdkRun(harness, 'hi', {
      sessionId: 's1',
      cwd: '/tmp',
      model: 'm',
      images: undefined,
      stopRequested: { value: false },
    });
    const events = [];
    for await (const event of handle.events) events.push(event);
    await handle.settled;
    expect(events[0]).toMatchObject({ type: 'system', sessionId: 's1' });
    expect(events.map((event) => event.type)).toEqual([
      'system',
      'text',
      'text',
      'usage',
      'done',
    ]);
    expect(events.at(-1)).toMatchObject({ terminationReason: 'normal' });
  });

  it('reports interrupted when stop was requested', async () => {
    const harness = fakeHarness();
    const stopRequested = { value: true };
    const handle = createSdkRun(harness, 'hi', {
      sessionId: 's1',
      cwd: undefined,
      model: undefined,
      images: undefined,
      stopRequested,
    });
    const events = [];
    for await (const event of handle.events) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: 'done', terminationReason: 'interrupted' });
  });
});
