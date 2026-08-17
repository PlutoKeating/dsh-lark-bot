import { mkdir } from 'node:fs/promises';
import type { AgentAdapter } from '../../adapters/types.js';
import type { LarkChannel, NormalizedMessage } from '@larksuite/channel';
import type { RuntimeEnv } from '../../config/env.js';
import { buildAgentAdapter } from '../../adapters/index.js';
import { ActiveRuns } from '../../bot/active-runs.js';
import { ApprovalRegistry } from '../../bot/approvals.js';
import { ConcurrencyStore } from '../../bot/concurrency-store.js';
import { DensityStore } from '../../bot/density-store.js';
import { ModelStore } from '../../bot/model-store.js';
import { WizardStore } from '../../bot/wizard-store.js';
import { PendingQueue } from '../../bot/pending-queue.js';
import { QuestionRegistry } from '../../bot/questions.js';
import { RetentionStore } from '../../bot/retention-store.js';
import { RoleStore } from '../../bot/role-store.js';
import { RunPolicyStore } from '../../bot/run-policy.js';
import { startChannel } from '../../bridge/channel.js';
import { adaptLarkChannel } from '../../bridge/lark-channel.js';
import { runAgentBatch } from '../../bridge/run-flow.js';
import { ScopeDirectory } from '../../bridge/scope-directory.js';
import type { StreamingChannel } from '../../bridge/types.js';
import { startWebSessionWatcher, type WebMuxProvider, type WebSessionWatcher } from '../../adapters/dsh/web-watcher.js';
import { generateNotifyToken, NotifyServer } from '../../notify/server.js';
import { buildAskHandler } from '../../notify/ask-handler.js';
import type { StartOptions } from '../../cli.js';
import { resolveAppPaths } from '../../config/app-paths.js';
import { AccessManager } from '../../config/access-manager.js';
import { loadRuntimeEnv } from '../../config/env.js';
import { ConfigStore } from '../../config/profile-store.js';
import { DshProviderManager } from '../../config/dsh-config.js';
import { log } from '../../core/logger.js';
import { onboardPersonalAgent } from '../../onboard/registration.js';
import { prepareAttachments } from '../../media/attachments.js';
import { SessionStore } from '../../session/store.js';
import { SessionArchive } from '../../session/archive.js';
import { GitWorktreeManager } from '../../workspace/git-worktree.js';
import { WorkspaceStore } from '../../workspace/store.js';
import { startHeartbeat } from '../../guardian/heartbeat.js';
import { currentVersion } from '../../upgrade/update-check.js';
import { UpdateNotifier } from '../../upgrade/update-notifier.js';

const DEBOUNCE_MS = 600;

export interface BridgeEngineStatus {
  state: 'running' | 'stopped';
  profile: string;
  home: string;
  adapterId: string;
  startedAt: string | undefined;
  workspace: string | undefined;
  notifyUrl: string | undefined;
}

export interface BridgeEngine {
  readonly profile: string;
  readonly home: string;
  status(): BridgeEngineStatus;
  stop(): Promise<void>;
}

export interface BridgeEngineOptions {
  env: RuntimeEnv;
  profileName: string;
  /** Allow first-run QR onboarding when no credentials exist. */
  allowOnboarding: boolean;
  /** Injectable channel factory (tests / host integration). */
  createChannel?: Parameters<typeof startChannel>[0]['createChannel'];
  /** Injectable adapter (tests); otherwise built from env. */
  adapter?: AgentAdapter;
}

export interface EnsureProfileOptions {
  env: RuntimeEnv;
  profileName: string;
  allowOnboarding: boolean;
}

