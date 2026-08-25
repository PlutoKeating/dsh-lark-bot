import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCipheriv } from 'node:crypto';
import {
  SinkQrRegistry,
  pollUntilCompleted,
  type SinkQrProvider,
} from '../../src/onboard/sink-qr.js';
import { QqQrProvider, WeChatQrProvider, decryptSecret } from '../../src/onboard/sink-qr-providers.js';
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
    const provider = new QqQrProvider('q.qq.com', fetchMock);
    const session = await provider.begin();
    expect(session.providerType).toBe('qq');
    expect(session.qrUrl).toContain('task-9');
    const createCall = fetchMock.mock.calls[0]!;
    expect(String(createCall[0])).toContain('/lite/create_bind_task');
    const createBody = JSON.parse((createCall[1] as RequestInit).body as string);
    expect(createBody.key).toBeTruthy();
  });

  it('qq begin throws when no task_id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 })));
    await expect(new QqQrProvider('q.qq.com').begin()).rejects.toThrow();
  });

  it('qq poll completes after the user scans and decrypts the secret', async () => {
    const aesKey = Buffer.from(Array(32).fill(7)).toString('base64');
    const encrypted = encryptGcm('client-secret-value', Buffer.from(aesKey, 'base64'));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ retcode: 0, data: { task_id: 'task-9' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        retcode: 0,
        data: { status: 2, bot_appid: 'bot-1', bot_encrypt_secret: encrypted, user_openid: 'openid-u' },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new QqQrProvider('q.qq.com', fetchMock, () => aesKey);
    const session = await provider.begin();
    const result = await provider.poll(session.sessionId);
    expect(result.phase).toBe('completed');
    expect(result.channel?.secret).toBe('bot-1:client-secret-value');
    expect(result.channel?.destination).toBe('user:openid-u');
  });

  it('qq poll reports expired when the QR expires', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ retcode: 0, data: { task_id: 'task-9' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ retcode: 0, data: { status: 3 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new QqQrProvider('q.qq.com', fetchMock);
    const session = await provider.begin();
    await expect(provider.poll(session.sessionId)).resolves.toMatchObject({ phase: 'expired' });
  });

  it('wechat poll completes and returns the token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ qrcode: 'qr-value' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'confirmed', token: 'bot-token', to_user_id: 'wechat-u' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new WeChatQrProvider('https://ilinkai.weixin.qq.com', fetchMock);
    const session = await provider.begin();
    const result = await provider.poll(session.sessionId);
    expect(result.phase).toBe('completed');
    expect(result.channel?.secret).toBe('bot-token');
    expect(result.channel?.destination).toBe('wechat-u|');
  });
});

describe('decryptSecret', () => {
  it('decrypts an AES-256-GCM ciphertext (IV‖CT‖tag)', () => {
    const key = Buffer.from(Array(32).fill(9));
    const keyB64 = key.toString('base64');
    const ciphertext = encryptGcm('qq-secret', key);
    expect(decryptSecret(ciphertext, keyB64)).toBe('qq-secret');
  });
});

function encryptGcm(plaintext: string, key: Buffer): string {
  const iv = Buffer.alloc(12, 3);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString('base64');
}

describe('renderQrPng', () => {
  it('renders a PNG buffer', async () => {
    const png = await renderQrPng('https://example.com/scan');
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.length).toBeGreaterThan(100);
    // PNG magic bytes.
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
