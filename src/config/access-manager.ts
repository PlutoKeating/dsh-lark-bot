import type { ConfigStore, ProfileConfig } from './profile-store.js';

export interface AccessSnapshot {
  allowedUsers: string[];
  allowedChats: string[];
  admins: string[];
}

export class AccessManager {
  constructor(
    private readonly store: ConfigStore,
    private readonly profileName: string,
  ) {}

  snapshot(): AccessSnapshot {
    const profile = this.profile();
    return {
      allowedUsers: [...profile.access.allowedUsers],
      allowedChats: [...profile.access.allowedChats],
      admins: [...profile.access.admins],
    };
  }

  async addUser(id: string): Promise<void> {
    const snapshot = this.snapshot();
    if (!snapshot.allowedUsers.includes(id)) snapshot.allowedUsers.push(id);
    await this.persist(snapshot);
  }

  async addAdmin(id: string): Promise<void> {
    const snapshot = this.snapshot();
    if (!snapshot.allowedUsers.includes(id)) snapshot.allowedUsers.push(id);
    if (!snapshot.admins.includes(id)) snapshot.admins.push(id);
    await this.persist(snapshot);
  }

  async addChat(chatId: string): Promise<void> {
    const snapshot = this.snapshot();
    if (!snapshot.allowedChats.includes(chatId)) snapshot.allowedChats.push(chatId);
    await this.persist(snapshot);
  }

  async removeUser(id: string): Promise<void> {
    const snapshot = this.snapshot();
    snapshot.allowedUsers = snapshot.allowedUsers.filter((item) => item !== id);
    snapshot.admins = snapshot.admins.filter((item) => item !== id);
    await this.persist(snapshot);
  }

  async removeChat(chatId: string): Promise<void> {
    const snapshot = this.snapshot();
    snapshot.allowedChats = snapshot.allowedChats.filter((item) => item !== chatId);
    await this.persist(snapshot);
  }

  private profile(): ProfileConfig {
    const profile = this.store.getProfile(this.profileName);
    if (!profile) throw new Error(`profile not found: ${this.profileName}`);
    return profile;
  }

  private async persist(snapshot: AccessSnapshot): Promise<void> {
    const profile = this.profile();
    await this.store.saveProfile(this.profileName, {
      tenant: profile.tenant,
      appId: profile.accounts.appId,
      appSecret: profile.accounts.appSecret,
      access: snapshot,
    });
  }
}
