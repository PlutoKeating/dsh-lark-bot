import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client';
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { useEffect, useState, useSyncExternalStore } from 'react';

export const SETTINGS_NAMESPACE = 'dsh-lark-bot';

type SettingKey =
  | 'tenant'
  | 'appId'
  | 'appSecret'
  | 'workspace'
  | 'model'
  | 'scopeConcurrency'
  | 'adapter'
  | 'notificationDefault';

export interface SettingsField {
  key: SettingKey;
  label: string;
  help: string;
  timing: string;
  secret?: boolean;
}

export const SETTINGS_FIELDS: readonly SettingsField[] = [
  { key: 'tenant', label: '服务区域 / Region', help: '中国大陆选飞书，海外工作区选 Lark。', timing: '保存后自动重连生效' },
  { key: 'appId', label: '应用 ID / App ID', help: '飞书开放平台中以 cli_ 开头的应用 ID。', timing: '保存后自动重连生效' },
  { key: 'appSecret', label: '应用密钥 / App Secret', help: '只写不回显；留空不会覆盖已保存密钥。', timing: '保存后自动重连生效', secret: true },
  { key: 'workspace', label: '默认项目文件夹 / Workspace', help: '新会话默认打开的本机项目目录，例如 /Users/me/project。', timing: '新会话生效（保存后自动重连）' },
  { key: 'model', label: '默认模型 / Model', help: '新任务使用的 provider/model 路由。', timing: '保存后热更新，下一任务生效' },
  { key: 'scopeConcurrency', label: '并行任务数 / Parallel tasks', help: '每个飞书会话同时运行的任务数，建议 1–4。', timing: '保存后立即生效于新任务' },
  { key: 'adapter', label: '运行方式 / Runtime mode', help: '一般选择 sdk；只有连接现有 dsh Web 会话时选择 web。', timing: '保存后自动重连生效' },
  { key: 'notificationDefault', label: '默认提醒 / Notifications', help: '会话未单独设置时，是否主动提醒完成、失败和审批。', timing: '保存后立即生效于新提醒' },
] as const;

export const DIAGNOSTIC_SHORTCUTS = [
  { command: '/status', label: 'Bot 没反应：查看连接与运行状态' },
  { command: '/doctor', label: '任务失败：生成脱敏诊断包' },
] as const;

export interface BrowserSettings {
  tenant?: 'feishu' | 'lark';
  appId?: string;
  workspace?: string;
  model?: string;
  scopeConcurrency?: number;
  adapter?: 'sdk' | 'acp' | 'headless' | 'web';
  notificationDefault?: 'off' | 'completed' | 'all';
}

type SettingsDraft = Partial<Record<SettingKey, string>>;

/** Normalize a browser form without ever manufacturing an empty secret write. */
export function normalizeSettingsDraft(draft: SettingsDraft): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(draft)) {
    const value = raw.trim();
    if (!value) continue;
    if (key === 'scopeConcurrency') {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 32) {
        throw new Error('并行任务数必须是 1 到 32 的整数。');
      }
      output[key] = parsed;
    } else {
      output[key] = value;
    }
  }
  return output;
}

export function draftFrom(value: BrowserSettings | undefined): SettingsDraft {
  return {
    tenant: value?.tenant ?? 'feishu',
    appId: value?.appId ?? '',
    appSecret: '',
    workspace: value?.workspace ?? '',
    model: value?.model ?? '',
    scopeConcurrency: value?.scopeConcurrency === undefined ? '' : String(value.scopeConcurrency),
    adapter: value?.adapter ?? 'sdk',
    notificationDefault: value?.notificationDefault ?? 'off',
  };
}

export interface BrowserDiagnosticSnapshot {
  status: 'loading' | 'ready' | 'unavailable';
  value: BrowserSettings | undefined;
  writable: boolean;
  mode: 'host' | 'memory';
}

/** A direct, secret-free Web diagnosis; Feishu commands remain the deep fallback. */
export function buildWebDiagnostic(snapshot: BrowserDiagnosticSnapshot): string {
  if (snapshot.status !== 'ready') {
    return '⚠️ Web 尚未连接到插件设置。请确认插件已启用并刷新页面；远程页面不可用时请回到运行 dsh 的主机。';
  }
  const value = snapshot.value ?? {};
  const findings: string[] = [];
  if (!value.appId) findings.push('未检测到 App ID，请先填写飞书/Lark 应用 ID。');
  if (!value.workspace) findings.push('未设置默认项目文件夹；新任务可能无法进入预期项目。');
  if (!value.model) findings.push('未设置默认模型；将继承 dsh/profile 默认值。');
  if (snapshot.mode === 'memory' || !snapshot.writable) {
    findings.push('当前是远端只读视图；修改设置需打开运行 dsh 的本机 Web。');
  }
  if (findings.length === 0) {
    return `✅ 页面配置检查通过：${value.tenant ?? 'feishu'} / ${value.adapter ?? 'sdk'}，App ID、工作目录和模型均已配置。App Secret 按安全策略不回显；如 bot 仍无响应，请重新填写密钥后保存，或在飞书运行 /status。`;
  }
  return `⚠️ 页面配置发现 ${findings.length} 项：\n${findings.map((item) => `• ${item}`).join('\n')}\nApp Secret 按安全策略不回显；连接失败时可重新填写后保存。`;
}

