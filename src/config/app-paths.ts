import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface AppPaths {
  root: string;
  configFile: string;
  activeProfileFile: string;
  profileDir: (profile: string) => string;
  profilePath: (profile: string, ...parts: string[]) => string;
  sessionsFile: (profile: string) => string;
  sessionCatalogFile: (profile: string) => string;
  workspacesFile: (profile: string) => string;
  mediaDir: (profile: string) => string;
  logsDir: (profile: string) => string;
  registryFile: string;
  locksDir: string;
}

export function defaultHome(): string {
  const override = process.env.DSH_LARK_HOME?.trim();
  return override ? resolve(override) : join(homedir(), '.dsh-lark');
}

export function resolveAppPaths(root: string = defaultHome()): AppPaths {
  const profileDir = (profile: string): string => join(root, 'profiles', profile);
  const profilePath = (profile: string, ...parts: string[]): string =>
    join(profileDir(profile), ...parts);

  return {
    root,
    configFile: join(root, 'config.json'),
    activeProfileFile: join(root, 'active-profile'),
    profileDir,
    profilePath,
    sessionsFile: (profile) => profilePath(profile, 'sessions.json'),
    sessionCatalogFile: (profile) => profilePath(profile, 'sessions.json.catalog.json'),
    workspacesFile: (profile) => profilePath(profile, 'workspaces.json'),
    mediaDir: (profile) => profilePath(profile, 'media'),
    logsDir: (profile) => profilePath(profile, 'logs'),
    registryFile: join(root, 'registry', 'processes.json'),
    locksDir: join(root, 'registry', 'locks'),
  };
}