export async function ensureBotProfile(
  store: ConfigStore,
  options: EnsureProfileOptions,
): Promise<boolean> {
  const { env, profileName } = options;
  if (env.appId && env.appSecret) {
    const profileInput: Parameters<ConfigStore['saveProfile']>[1] = {
      tenant: env.tenant,
      appId: env.appId,
      appSecret: env.appSecret,
      model: env.model,
      stopGraceMs: env.stopGraceMs,
      runTimeoutMs: env.runTimeoutMs,
    };
    if (env.workspace !== undefined) profileInput.workspace = env.workspace;
    await store.saveProfile(profileName, profileInput);
  }

  if (store.getProfile(profileName)) return true;

  if (!options.allowOnboarding) {
    throw new Error('未检测到飞书 / Lark 应用凭据，且未允许扫码绑定。');
  }

  try {
    const created = await onboardPersonalAgent();
    const onboardingProfile: Parameters<ConfigStore['saveProfile']>[1] = {
      tenant: created.tenant,
      appId: created.appId,
      appSecret: created.appSecret,
      model: env.model,
      stopGraceMs: env.stopGraceMs,
      runTimeoutMs: env.runTimeoutMs,
    };
    if (created.operatorOpenId !== undefined) {
      onboardingProfile.operatorOpenId = created.operatorOpenId;
    }
    if (env.workspace !== undefined) onboardingProfile.workspace = env.workspace;
    await store.saveProfile(profileName, onboardingProfile);
    return true;
  } catch (error) {
    log.fail('onboarding', error);
    throw new Error(`扫码创建应用失败：${errorMessage(error)}`);
  }
}

function mergeStartEnv(options: StartOptions): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(options.workspace ? { DSH_LARK_WORKSPACE: options.workspace } : {}),
    ...(options.tenant ? { DSH_LARK_TENANT: options.tenant } : {}),
    ...(options.appId ? { DSH_LARK_APP_ID: options.appId } : {}),
    ...(options.appSecret ? { DSH_LARK_APP_SECRET: options.appSecret } : {}),
  };
}

/**
 * Start the bridge engine. Runs the full Feishu channel pipeline (stores,
 * adapter, card queue, notify server) and returns a handle that can be
 * stopped. No process-level signal handling: the CLI wrapper owns signals,
 * and the dsh bundle plugin owns lifecycle via the cordis context.
 */