export function canSaveSnapshot(snapshot: Pick<BrowserDiagnosticSnapshot, 'status' | 'writable'>): boolean {
  return snapshot.status === 'ready' && snapshot.writable;
}

export async function saveSettingsDraft(
  scope: Pick<SettingsScope<BrowserSettings>, 'set' | 'unset'>,
  snapshot: Pick<ReturnType<SettingsScope<BrowserSettings>['getSnapshot']>, 'value' | 'user'>,
  draft: SettingsDraft,
): Promise<void> {
  const normalized = normalizeSettingsDraft(draft);
  const current = (snapshot.value ?? {}) as Record<string, unknown>;
  const user = snapshot.user && typeof snapshot.user === 'object'
    ? snapshot.user as Record<string, unknown>
    : {};
  for (const field of SETTINGS_FIELDS) {
    if (field.secret && normalized[field.key] === undefined) continue;
    const next = normalized[field.key];
    if (next === undefined) {
      if (field.key in user) await scope.unset(field.key);
    } else if (field.secret || current[field.key] !== next) {
      await scope.set(field.key, next);
    }
  }
}

function SettingsCard({ scope }: { scope: SettingsScope<BrowserSettings> }) {
  const snapshot = useSyncExternalStore(scope.subscribe, scope.getSnapshot);
  const [draft, setDraft] = useState<SettingsDraft>(() => draftFrom(snapshot.value));
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [diagnostic, setDiagnostic] = useState('');

  useEffect(() => {
    setDraft(draftFrom(snapshot.value));
  }, [snapshot.value]);

  if (snapshot.status !== 'ready') return null;

  const update = (key: SettingKey, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      await saveSettingsDraft(scope, snapshot, draft);
      setDraft((current) => ({ ...current, appSecret: '' }));
      setMessage('✅ 已保存。连接类设置会自动重连，其余设置用于下一任务。');
    } catch (error) {
      setMessage(`⚠️ ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section style={styles.card} aria-label="dsh-lark-bot settings">
      <header style={styles.header}>
        <div>
          <strong style={styles.title}>飞书 / Lark 机器人</strong>
          <div style={styles.subtitle}>常用设置可直接在这里完成，不需要环境变量或命令行。</div>
        </div>
        <span style={styles.badge}>dsh-lark-bot</span>
      </header>

      <div style={styles.grid}>
        <SelectField field={SETTINGS_FIELDS[0]!} value={draft.tenant ?? 'feishu'} options={[['feishu', '飞书（中国大陆）'], ['lark', 'Lark（海外）']]} onChange={update} />
        <TextField field={SETTINGS_FIELDS[1]!} value={draft.appId ?? ''} placeholder="cli_xxxxxxxxx" onChange={update} />
        <TextField field={SETTINGS_FIELDS[2]!} value={draft.appSecret ?? ''} placeholder="填写新密钥（已保存的不会显示）" onChange={update} />
        <TextField field={SETTINGS_FIELDS[3]!} value={draft.workspace ?? ''} placeholder="/Users/me/project" onChange={update} />
        <TextField field={SETTINGS_FIELDS[4]!} value={draft.model ?? ''} placeholder="provider/model" onChange={update} />
        <TextField field={SETTINGS_FIELDS[5]!} value={draft.scopeConcurrency ?? ''} placeholder="2" inputMode="numeric" onChange={update} />
        <SelectField field={SETTINGS_FIELDS[6]!} value={draft.adapter ?? 'sdk'} options={[['sdk', 'SDK（推荐）'], ['web', 'dsh Web 会话'], ['acp', 'ACP'], ['headless', '命令行兼容']]} onChange={update} />
        <SelectField field={SETTINGS_FIELDS[7]!} value={draft.notificationDefault ?? 'off'} options={[['off', '关闭（默认）'], ['completed', '完成与失败'], ['all', '完成、失败和审批']]} onChange={update} />
      </div>

      <div style={styles.actions}>
        <button type="button" style={styles.primaryButton} disabled={saving || !canSaveSnapshot(snapshot)} onClick={() => { void save(); }}>
          {saving ? '保存中…' : '保存设置'}
        </button>
        {!snapshot.writable && <span style={styles.muted}>当前连接为只读；请在本机 dsh Web 中修改。</span>}
        {message && <span role="status" style={styles.message}>{message}</span>}
      </div>

      <aside style={styles.diagnostics}>
        <strong>快速诊断 / Quick diagnosis</strong>
        <p style={styles.help}>先在本页直接检查常见配置问题；需要运行态详情时，再用飞书命令深入诊断。两种方式都不会暴露密钥。</p>
        <button type="button" style={styles.secondaryButton} onClick={() => { setDiagnostic(buildWebDiagnostic(snapshot)); }}>
          立即检查页面配置 / Diagnose now
        </button>
        {diagnostic && <pre role="status" style={styles.diagnosticResult}>{diagnostic}</pre>}
        <div style={styles.actions}>
          {DIAGNOSTIC_SHORTCUTS.map((shortcut) => (
            <button key={shortcut.command} type="button" style={styles.secondaryButton} onClick={() => { void copyDiagnostic(shortcut.command, setMessage); }}>
              复制 {shortcut.command} · {shortcut.label}
            </button>
          ))}
        </div>
      </aside>
    </section>
  );
}

function TextField(props: {
  field: SettingsField;
  value: string;
  placeholder: string;
  inputMode?: 'numeric';
  onChange(key: SettingKey, value: string): void;
}) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{props.field.label}</span>
      <input
        style={styles.input}
        type={props.field.secret ? 'password' : 'text'}
        inputMode={props.inputMode}
        autoComplete={props.field.secret ? 'new-password' : 'off'}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => { props.onChange(props.field.key, event.currentTarget.value); }}
      />
      <span style={styles.help}>{props.field.help}</span>
      <span style={styles.timing}>⏱ {props.field.timing}</span>
    </label>
  );
}

function SelectField(props: {
  field: SettingsField;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange(key: SettingKey, value: string): void;
}) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{props.field.label}</span>
      <select style={styles.input} value={props.value} onChange={(event) => { props.onChange(props.field.key, event.currentTarget.value); }}>
        {props.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <span style={styles.help}>{props.field.help}</span>
      <span style={styles.timing}>⏱ {props.field.timing}</span>
    </label>
  );
}

async function copyDiagnostic(command: string, setMessage: (message: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(command);
    setMessage(`✅ 已复制 ${command}，请粘贴到飞书机器人会话。`);
  } catch {
    setMessage(`请在飞书机器人会话发送：${command}`);
  }
}

const styles = {
  card: { border: '1px solid var(--border, #dfe3e8)', borderRadius: 16, padding: 20, background: 'var(--surface, #fff)', display: 'grid', gap: 20 },
  header: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' },
  title: { fontSize: 18 },
  subtitle: { color: 'var(--muted-foreground, #667085)', marginTop: 4, fontSize: 13 },
  badge: { borderRadius: 999, padding: '4px 10px', background: '#e8f3ff', color: '#1456a0', fontSize: 12 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 },
  field: { display: 'grid', gap: 6 },
  label: { fontWeight: 600, fontSize: 13 },
  input: { width: '100%', boxSizing: 'border-box' as const, border: '1px solid var(--border, #cfd6dd)', borderRadius: 8, padding: '9px 10px', background: 'var(--background, #fff)', color: 'inherit' },
  help: { color: 'var(--muted-foreground, #667085)', fontSize: 12, margin: 0 },
  timing: { color: '#2667b5', fontSize: 12 },
  actions: { display: 'flex', flexWrap: 'wrap' as const, gap: 10, alignItems: 'center' },
  primaryButton: { border: 0, borderRadius: 8, padding: '9px 16px', background: '#1456a0', color: '#fff', cursor: 'pointer' },
  secondaryButton: { border: '1px solid var(--border, #cfd6dd)', borderRadius: 8, padding: '8px 12px', background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left' as const },
  diagnostics: { borderRadius: 12, padding: 14, background: 'var(--muted, #f6f8fa)', display: 'grid', gap: 8 },
  diagnosticResult: { whiteSpace: 'pre-wrap' as const, margin: 0, fontFamily: 'inherit', fontSize: 12 },
  muted: { color: 'var(--muted-foreground, #667085)', fontSize: 12 },
  message: { fontSize: 13 },
} as const;

/** dsh browser-half entry: register one card under the matching Host namespace. */
export const inject = ['slots', 'settingsScope'];

export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind<BrowserSettings>({ namespace: SETTINGS_NAMESPACE });
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: SETTINGS_NAMESPACE,
    inject: () => ({ scope }),
  }, SettingsCard));
}
