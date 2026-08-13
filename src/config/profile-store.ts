import { readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { writeFileAtomic } from '../platform/atomic-write.js';
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
    },
  ): Promise<void> {
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
        allowedUsers: existing?.access?.allowedUsers ?? [],
        allowedChats: existing?.access?.allowedChats ?? [],
        admins: existing?.access?.admins ?? [],
      },
    };
    if (input.operatorOpenId && !profile.access.allowedUsers.includes(input.operatorOpenId)) {
      profile.access.allowedUsers.push(input.operatorOpenId);
      profile.access.admins.push(input.operatorOpenId);
    }
    data.profiles[name] = profile;
    data.activeProfile = name;
    await this.persist();
  }

  private getData(): RootConfig {
    if (!this.data) {
      throw new Error('ConfigStore must be loaded before use');
    }
    return this.data;
  }

  private async persist(): Promise<void> {
    const data = this.getData();
    await mkdir(dirname(this.path), { recursive: true });
    await writeFileAtomic(this.path, `${JSON.stringify(data, null, 2)}\n`, {
      mode: 0o600,
    });
  }
}
