import { registerApp, type RegisterAppOptions, type RegisterAppResult } from '@larksuite/channel';
import { generate as generateQr } from 'qrcode-terminal';
import type { LarkTenant } from '../config/env.js';

export interface OnboardedApp {
  appId: string;
  appSecret: string;
  tenant: LarkTenant;
}

export interface RegistrationDeps {
  register?: (options: RegisterAppOptions) => Promise<RegisterAppResult>;
  renderQr?: (value: string) => void;
  print?: (line: string) => void;
  source?: string;
  signal?: AbortSignal;
}

const DEFAULT_SOURCE = 'dsh-lark-bot';

export async function onboardPersonalAgent(
  deps: RegistrationDeps = {},
): Promise<OnboardedApp> {
  const register = deps.register ?? registerApp;
  const renderQr = deps.renderQr ?? ((value) => generateQr(value, { small: true }));
  const print = deps.print ?? ((line) => process.stdout.write(`${line}\n`));

  print('');
  print('未检测到飞书 / Lark 应用凭据，进入扫码创建向导。');
  print('');

  const result = await register({
    source: deps.source ?? DEFAULT_SOURCE,
    ...(deps.signal ? { signal: deps.signal } : {}),
    onQRCodeReady: (info) => {
      print('请使用飞书 / Lark App 扫描以下二维码，创建或选择 PersonalAgent 应用：');
      print('');
      renderQr(info.url);
      print('');
      const minutes = Math.max(1, Math.round(info.expireIn / 60));
      print(`二维码有效期约 ${minutes} 分钟。`);
      print(`也可以直接在浏览器打开：${info.url}`);
      print('');
    },
    onStatusChange: (info) => {
      if (info.status === 'domain_switched') {
        print('已识别到国际版租户，自动切换到 larksuite.com 域名。');
      } else if (info.status === 'slow_down') {
        print('轮询速度过快，已自动降速。');
      }
    },
  });

  const tenant: LarkTenant = result.user_info?.tenant_brand === 'lark' ? 'lark' : 'feishu';

  print('✓ PersonalAgent 应用创建 / 绑定成功。');
  print(`  App ID:  ${result.client_id}`);
  print(`  Tenant:  ${tenant}`);
  print('');

  return {
    appId: result.client_id,
    appSecret: result.client_secret,
    tenant,
  };
}
