import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { writeFileAtomic } from '../platform/atomic-write.js';
import { withFileLock } from '../platform/file-lock.js';

export interface BotFleetEntry {
  name: string;
  bridgeProfile: string;
  dshProfile: string;
  dshHome: string;
  enabled: boolean;
  botOpenId?: string;
  botName?: string;
  startupError?: string;
  createdAt: string;
  updatedAt: string;
}

interface FleetFile {
  schemaVersion: 1;
  bots: Record<string, BotFleetEntry>;
}

export interface BotPeer {
  name: string;
  openId: string;
  displayName?: string;
}

export function validBotInstanceName(name: string): boolean {
  return /^[a-z][a-z0-9-]{0,31}$/u.test(name);
}

/** Shared, reload-on-read registry for independently running bot services. */
export class BotFleetStore {
  private data: FleetFile = { schemaVersion: 1, bots: {} };

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<FleetFile>;
      this.data = {
        schemaVersion: 1,
        bots: Object.fromEntries(
          Object.entries(parsed.bots ?? {}).filter(([, entry]) => isFleetEntry(entry)),
        ),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.data = { schemaVersion: 1, bots: {} };
    }
  }

  list(): BotFleetEntry[] {
    return Object.values(this.data.bots)
      .map((entry) => ({ ...entry }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): BotFleetEntry | undefined {
    const entry = this.data.bots[name];
    return entry ? { ...entry } : undefined;
  }

  async add(input: {
    name: string;
    bridgeProfile: string;
    dshProfile: string;
    dshHome: string;
  }): Promise<BotFleetEntry> {
    if (!validBotInstanceName(input.name)) {
      throw new Error('机器人实例名必须以小写字母开头，只能包含小写字母、数字和连字符，最长 32 字符。');
    }
    return this.withLock(async () => {
      await this.load();
      if (this.data.bots[input.name]) throw new Error(`机器人实例已存在：${input.name}`);
      const now = new Date().toISOString();
      const entry: BotFleetEntry = {
        ...input,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      };
      this.data.bots[input.name] = entry;
      await this.persist();
      return { ...entry };
    });
  }

  async ensure(input: {
    name: string;
    bridgeProfile: string;
    dshProfile: string;
    dshHome: string;
  }): Promise<BotFleetEntry> {
    if (!validBotInstanceName(input.name)) throw new Error(`机器人实例名无效：${input.name}`);
    return this.withLock(async () => {
      await this.load();
      const current = this.data.bots[input.name];
      if (current) return { ...current };
      const now = new Date().toISOString();
      const entry: BotFleetEntry = {
        ...input, enabled: true, createdAt: now, updatedAt: now,
      };
      this.data.bots[input.name] = entry;
      await this.persist();
      return { ...entry };
    });
  }

  async registerIdentity(
    name: string,
    identity: { openId: string; name?: string },
  ): Promise<void> {
    await this.withLock(async () => {
      await this.load();
      const current = this.data.bots[name];
      if (!current || !current.enabled) return;
      const duplicate = Object.values(this.data.bots).find((entry) =>
        entry.enabled && entry.name !== name && entry.botOpenId === identity.openId
      );
      if (duplicate) {
        const message = `机器人身份 ${identity.openId} 已属于实例 ${duplicate.name}；拒绝启动重复连接。`;
        this.data.bots[name] = {
          ...current,
          startupError: message,
          updatedAt: new Date().toISOString(),
        };
        await this.persist();
        throw new Error(message);
      }
      const { startupError: _startupError, ...healthy } = current;
      this.data.bots[name] = {
        ...healthy,
        botOpenId: identity.openId,
        ...(identity.name ? { botName: identity.name } : {}),
        updatedAt: new Date().toISOString(),
      };
      await this.persist();
    });
  }

  async remove(name: string): Promise<BotFleetEntry | undefined> {
    return this.withLock(async () => {
      await this.load();
      const current = this.data.bots[name];
      if (!current) return undefined;
      delete this.data.bots[name];
      await this.persist();
      return { ...current };
    });
  }

  async isTrustedPeer(openId: string, ownName: string): Promise<boolean> {
    await this.load();
    return Object.values(this.data.bots).some((entry) =>
      entry.enabled && entry.name !== ownName && entry.botOpenId === openId
    );
  }

  async peersFor(ownName: string): Promise<BotPeer[]> {
    await this.load();
    return Object.values(this.data.bots)
      .filter((entry) => entry.enabled && entry.name !== ownName && Boolean(entry.botOpenId))
      .map((entry) => ({
        name: entry.name,
        openId: entry.botOpenId!,
        ...(entry.botName ? { displayName: entry.botName } : {}),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFileAtomic(this.path, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    return withFileLock(
      `${this.path}.lock`,
      '机器人实例注册表正由另一进程更新，请稍后重试。',
      operation,
    );
  }
}

function isFleetEntry(value: unknown): value is BotFleetEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<BotFleetEntry>;
  return typeof entry.name === 'string' && validBotInstanceName(entry.name) &&
    typeof entry.bridgeProfile === 'string' && typeof entry.dshProfile === 'string' &&
    typeof entry.dshHome === 'string' &&
    typeof entry.enabled === 'boolean' && typeof entry.createdAt === 'string' &&
    typeof entry.updatedAt === 'string';
}
