import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SinkQrRegistry,
  pollUntilCompleted,
  type SinkQrProvider,
} from '../../src/onboard/sink-qr.js';
import { QqQrProvider, WeChatQrProvider } from '../../src/onboard/sink-qr-providers.js';
import { renderQrPng } from '../../src/onboard/qr-image.js';

afterEach(() => vi.restoreAllMocks());

describe('SinkQrRegistry', () => {
  const provider: SinkQrProvider = {
    type: 'qq',
    async begin() {
      return { providerType: 'qq', sessionId: 's1', qrUrl: 'https://q.qq.com/x', expireIn: 120 };
    },
    async poll() {
      return { phase: 'pending' };
    },
  };

  it('resolves a provider by type and reports supported types', () => {
    const registry = new SinkQrRegistry([provider]);
    expect(registry.forType('qq')).toBe(provider);
    expect(registry.has('qq')).toBe(true);
    expect(registry.has('wechat')).toBe(false);
    expect(registry.supportedTypes()).toEqual(['qq']);
  });
});

describe('pollUntilCompleted', () => {
  it('resolves once a provider reports completed', async () => {
    let calls = 0;
    const provider: SinkQrProvider = {
      type: 'wechat',
      async begin() {
        return { providerType: 'wechat', sessionId: 's', qrUrl: 'x', expireIn: 120 };
      },
      async poll() {
        calls += 1;
        if (calls < 2) return { phase: 'pending' };
        return { phase: 'completed', channel: { id: 'wx-1', type: 'wechat', label: 'wechat', destination: 'u|ctx', secret: 't' } };
      },
    };
    const result = await pollUntilCompleted(provider, 's', { intervalMs: 5, timeoutMs: 500 });
    expect(result.phase).toBe('completed');
    expect(result.channel?.id).toBe('wx-1');
  });

  it('returns expired on timeout', async () => {
    const provider: SinkQrProvider = {
      type: 'qq',
      async begin() {
        return { providerType: 'qq', sessionId: 's', qrUrl: 'x', expireIn: 120 };
      },
      async poll() {
        return { phase: 'pending' };
      },
    };
    const result = await pollUntilCompleted(provider, 's', { intervalMs: 5, timeoutMs: 40 });
    expect(result.phase).toBe('expired');
  });

  it('returns failed when aborted', async () => {
    const controller = new AbortController();
    const provider: SinkQrProvider = {
      type: 'qq',
      async begin() {
        return { providerType: 'qq', sessionId: 's', qrUrl: 'x', expireIn: 120 };
      },
      async poll() {
        return { phase: 'pending' };
      },
    };
    controller.abort();
    const result = await pollUntilCompleted(provider, 's', { intervalMs: 5, timeoutMs: 500, signal: controller.signal });
    expect(result.phase).toBe('failed');
  });
});

describe('QrProviders', () => {
  it('wechat begin returns the QR from get_bot_qrcode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ qrcode: 'https://img.wx/1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new WeChatQrProvider('https://ilinkai.weixin.qq.com', fetchMock);
    const session = await provider.begin({ label: 'wechat' });
    expect(session.qrUrl).toBe('https://img.wx/1');
    expect(session.providerType).toBe('wechat');
  });

  it('wechat begin throws on a failed get_bot_qrcode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 500 })));
    await expect(new WeChatQrProvider('https://ilinkai.weixin.qq.com').begin()).rejects.toThrow();
  });

  it('qq begin returns a QR URL from create_bind_task', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ retcode: 0, data: { task_id: 'task-9' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new QqQrProvider('api.sgroup.qq.com', fetchMock);
    const session = await provider.begin();
    expect(session.sessionId).toBe('task-9');
    expect(session.qrUrl).toContain('task-9');
  });

  it('qq begin throws when no task_id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 })));
    await expect(new QqQrProvider('api.sgroup.qq.com').begin()).rejects.toThrow();
  });
});

describe('renderQrPng', () => {
  it('renders a PNG buffer', async () => {
    const png = await renderQrPng('https://example.com/scan');
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.length).toBeGreaterThan(100);
    // PNG magic bytes.
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
