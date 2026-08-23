import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from '../platform/atomic-write.js';

export type PlainLanguage = 'bilingual' | 'zh' | 'en';
export type AgentLanguage = 'auto' | 'zh' | 'en';
export interface LanguagePolicy {
  ui: 'per-viewer';
  plain: PlainLanguage;
  agent: AgentLanguage;
}

export const DEFAULT_LANGUAGE_POLICY: Readonly<LanguagePolicy> = Object.freeze({
  ui: 'per-viewer', plain: 'bilingual', agent: 'auto',
});

interface StoredLanguagePolicy { schemaVersion: 1; plain: PlainLanguage; agent: AgentLanguage }

export class LanguagePolicyStore {
  private policy: LanguagePolicy = { ...DEFAULT_LANGUAGE_POLICY };
  private saving: Promise<void> = Promise.resolve();
  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    if (this.path === ':memory:') return;
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<StoredLanguagePolicy>;
      this.policy = {
        ui: 'per-viewer',
        plain: parsed.plain === 'zh' || parsed.plain === 'en' ? parsed.plain : 'bilingual',
        agent: parsed.agent === 'zh' || parsed.agent === 'en' ? parsed.agent : 'auto',
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  get(): LanguagePolicy { return { ...this.policy }; }

  async set(patch: { plain?: PlainLanguage; agent?: AgentLanguage }): Promise<void> {
    if (patch.plain && !['bilingual', 'zh', 'en'].includes(patch.plain)) throw new Error('invalid plain language');
    if (patch.agent && !['auto', 'zh', 'en'].includes(patch.agent)) throw new Error('invalid agent language');
    this.policy = { ...this.policy, ...patch, ui: 'per-viewer' };
    await this.persist();
  }

  async reset(field: 'plain' | 'agent' | 'all'): Promise<void> {
    if (field === 'plain' || field === 'all') this.policy.plain = DEFAULT_LANGUAGE_POLICY.plain;
    if (field === 'agent' || field === 'all') this.policy.agent = DEFAULT_LANGUAGE_POLICY.agent;
    await this.persist();
  }

  private async persist(): Promise<void> {
    const snapshot = { schemaVersion: 1 as const, plain: this.policy.plain, agent: this.policy.agent };
    const pending = this.saving.then(async () => {
      if (this.path !== ':memory:') {
        await writeFileAtomic(this.path, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
      }
    });
    this.saving = pending.catch(() => undefined);
    await pending;
  }

  async flush(): Promise<void> { await this.saving; }
}
