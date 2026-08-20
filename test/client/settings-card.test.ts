import { describe, expect, it, vi } from 'vitest';
import {
  apply,
  buildWebDiagnostic,
  canSaveSnapshot,
  DIAGNOSTIC_SHORTCUTS,
  SETTINGS_FIELDS,
  draftFrom,
  normalizeSettingsDraft,
  saveSettingsDraft,
} from '../../src/client/settings-card.js';

describe('dsh Web settings card', () => {
  it('covers every common setting and labels its effect timing in Chinese', () => {
    expect(SETTINGS_FIELDS.map((field) => field.key)).toEqual([
      'tenant',
      'appId',
      'appSecret',
      'workspace',
      'model',
      'scopeConcurrency',
      'adapter',
      'notificationDefault',
    ]);
    expect(SETTINGS_FIELDS.every((field) => /生效/.test(field.timing))).toBe(true);
  });

  it('keeps secrets write-only and validates the numeric draft before saving', () => {
    expect(SETTINGS_FIELDS.find((field) => field.key === 'appSecret')?.secret).toBe(true);
    expect(normalizeSettingsDraft({ scopeConcurrency: '4', appSecret: '' })).toEqual({
      scopeConcurrency: 4,
    });
    expect(() => normalizeSettingsDraft({ scopeConcurrency: '0' })).toThrow(/1 到 32/);
  });

  it('offers direct no-response and task-failure diagnostic shortcuts', () => {
    expect(DIAGNOSTIC_SHORTCUTS).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: '/status' }),
      expect.objectContaining({ command: '/doctor' }),
    ]));
    expect(buildWebDiagnostic({
      status: 'ready',
      value: { tenant: 'feishu', adapter: 'sdk' },
      writable: false,
      mode: 'memory',
    })).toMatch(/App ID.*远端只读/s);
  });

  it('mounts through the official settings scope and keyed plugin slot', () => {
    const scope = { getSnapshot: vi.fn(), subscribe: vi.fn(), set: vi.fn(), unset: vi.fn() };
    const bind = vi.fn(() => scope);
    const register = vi.fn(() => undefined);
    const inject = vi.fn((_name: string, install: () => unknown) => install());
    apply({
      settingsScope: { bind },
      slots: { inject, register },
    } as never);
    expect(bind).toHaveBeenCalledWith({ namespace: 'dsh-lark-bot' });
    expect(inject).toHaveBeenCalledWith('settings.plugin.item', expect.any(Function));
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      name: 'settings.plugin.item',
      key: 'dsh-lark-bot',
    }), expect.any(Function));
  });

  it('keeps a redacted secret empty, rejects remote writes, and sends only explicit mutations', async () => {
    expect(draftFrom({ appId: 'cli_test' })).toEqual(expect.objectContaining({
      appId: 'cli_test',
      appSecret: '',
    }));
    expect(canSaveSnapshot({ status: 'ready', writable: false })).toBe(false);
    const set = vi.fn().mockResolvedValue(undefined);
    const unset = vi.fn().mockResolvedValue(undefined);
    await saveSettingsDraft(
      { set, unset },
      {
        value: { appId: 'cli_old', workspace: '/old', adapter: 'sdk' },
        user: { workspace: '/old' },
      },
      { appId: 'cli_new', appSecret: '', workspace: '', adapter: 'sdk' },
    );
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith('appId', 'cli_new');
    expect(unset).toHaveBeenCalledWith('workspace');
    expect(set).not.toHaveBeenCalledWith('appSecret', expect.anything());
  });
});
