import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DshProviderManager } from '../../src/config/dsh-config.js';
import { ConfigStore } from '../../src/config/profile-store.js';
import { SecretTargetManager } from '../../src/secret/targets.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('SecretTargetManager', () => {
  it('writes only allowlisted dsh references and auto-links a matching provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'secret-target-')); roots.push(root);
    const profiles = new ConfigStore(join(root, 'config.json')); await profiles.load();
    await profiles.saveProfile('default', { tenant: 'feishu', appId: 'cli_x', appSecret: 'old' });
    const dsh = new DshProviderManager({ home: root, env: {}, catalog: { listProviders: async () => [] } });
    await dsh.upsertPiAiProvider({ id: 'gateway', api: 'openai-completions', baseURL: 'https://example.test/v1', models: [{ id: 'model', name: undefined, contextWindow: undefined, maxTokens: undefined }] });
    const targets = new SecretTargetManager({ dsh, profiles, profileName: 'default' });
    await targets.set('dsh-credential', 'gateway', 'sentinel-value');
    expect(await dsh.hasCredential('gateway')).toBe(true);
    expect((await dsh.listProviders()).find((provider) => provider.id === 'gateway')?.credentialRef).toBe('gateway');
    expect(await readFile(join(root, '.dsh', '.credentials.yaml'), 'utf8')).toContain('sentinel-value');
    expect(() => targets.validate('dsh-credential', '../bad')).toThrow();
  });

  it('updates the current profile App Secret without exposing it through status', async () => {
    const root = await mkdtemp(join(tmpdir(), 'app-secret-target-')); roots.push(root);
    const profiles = new ConfigStore(join(root, 'config.json')); await profiles.load();
    await profiles.saveProfile('default', { tenant: 'lark', appId: 'cli_x', appSecret: 'old' });
    const targets = new SecretTargetManager({ dsh: new DshProviderManager({ home: root, env: {}, catalog: { listProviders: async () => [] } }), profiles, profileName: 'default' });
    await targets.set('app-secret', 'current', 'new-sentinel');
    expect(await targets.configured('app-secret', 'current')).toBe(true);
    expect(profiles.getProfile('default')?.accounts.appSecret).toBe('new-sentinel');
  });
});
