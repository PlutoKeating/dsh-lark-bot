import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from '../platform/atomic-write.js';
import { log } from '../core/logger.js';

export interface RoleDefinition {
  id: string;
  name: string;
  /** System-style persona/instructions applied to every run of this role. */
  persona: string;
  /** Optional model override for this role (below the per-scope /model use). */
  model?: string;
  /** Optional comma-separated tool guidance shown to the agent. */
  tools?: string;
  /** Optional role rules text injected like an AGENTS.md. */
  agentsMd?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoleStoreInput {
  id: string;
  name: string;
  persona: string;
  model?: string;
  tools?: string;
  agentsMd?: string;
}

interface RoleData {
  roles: Record<string, RoleDefinition>;
  scopeRoles: Record<string, string>;
}

/**
 * Persisted role registry: named agent roles (persona / model / tools guidance /
 * role rules) plus per-scope role bindings. Stored per profile at
 * `<profile>/roles.json` (0600). Memory of bindings survives restarts.
 */
export class RoleStore {
  private data: RoleData = { roles: {}, scopeRoles: {} };
  private saving: Promise<void> = Promise.resolve();
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<RoleData>;
      this.data = {
        roles: parsed.roles ?? {},
        scopeRoles: parsed.scopeRoles ?? {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.data = { roles: {}, scopeRoles: {} };
    }
  }

  list(): RoleDefinition[] {
    return Object.values(this.data.roles).sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): RoleDefinition | undefined {
    return this.data.roles[id];
  }

  upsert(input: RoleStoreInput): RoleDefinition {
    const existing = this.data.roles[input.id];
    const now = new Date().toISOString();
    const role: RoleDefinition = {
      id: input.id,
      name: input.name,
      persona: input.persona,
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.tools === undefined ? {} : { tools: input.tools }),
      ...(input.agentsMd === undefined ? {} : { agentsMd: input.agentsMd }),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.data.roles[input.id] = role;
    this.schedulePersist();
    return role;
  }

  remove(id: string): boolean {
    if (!(id in this.data.roles)) return false;
    delete this.data.roles[id];
    for (const [scope, roleId] of Object.entries(this.data.scopeRoles)) {
      if (roleId === id) delete this.data.scopeRoles[scope];
    }
    this.schedulePersist();
    return true;
  }

  roleForScope(scope: string): RoleDefinition | undefined {
    const roleId = this.data.scopeRoles[scope];
    return roleId === undefined ? undefined : this.data.roles[roleId];
  }

  setScopeRole(scope: string, roleId: string): boolean {
    if (!(roleId in this.data.roles)) return false;
    this.data.scopeRoles[scope] = roleId;
    this.schedulePersist();
    return true;
  }

  clearScopeRole(scope: string): boolean {
    if (!(scope in this.data.scopeRoles)) return false;
    delete this.data.scopeRoles[scope];
    this.schedulePersist();
    return true;
  }

  async flush(): Promise<void> {
    await this.saving;
  }

  private schedulePersist(): void {
    const snapshot = {
      roles: { ...this.data.roles },
      scopeRoles: { ...this.data.scopeRoles },
    };
    this.saving = this.saving
      .then(async () => {
        await writeFileAtomic(this.path, `${JSON.stringify(snapshot, null, 2)}\n`, {
          mode: 0o600,
        });
      })
      .catch((error: unknown) => {
        log.fail('role-store', error, { step: 'persist' });
      });
  }
}
