import { describe, expect, it } from 'vitest';
import type { RegisterAppOptions, RegisterAppResult } from '@larksuite/channel';
import { onboardPersonalAgent } from '../../src/onboard/registration.js';

function fakeRegister(result: RegisterAppResult): (options: RegisterAppOptions) => Promise<RegisterAppResult> {
  return async (options) => {
    options.onQRCodeReady({ url: 'https://example.test/qr', expireIn: 600 });
    return result;
  };
}

describe('onboardPersonalAgent', () => {
  it('renders the QR code and returns Feishu tenant credentials', async () => {
    const lines: string[] = [];
    const qr: string[] = [];

    const created = await onboardPersonalAgent({
      register: fakeRegister({
        client_id: 'cli_test',
        client_secret: 'secret',
        user_info: { tenant_brand: 'feishu', open_id: 'ou_1' },
      }),
      renderQr: (value) => qr.push(value),
      print: (line) => lines.push(line),
    });

    expect(created).toEqual({
      appId: 'cli_test',
      appSecret: 'secret',
      tenant: 'feishu',
    });
    expect(qr).toEqual(['https://example.test/qr']);
    expect(lines.join('\n')).toContain('未检测到飞书 / Lark 应用凭据');
    expect(lines.join('\n')).toContain('App ID:  cli_test');
  });

  it('switches to lark tenant when the scan reports an international tenant', async () => {
    const created = await onboardPersonalAgent({
      register: fakeRegister({
        client_id: 'cli_lark',
        client_secret: 'secret',
        user_info: { tenant_brand: 'lark', open_id: 'ou_2' },
      }),
      renderQr: () => {},
      print: () => {},
    });

    expect(created.tenant).toBe('lark');
  });

  it('propagates registration failures', async () => {
    await expect(
      onboardPersonalAgent({
        register: async () => {
          throw new Error('network down');
        },
        renderQr: () => {},
        print: () => {},
      }),
    ).rejects.toThrow('network down');
  });
});
