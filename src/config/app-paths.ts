import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface AppPaths {
  root: string;
  configFile: string;
  fleetFile: string;
  handoffFile: string;
  botDshHome: (name: string) => string;
  activeProfileFile: string;
  serviceDir: string;
  serviceEnvFile: (profile: string) => string;
  serviceMetadataFile: (profile: string) => string;
  serviceIntentFile: (profile: string) => string;
  serviceLockDir: (profile: string) => string;
  serviceLogFile: (profile: string) => string;
  profileDir: (profile: string) => string;
  profilePath: (profile: string, ...parts: string[]) => string;
  sessionsFile: (profile: string) => string;
  jobsFile: (profile: string) => string;
  permissionPoliciesFile: (profile: string) => string;
  notificationPreferencesFile: (profile: string) => string;
  replyPoliciesFile: (profile: string) => string;
  executionModesFile: (profile: string) => string;
  languagePoliciesFile: (profile: string) => string;
  sessionCatalogFile: (profile: string) => string;
  sessionProjectionsFile: (profile: string) => string;
  archivesDir: (profile: string) => string;
  workspacesFile: (profile: string) => string;
  mediaDir: (profile: string) => string;
  logsDir: (profile: string) => string;
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
    fleetFile: join(root, 'fleet.json'),
    handoffFile: join(root, 'handoffs.json'),
    botDshHome: (name) => join(root, 'bots', name, 'dsh'),
    activeProfileFile: join(root, 'active-profile'),
    serviceDir: join(root, 'service'),
    serviceEnvFile: (profile) => join(root, 'service', `${profile}.env`),
    serviceMetadataFile: (profile) => join(root, 'service', `${profile}.json`),
    serviceIntentFile: (profile) => join(root, 'service', `${profile}.intent.json`),
    serviceLockDir: (profile) => join(root, 'service', `${profile}.lock`),
    serviceLogFile: (profile) => profilePath(profile, 'logs', 'service.log'),
    profileDir,
    profilePath,
    sessionsFile: (profile) => profilePath(profile, 'sessions.json'),
    jobsFile: (profile) => profilePath(profile, 'jobs.json'),
    permissionPoliciesFile: (profile) => profilePath(profile, 'permission-policies.json'),
    notificationPreferencesFile: (profile) => profilePath(profile, 'notification-preferences.json'),
    replyPoliciesFile: (profile) => profilePath(profile, 'reply-policies.json'),
    executionModesFile: (profile) => profilePath(profile, 'execution-modes.json'),
    languagePoliciesFile: (profile) => profilePath(profile, 'language-policy.json'),
    sessionCatalogFile: (profile) => profilePath(profile, 'sessions.json.catalog.json'),
    sessionProjectionsFile: (profile) => profilePath(profile, 'session-projections.json'),
    archivesDir: (profile) => profilePath(profile, 'archives'),
    workspacesFile: (profile) => profilePath(profile, 'workspaces.json'),
    mediaDir: (profile) => profilePath(profile, 'media'),
    logsDir: (profile) => profilePath(profile, 'logs'),
  };
}
