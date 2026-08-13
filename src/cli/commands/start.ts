import { mkdir } from 'node:fs/promises';
import type { NormalizedMessage } from '@larksuite/channel';
import { DshAdapter } from '../../adapters/dsh/adapter.js';
import { ActiveRuns } from '../../bot/active-runs.js';
import { PendingQueue } from '../../bot/pending-queue.js';
import { startChannel } from '../../bridge/channel.js';
import { adaptLarkChannel } from '../../bridge/lark-channel.js';
import { runAgentBatch } from '../../bridge/run-flow.js';
import type { StreamingChannel } from '../../bridge/types.js';
import { resolveAppPaths } from '../../config/app-paths.js';
import { loadRuntimeEnv } from '../../config/env.js';
import { ConfigStore } from '../../config/profile-store.js';
import { log } from '../../core/logger.js';
import { SessionStore } from '../../session/store.js';
import { WorkspaceStore } from '../../workspace/store.js';
import type { StartOptions } from '../../cli.js';

const DEBOUNCE_MS = 600;

export async function runStart(options: StartOptions): Promise<void> {
  const env = loadRuntimeEnv({
    ...process.env,
    ...(options.workspace ? { DSH_LARK_WORKSPACE: options.workspace } : {}),
    ...(options.tenant ? { DSH_LARK_TENANT: options.tenant } : {}),
    ...(options.appId ? { DSH_LARK_APP_ID: options.appId } : {}),
    ...(options.appSecret ? { DSH_LARK_APP_SECRET: options.appSecret } : {}),
  });
  const paths = resolveAppPaths(env.home);
  const profileName = options.profile ?? 'default';
  const configStore = new ConfigStore(paths.configFile);
  await configStore.load();

  if (env.appId && env.appSecret) {
    const profileInput: Parameters<ConfigStore['saveProfile']>[1] = {
      tenant: env.tenant,
      appId: env.appId,
      appSecret: env.appSecret,
      model: env.model,
      stopGraceMs: env.runTimeoutMs,
    };
    if (env.workspace !== undefined) profileInput.workspace = env.workspace;
    await configStore.saveProfile(profileName, profileInput);
  }

  const profile = configStore.getProfile(profileName);
  if (!profile) {
    process.stderr.write(
      [
        '未找到可用配置。请先通过以下任一方式提供飞书应用凭据：',
        '',
        '  dsh-lark-bot start --app-id cli_xxx --app-secret <secret>',
        '  或设置 DSH_LARK_APP_ID / DSH_LARK_APP_SECRET',
        '',
        '后续版本将支持终端二维码自动创建 PersonalAgent 应用。',
      ].join('\n') + '\n',
    );
    process.exitCode = 1;
    return;
  }

  const defaultWorkspace =
    options.workspace ??
    profile.workspaces.default ??
    env.workspace ??
    paths.profilePath(profileName, 'workspace');
  await mkdir(defaultWorkspace, { recursive: true });

  const sessions = new SessionStore(paths.sessionsFile(profileName));
  const workspaces = new WorkspaceStore(paths.workspacesFile(profileName));
  await Promise.all([sessions.load(), workspaces.load()]);

  const adapterOptions: { command: string; args: string[]; stopGraceMs?: number } = {
    command: env.dshCommand,
    args: env.dshArgs,
  };
  if (profile.preferences.stopGraceMs !== undefined) {
    Object.assign(adapterOptions, { stopGraceMs: profile.preferences.stopGraceMs });
  }
  const adapter = new DshAdapter(adapterOptions);
  const activeRuns = new ActiveRuns();
  let streaming: StreamingChannel | undefined;

  const pending = new PendingQueue<NormalizedMessage>(DEBOUNCE_MS, async (scope, batch) => {
    if (!streaming) return;
    const first = batch[0];
    if (!first) return;
    pending.block(scope);
    try {
      const runInput: Parameters<typeof runAgentBatch>[0] = {
        scope,
        chatId: first.chatId,
        messages: batch.map((message) => message.content),
        adapter,
        sessions,
        workspaces,
        activeRuns,
        channel: streaming,
        defaultWorkspace,
        replyTo: first.messageId,
      };
      if (profile.preferences.model !== undefined) runInput.model = profile.preferences.model;
      if (profile.preferences.stopGraceMs !== undefined) {
        runInput.stopGraceMs = profile.preferences.stopGraceMs;
      }
      await runAgentBatch(runInput);
    } finally {
      pending.unblock(scope);
    }
  });

  const channelInput: Parameters<typeof startChannel>[0] = {
    appId: profile.accounts.appId,
    appSecret: profile.accounts.appSecret,
    tenant: profile.tenant,
    adapter,
    sessions,
    workspaces,
    activeRuns,
    pending,
    defaultWorkspace,
  };
  if (profile.preferences.model !== undefined) channelInput.model = profile.preferences.model;
  if (profile.preferences.stopGraceMs !== undefined) {
    channelInput.stopGraceMs = profile.preferences.stopGraceMs;
  }
  const bridge = await startChannel(channelInput);
  streaming = adaptLarkChannel(bridge.channel);

  log.info('cli', 'started', {
    profile: profileName,
    home: paths.root,
    tenant: profile.tenant,
    workspace: defaultWorkspace,
  });
  process.stdout.write(`dsh-lark-bot 已启动，profile=${profileName}\n`);

  await waitForShutdown();
  await bridge.disconnect();
  await Promise.all([sessions.flush(), workspaces.flush()]);
}

function waitForShutdown(): Promise<void> {
  return new Promise((resolve) => {
    const shutdown = (): void => {
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      resolve();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}
