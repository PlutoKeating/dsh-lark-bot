import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { writeFileAtomic } from '../platform/atomic-write.js';
import { withFileLock } from '../platform/file-lock.js';
import type { LarkTenant } from './env.js';

export interface ProfileConfig {
  schemaVersion: 1;
  agentKind: 'dsh';
  tenant: LarkTenant;
  accounts: {
    appId: string;
    appSecret: string;
  };
  workspaces: {
    default: string | undefined;
  };
  preferences: {
    model: string | undefined;
    stopGraceMs: number | undefined;
    runTimeoutMs: number | undefined;
  };
  access: {
    allowedUsers: string[];
    allowedChats: string[];
    admins: string[];
  };
}

export interface RootConfig {
  schemaVersion: 1;
  activeProfile: string;
  profiles: Record<string, ProfileConfig>;
}

export class ConfigStore {
  private data: RootConfig | undefined;

  constructor(private readonly path: string) {}

  async load(): Promise<RootConfig> {
    if (this.path === ':memory:') {
      this.data ??= { schemaVersion: 1, activeProfile: 'default', profiles: {} };
      return this.data;
    }
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<RootConfig>;
      this.data = {
        schemaVersion: 1,
        activeProfile: parsed.activeProfile ?? 'default',
        profiles: Object.fromEntries(
          Object.entries(parsed.profiles ?? {}).map(([name, profile]) => [
            name,
            {
              ...profile,
              access: {
                allowedUsers: profile.access?.allowedUsers ?? [],
                allowedChats: profile.access?.allowedChats ?? [],
                admins: profile.access?.admins ?? [],
              },
            },
          ]),
        ),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.data = {
        schemaVersion: 1,
        activeProfile: 'default',
        profiles: {},
      };
    }
    return this.data;
  }

  getActiveProfile(): ProfileConfig | undefined {
    const data = this.getData();
    return data.profiles[data.activeProfile];
  }

  getProfile(name: string): ProfileConfig | undefined {
    const data = this.getData();
    return data.profiles[name];
  }

  listProfiles(): Array<{ name: string; profile: ProfileConfig }> {
    return Object.entries(this.getData().profiles)
      .map(([name, profile]) => ({ name, profile }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Remove credentials/config only; per-profile session/worktree data stays on disk. */
  async removeProfile(name: string): Promise<boolean> {
    return this.withLock(async () => {
      await this.reloadForWrite();
      const data = this.getData();
      if (!data.profiles[name]) return false;
      delete data.profiles[name];
      if (data.activeProfile === name) {
        data.activeProfile = Object.keys(data.profiles).sort()[0] ?? 'default';
      }
      await this.persist();
      return true;
    });
  }

  async saveProfile(
    name: string,
    input: {
      tenant: LarkTenant;
      appId: string;
      appSecret: string;
      workspace?: string;
      model?: string;
      stopGraceMs?: number;
      runTimeoutMs?: number;
      operatorOpenId?: string;
      access?: {
        allowedUsers?: string[];
        allowedChats?: string[];
        admins?: string[];
      };
    },
  ): Promise<void> {
    await this.withLock(async () => {
      await this.reloadForWrite();
      const data = this.getData();
      const existing = data.profiles[name];
      const profile: ProfileConfig = {
        schemaVersion: 1,
        agentKind: 'dsh',
        tenant: input.tenant,
        accounts: {
          appId: input.appId,
          appSecret: input.appSecret,
        },
        workspaces: {
          default: input.workspace ?? existing?.workspaces.default ?? undefined,
        },
        preferences: {
          model: input.model ?? existing?.preferences.model ?? undefined,
          stopGraceMs: input.stopGraceMs ?? existing?.preferences.stopGraceMs ?? undefined,
          runTimeoutMs: input.runTimeoutMs ?? existing?.preferences.runTimeoutMs ?? undefined,
        },
        access: {
          allowedUsers: input.access?.allowedUsers ?? existing?.access?.allowedUsers ?? [],
          allowedChats: input.access?.allowedChats ?? existing?.access?.allowedChats ?? [],
          admins: input.access?.admins ?? existing?.access?.admins ?? [],
        },
      };
      if (input.operatorOpenId && !profile.access.allowedUsers.includes(input.operatorOpenId)) {
        profile.access.allowedUsers.push(input.operatorOpenId);
        profile.access.admins.push(input.operatorOpenId);
      }
      data.profiles[name] = profile;
      await this.persist();
    });
  }

  private getData(): RootConfig {
    if (!this.data) {
      throw new Error('ConfigStore must be loaded before use');
    }
    return this.data;
  }

  private async persist(): Promise<void> {
    if (this.path === ':memory:') return;
    const data = this.getData();
    await mkdir(dirname(this.path), { recursive: true });
    await writeFileAtomic(this.path, `${JSON.stringify(data, null, 2)}\n`, {
      mode: 0o600,
    });
  }

  private async reloadForWrite(): Promise<void> {
    if (this.path !== ':memory:') await this.load();
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    if (this.path === ':memory:') return operation();
    return withFileLock(
      `${this.path}.lock`,
      '配置文件正由另一个机器人实例更新，请稍后重试。',
      operation,
    );
  }
}