export async function startBridgeEngine(
  options: BridgeEngineOptions,
): Promise<BridgeEngine> {
  const env = options.env;
  const paths = resolveAppPaths(env.home);
  const profileName = options.profileName;
  const configStore = new ConfigStore(paths.configFile);
  await configStore.load();

  const ready = await ensureBotProfile(configStore, {
    env,
    profileName,
    allowOnboarding: options.allowOnboarding,
  });
  if (!ready) {
    throw new Error('bot profile 未就绪。');
  }
  const activeProfile = configStore.getProfile(profileName);
  if (!activeProfile) {
    throw new Error('本地配置读取失败，请检查后重试。');
  }

  const defaultWorkspace =
    activeProfile.workspaces.default ?? env.workspace ?? paths.profilePath(profileName, 'workspace');
  await mkdir(defaultWorkspace, { recursive: true });

  const sessions = new SessionStore(paths.sessionsFile(profileName));
  const archiver = new SessionArchive(paths.archivesDir(profileName));
  const workspaces = new WorkspaceStore(paths.workspacesFile(profileName));
  const roleStore = new RoleStore(paths.profilePath(profileName, 'roles.json'));
  const scopeDirectory = new ScopeDirectory(paths.profilePath(profileName, 'scopes.json'));
  const worktreeManager = new GitWorktreeManager({
    worktreesRoot: paths.profilePath(profileName, 'worktrees'),
  });
  await Promise.all([
    sessions.load(),
    workspaces.load(),
    roleStore.load(),
    scopeDirectory.load(),
  ]);

  const adapter =
    options.adapter ??
    (await buildAgentAdapter(env, {
      stopGraceMs: activeProfile.preferences.stopGraceMs ?? env.stopGraceMs,
      model: activeProfile.preferences.model,
    }));
  const activeRuns = new ActiveRuns();
  const runPolicies = new RunPolicyStore();
  const concurrencyStore = new ConcurrencyStore();
  const retentionStore = new RetentionStore();
  const approvals = new ApprovalRegistry();
  const questions = new QuestionRegistry();
  const densityStore = new DensityStore();
  const models = new ModelStore();
  const wizardStore = new WizardStore();
  const dshConfig = new DshProviderManager({ env: process.env });
  let streaming: StreamingChannel | undefined;
  let larkChannel: LarkChannel | undefined;
  const notifyToken = generateNotifyToken();
  const notifyServer = new NotifyServer({
    token: notifyToken,
    resolve: (message) => {
      if (message.scope) {
        return scopeDirectory.resolve(message.scope);
      }
      if (message.chatId) {
        return scopeDirectory.resolveChat(message.chatId);
      }
      return undefined;
    },
    send: async (destination, payload) => {
      if (!streaming) throw new Error('bridge channel is not ready');
      await streaming.sendMarkdown(destination.chatId, payload.text, {
        ...(destination.threadId ? { threadId: destination.threadId } : {}),
        ...(payload.mentions ? { mentions: payload.mentions } : {}),
      });
    },
    ask: buildAskHandler({
      sessions,
      scopeDirectory,
      questions,
      channel: {
        sendCard: async (chatId, card, options) => {
          if (!streaming) throw new Error('bridge channel is not ready');
          if (!streaming.sendCard) throw new Error('bridge channel does not support cards');
          await streaming.sendCard(chatId, card, options);
        },
      },
    }),
  });
  process.env.DSH_LARK_NOTIFY_TOKEN = notifyToken;

  const pending = new PendingQueue<NormalizedMessage>(
    DEBOUNCE_MS,
    async (scope, batch) => {
      if (!streaming) return;
      const first = batch[0];
      if (!first) return;
      pending.block(scope);
      try {
        const attachments = await prepareAttachments(
          larkChannel,
          first,
          paths.mediaDir(profileName),
        );
        const messages = [
          first.content,
          ...attachments.textFileNotes,
        ].filter(Boolean);
        const role = roleStore.roleForScope(scope);
        const resolvedModel =
          models.get(scope) ??
          role?.model ??
          activeProfile.preferences.model ??
          (await dshConfig.defaultModel().catch(() => undefined)) ??
          env.model;
        let modelRoute: Awaited<ReturnType<DshProviderManager['resolveModelRoute']>>;
        if (resolvedModel) {
          try {
            modelRoute = await dshConfig.resolveModelRoute(resolvedModel);
          } catch (error) {
            // A settings read/parse failure is a different problem than a
            // missing model; report it instead of a misleading "not found".
            await streaming.sendMarkdown(
              first.chatId,
              `⚠️ 读取 dsh 配置失败，无法解析模型 \`${resolvedModel}\` 的 provider 路由：${error instanceof Error ? error.message : String(error)}`,
              { replyTo: first.messageId },
            );
            return;
          }
        }
        if (resolvedModel && !modelRoute) {
          // Surface a clear configuration error instead of letting the dsh
          // runtime fail with an opaque provider/model mismatch.
          await streaming.sendMarkdown(
            first.chatId,
            `⚠️ 模型 \`${resolvedModel}\` 未在任何已配置 provider 中找到。可用 \`/model\` 查看列表，或用 \`/model add|remove\` 管理。`,
            { replyTo: first.messageId },
          );
          return;
        }
        const runInput: Parameters<typeof runAgentBatch>[0] = {
          scope,
          chatId: first.chatId,
          messages,
          adapter,
          sessions,
          workspaces,
          workspaceManager: worktreeManager,
          activeRuns,
          runPolicies,
          archiver,
          ...(role === undefined ? {} : { role }),
          approvals,
          questions,
          densityStore,
          channel: streaming,
          defaultWorkspace,
          replyTo: first.messageId,
          runTimeoutMs: activeProfile.preferences.runTimeoutMs ?? env.runTimeoutMs,
          maxConcurrency: concurrencyStore.get(scope) ?? env.scopeConcurrency,
          retention: retentionStore.get(scope) ?? env.retentionMsgs,
          images: attachments.imagePaths,
          ...(modelRoute?.provider === undefined
            ? {}
            : { provider: modelRoute.provider }),
          model: resolvedModel,
        };
        if (activeProfile.preferences.stopGraceMs !== undefined) {
          runInput.stopGraceMs = activeProfile.preferences.stopGraceMs;
        }
        await runAgentBatch(runInput);
      } finally {
        pending.unblock(scope);
      }
    },
    (scope) => concurrencyStore.get(scope) ?? env.scopeConcurrency,
  );

  const channelInput: Parameters<typeof startChannel>[0] = {
    appId: activeProfile.accounts.appId,
    appSecret: activeProfile.accounts.appSecret,
    tenant: activeProfile.tenant,
    adapter,
    sessions,
    workspaces,
    activeRuns,
    runPolicies,
    concurrencyStore,
    defaultScopeConcurrency: env.scopeConcurrency,
    retentionStore,
    roleStore,
    scopeDirectory,
    archiver,
    defaultRetention: env.retentionMsgs,
    archiveMax: env.archiveMax,
    archiveMaxAgeDays: env.archiveMaxAgeDays,
    approvals,
    questions,
    densityStore,
    models,
    wizardStore,
    dshConfig,
    defaultRunTimeoutMs: activeProfile.preferences.runTimeoutMs ?? env.runTimeoutMs,
    defaultModel: activeProfile.preferences.model ?? env.model,
    accessManager: new AccessManager(configStore, profileName),
    pending,
    defaultWorkspace,
    accessDefaultDeny: env.accessDefaultDeny,
    eventFreshnessMs: env.eventFreshnessMs,
    allowedUsers: activeProfile.access.allowedUsers,
    allowedChats: activeProfile.access.allowedChats,
    ...(options.createChannel ? { createChannel: options.createChannel } : {}),
  };
  if (activeProfile.preferences.stopGraceMs !== undefined) {
    channelInput.stopGraceMs = activeProfile.preferences.stopGraceMs;
  }
  const bridge = await startChannel(channelInput);
  streaming = adaptLarkChannel(bridge.channel);
  larkChannel = bridge.channel;
  // In `web` adapter mode, watch web-GUI turn completions: push them to Feishu
  // and auto-switch the chat's session mapping (single writer = web agent).
  let webWatcher: WebSessionWatcher | undefined;
  if (adapter.id === 'dsh-web' && env.webPush) {
    webWatcher = startWebSessionWatcher({
      adapter: adapter as unknown as WebMuxProvider,
      channel: streaming,
      sessions,
      workspaces,
      scopeDirectory,
    });
    log.info('cli', 'web-watcher-started', {});
  }
  await notifyServer.start();
  process.env.DSH_LARK_NOTIFY_URL = notifyServer.url ?? '';
  process.env.DSH_LARK_ASK_URL = notifyServer.askUrl ?? '';
  const heartbeat = startHeartbeat(
    paths.profilePath(profileName, 'guardian', 'heartbeat.json'),
    process.pid,
    env.heartbeatMs,
  );
  // Periodic new-version detection (issue #15): logs by default; pushes a
  // Feishu notification when DSH_LARK_UPGRADE_NOTIFY=1 and a target chat is
  // configured.
  const updateNotifier = new UpdateNotifier({
    current: currentVersion(),
    notify: env.upgradeNotify,
    notifyChat: env.upgradeNotifyChat,
    intervalMs: env.upgradeCheckIntervalMs,
    send: async (chatId, markdown) => {
      if (!streaming) return;
      await streaming.sendMarkdown(chatId, markdown);
    },
    log: {
      warn: (category, event, fields) =>
        log.warn(category, event, fields as Record<string, unknown>),
    },
  });
  updateNotifier.start();

  const startedAt = new Date().toISOString();
  log.info('cli', 'started', {
    profile: profileName,
    home: paths.root,
    tenant: activeProfile.tenant,
    workspace: defaultWorkspace,
    mode: 'engine',
  });

  let stopped = false;
  return {
    profile: profileName,
    home: paths.root,
    status: () => ({
      state: stopped ? 'stopped' : 'running',
      profile: profileName,
      home: paths.root,
      adapterId: adapter.id,
      startedAt,
      workspace: defaultWorkspace,
      notifyUrl: notifyServer.url,
    }),
    stop: async () => {
      if (stopped) return;
      stopped = true;
      webWatcher?.close();
      updateNotifier.stop();
      heartbeat.stop();
      await notifyServer.stop();
      await bridge.disconnect();
      await adapter.dispose?.();
      await Promise.all([
        sessions.flush(),
        workspaces.flush(),
        roleStore.flush(),
        scopeDirectory.flush(),
      ]);
    },
  };
}

export async function runBot(options: StartOptions): Promise<void> {
  const env = loadRuntimeEnv(mergeStartEnv(options));
  const profileName = options.profile ?? 'default';
  const engine = await startBridgeEngine({
    env,
    profileName,
    allowOnboarding: false,
  });
  process.stdout.write(`dsh-lark-bot 已启动，profile=${profileName}\n`);
  await waitForShutdown();
  await engine.stop();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
