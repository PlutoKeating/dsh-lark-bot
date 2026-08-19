export type ServicePlatform =
  | 'linux-systemd'
  | 'linux-portable'
  | 'darwin-launchd'
  | 'win32-task';

export type ServiceRuntimeState = 'running' | 'stopped' | 'error' | 'unknown';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: { env?: NodeJS.ProcessEnv; timeoutMs?: number },
) => Promise<CommandResult>;

export interface ServiceSpec {
  serviceName: string;
  label: string;
  profile: string;
  nodePath: string;
  cliJsPath: string;
  /** Resolved dsh CLI entry launched by the private service runner. */
  dshBin: string;
  /** Executable and argv registered with the OS service manager. */
  commandPath: string;
  commandArgs: string[];
  envFile: string;
  logFile: string;
  env: Record<string, string>;
}

export interface ServiceStatus {
  name: string;
  platform: ServicePlatform;
  installed: boolean;
  autostartEnabled: boolean;
  state: ServiceRuntimeState;
  pid: number | undefined;
  detail: string;
  restarts: number | undefined;
}

export interface ServiceController {
  readonly platform: ServicePlatform;
  installAndStart(spec: ServiceSpec): Promise<void>;
  start(spec: ServiceSpec): Promise<void>;
  stop(spec: ServiceSpec): Promise<void>;
  restart(spec: ServiceSpec): Promise<void>;
  uninstall(spec: ServiceSpec): Promise<void>;
  status(spec: ServiceSpec): Promise<ServiceStatus>;
}
