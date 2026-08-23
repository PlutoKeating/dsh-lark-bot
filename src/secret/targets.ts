import type { DshProviderManager } from '../config/dsh-config.js';
import type { ConfigStore } from '../config/profile-store.js';
import type { SecretTargetType, SecretTargetWriter } from './registry.js';

const REFERENCE = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;

export class SecretTargetManager implements SecretTargetWriter {
  constructor(private readonly deps: { dsh: DshProviderManager; profiles: ConfigStore; profileName: string }) {}

  validate(target: SecretTargetType, reference: string): void {
    if (target === 'dsh-credential' && !REFERENCE.test(reference)) throw new Error('invalid credential reference');
    if (target === 'app-secret' && reference !== 'current' && reference !== this.deps.profileName) throw new Error('invalid app-secret reference');
  }

  async set(target: SecretTargetType, reference: string, value: string): Promise<void> {
    this.validate(target, reference);
    if (target === 'dsh-credential') {
      await this.deps.dsh.setCredential(reference, value);
      await this.deps.dsh.linkCredentialRefIfMissing(reference).catch(() => false);
      return;
    }
    const profile = this.requiredProfile();
    await this.deps.profiles.saveProfile(this.deps.profileName, {
      tenant: profile.tenant, appId: profile.accounts.appId, appSecret: value,
      ...(profile.workspaces.default ? { workspace: profile.workspaces.default } : {}),
      ...(profile.preferences.model ? { model: profile.preferences.model } : {}),
      ...(profile.preferences.stopGraceMs !== undefined ? { stopGraceMs: profile.preferences.stopGraceMs } : {}),
      ...(profile.preferences.runTimeoutMs !== undefined ? { runTimeoutMs: profile.preferences.runTimeoutMs } : {}),
      access: profile.access,
    });
  }

  async remove(target: SecretTargetType, reference: string): Promise<boolean> {
    this.validate(target, reference);
    if (target === 'dsh-credential') return this.deps.dsh.removeCredential(reference);
    const profile = this.requiredProfile();
    if (!profile.accounts.appSecret) return false;
    await this.set(target, reference, '');
    return true;
  }

  async configured(target: SecretTargetType, reference: string): Promise<boolean> {
    this.validate(target, reference);
    return target === 'dsh-credential'
      ? this.deps.dsh.hasCredential(reference)
      : Boolean(this.requiredProfile().accounts.appSecret);
  }

  private requiredProfile() {
    const profile = this.deps.profiles.getProfile(this.deps.profileName);
    if (!profile) throw new Error('profile is unavailable');
    return profile;
  }
}
