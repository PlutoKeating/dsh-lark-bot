import { describe, expect, it } from 'vitest';
import {
  REQUIRED_IM_SCOPES,
  adminLoginUrl,
  ensureEventSubscription,
  importScopes,
  submitVersion,
} from '../../src/onboard/open-platform.js';
import {
  QUICK_COMMANDS,
  quickCommandSynopsis,
  registerQuickCommands,
} from '../../src/onboard/quick-commands.js';

describe('open-platform', () => {
  it('builds an admin authorize URL with app_id, redirect, scope and state', () => {
    const url = new URL(adminLoginUrl({ appId: 'cli_x', tenant: 'feishu' }, 'http://127.0.0.1:9768/callback'));
    expect(url.origin).toBe('https://open.feishu.cn');
    expect(url.pathname).toBe('/open-apis/authen/v1/authorize');
    expect(url.searchParams.get('app_id')).toBe('cli_x');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:9768/callback');
    expect(url.searchParams.get('scope')).toBe('application:application');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('uses the lark tenant domain when tenant is lark', () => {
    const url = new URL(adminLoginUrl({ appId: 'cli_x', tenant: 'lark' }, 'http://127.0.0.1/cb'));
    expect(url.origin).toBe('https://open.larkoffice.com');
  });

  it('lists the required im scopes', () => {
    expect(REQUIRED_IM_SCOPES).toContain('im:message');
    expect(REQUIRED_IM_SCOPES).toContain('im:message.group_at_msg');
  });

  it('returns graceful manual-fallback outcomes for unverified automated steps', async () => {
    const input = { appId: 'cli_x', appSecret: 's', tenant: 'feishu' as const };
    const a = await ensureEventSubscription(input, 'token');
    const b = await importScopes(input, 'token');
    const c = await submitVersion(input, 'token', { name: 'v1', description: 'd' });
    expect(a.ok).toBe(false);
    expect(a.manualSteps).toContain('im.message.receive_v1');
    expect(b.ok).toBe(false);
    expect(b.manualSteps).toContain('im:message');
    expect(c.ok).toBe(false);
    expect(c.manualSteps).toContain('版本');
  });
});

describe('quick-commands', () => {
  it('exposes a non-empty catalog including /channels', () => {
    expect(QUICK_COMMANDS.length).toBeGreaterThan(0);
    expect(QUICK_COMMANDS.map((command) => command.name)).toContain('channels');
  });

  it('renders a bilingual synopsis for /help', () => {
    const synopsis = quickCommandSynopsis();
    expect(synopsis.zh).toContain('`/channels');
    expect(synopsis.en).toContain('`/channels');
  });

  it('degrades to a graceful skip without a user token', async () => {
    const result = await registerQuickCommands({ appId: 'cli_x' });
    expect(result.ok).toBe(false);
    expect(result.registered).toBe(0);
    expect(result.manualSteps).toContain('快捷指令');
  });

  it('reports a skip even with a token when the contract is unverified', async () => {
    const result = await registerQuickCommands({ appId: 'cli_x', userToken: 't' });
    expect(result.ok).toBe(false);
    expect(result.manualSteps).toContain('channels');
  });
});
