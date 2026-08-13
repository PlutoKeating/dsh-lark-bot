# API 契约 · API Contract

> 本文记录 dsh-lark-bot 对内部模块和外部调用方暴露的稳定接口。当前处于 P0/P1 演进阶段，标记为 “planned” 的接口尚未冻结。
> This file records stable interfaces exposed by dsh-lark-bot. Interfaces marked “planned” are not frozen yet.

## 1. 运行时环境 · Runtime environment

`src/config/env.ts` 提供：

```ts
export interface RuntimeEnv {
  home: string;
  tenant: 'feishu' | 'lark';
  appId: string | undefined;
  appSecret: string | undefined;
  workspace: string | undefined;
  dshCommand: string;
  dshArgs: string[];
  provider: string;
  model: string;
  runTimeoutMs: number;
}

export function loadRuntimeEnv(source?: NodeJS.ProcessEnv): RuntimeEnv;
```

环境变量前缀统一为 `DSH_LARK_*`，敏感值只保留在运行时对象中，不写入日志或提交。

## 2. 本地状态路径 · Local state paths

`src/config/app-paths.ts` 提供：

```ts
export interface AppPaths {
  root: string;
  configFile: string;
  activeProfileFile: string;
  profileDir(profile: string): string;
  profilePath(profile: string, ...parts: string[]): string;
  sessionsFile(profile: string): string;
  sessionCatalogFile(profile: string): string;
  workspacesFile(profile: string): string;
  mediaDir(profile: string): string;
  logsDir(profile: string): string;
  registryFile: string;
  locksDir: string;
}

export function resolveAppPaths(root?: string): AppPaths;
```

默认根目录为 `~/.dsh-lark`，可通过 `DSH_LARK_HOME` 覆盖。

## 3. 结构化日志 · Structured logging

`src/core/logger.ts` 提供：

```ts
export interface Logger {
  info(category: string, event: string, fields?: LogFields): void;
  warn(category: string, event: string, fields?: LogFields): void;
  error(category: string, event: string, fields?: LogFields): void;
  fail(category: string, error: unknown, fields?: LogFields): void;
}
```

日志按 JSON Lines 输出，并自动脱敏 secret/token/password/api_key 等字段。

## 4. Agent 适配器 · Agent adapter (planned)

计划定义与 lark-coding-agent-bridge 语义兼容的事件契约：

```ts
export interface AgentRunOptions {
  runId: string;
  prompt: string;
  cwd?: string;
  sessionId?: string;
  model?: string;
  stopGraceMs?: number;
}

export interface AgentRun {
  readonly runId: string;
  readonly events: AsyncIterable<AgentEvent>;
  stop(): Promise<void>;
  waitForExit(timeoutMs: number): Promise<boolean>;
}
```

dsh 后端只允许在 `src/adapters/` 中依赖 dsh 接口，桥接层和会话层不得直接依赖 dsh。

## 5. CLI · Command line

当前命令：

- `dsh-lark-bot start`：前台启动桥接
- `dsh-lark-bot doctor`：运行本地诊断

后续将补充 `profile`、`ps`、`kill` 等进程与配置管理命令。
