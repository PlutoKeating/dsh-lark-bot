import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AgentAdapter } from '../../adapters/types.js';
import type { LarkChannel } from '@larksuite/channel';
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
import { IsolationStore } from '../../bot/isolation-store.js';
import { PlanApprovalRegistry } from '../../bot/plan-approvals.js';
import { PermissionPolicyStore } from '../../bot/permission-policy-store.js';
import {
  NotificationPreferenceStore,
  type NotificationPreference,
} from '../../bot/notification-preference-store.js';
import { ReplyPolicyStore } from '../../bot/reply-policy-store.js';
import { ExecutionModeStore } from '../../bot/execution-mode-store.js';
import { LanguagePolicyStore } from '../../bot/language-policy-store.js';
import { startChannel, type QueuedMessage } from '../../bridge/channel.js';
import { adaptLarkChannel } from '../../bridge/lark-channel.js';
import { runAgentBatch } from '../../bridge/run-flow.js';
import { attachRunCardAnchors, RunCardAnchors } from '../../bridge/run-card-anchors.js';
import { ScopeDirectory } from '../../bridge/scope-directory.js';
import { memberOwnerForScope } from '../../bridge/scope-isolation.js';
import type { StreamingChannel } from '../../bridge/types.js';
import { WebDshAdapter } from '../../adapters/dsh/web-adapter.js';
import { generateNotifyToken, NotifyServer } from '../../notify/server.js';
import { buildAskHandler } from '../../notify/ask-handler.js';
import { buildPlanHandler } from '../../notify/plan-handler.js';
import { buildApprovalHandler } from '../../notify/approval-handler.js';
import { buildFileHandler } from '../../notify/file-handler.js';
import { NotificationDispatcher } from '../../notify/notification-dispatcher.js';
import { ReplyDispatcher } from '../../bridge/reply-dispatcher.js';
import type { StartOptions } from '../../cli.js';
import { resolveAppPaths } from '../../config/app-paths.js';
import { AccessManager } from '../../config/access-manager.js';
import { loadRuntimeEnv } from '../../config/env.js';
import { ConfigStore } from '../../config/profile-store.js';
import { DEEPSEEK_PROVIDER, DshProviderManager } from '../../config/dsh-config.js';
import { log } from '../../core/logger.js';
import { onboardPersonalAgent } from '../../onboard/registration.js';
import { prepareAttachments } from '../../media/attachments.js';
import { SessionStore } from '../../session/store.js';
import { SessionProjectionStore } from '../../session/projection-store.js';
import { WebSessionProjectionSource } from '../../session/projection-protocol.js';
import { archiveScopeSlug, SessionArchive } from '../../session/archive.js';
import { GitWorktreeManager } from '../../workspace/git-worktree.js';
import { WorkspaceStore } from '../../workspace/store.js';
import { startHeartbeat } from '../../guardian/heartbeat.js';
import { currentVersion } from '../../upgrade/update-check.js';
import { bilingualMarkdown } from '../../card/i18n.js';
import { UpdateNotifier } from '../../upgrade/update-notifier.js';
import { BotFleetStore } from '../../bot/fleet-store.js';
import { BotHandoffGuard } from '../../bot/handoff-guard.js';
import { resolveDshHome } from '../../config/dsh-runtime.js';
import { homedir } from 'node:os';
import { JobLedger } from '../../bot/job-ledger.js';
import {
  claimJobDispatch,
  prepareDurableJobRecovery,
  persistJobTerminalAndNotify,
  recoverDurableJobs,
} from '../../bridge/job-recovery.js';
import {
  createDiagnosticBundle,
  knownSecretsFromEnv,
} from '../../diagnostics/bundle.js';
import { ServiceManager } from '../../service/manager.js';
import { SecretRequestRegistry } from '../../secret/registry.js';
import { SecretTargetManager } from '../../secret/targets.js';
import { buildSecretHandler } from '../../notify/secret-handler.js';
import { ownPackageInfo } from '../../adapters/dsh/own-package.js';
import {
  GuardianUpdateHandoff,
  guardianUpdateFailureHint,
} from '../../guardian/update-handoff.js';
import { ChannelUpdateController } from '../../upgrade/channel-update.js';

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
  /** Apply settings that are safe for subsequent work without stopping active runs. */
  updateSafeSettings(settings: BridgeEngineSafeSettings): void;
  stop(): Promise<void>;
}

export interface BridgeEngineSafeSettings {
  model: string;
  scopeConcurrency: number;
  notificationDefault: RuntimeEnv['notificationDefault'];
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
  const dshProfileName = process.env.DSH_LARK_DSH_PROFILE ??
    (profileName === 'default' ? env.guardianProfile : `dsh-lark-${profileName}`);
  const configStore = new ConfigStore(paths.configFile);
  const fleet = new BotFleetStore(paths.fleetFile);
  const handoffGuard = new BotHandoffGuard(paths.handoffFile);
  await Promise.all([configStore.load(), fleet.load()]);
  await fleet.ensure({
    name: profileName,
    bridgeProfile: profileName,
    dshProfile: dshProfileName,
    dshHome: resolveDshHome(homedir(), process.env),
  });

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
  const sessionProjections = new SessionProjectionStore(paths.sessionProjectionsFile(profileName));
  const jobs = new JobLedger(paths.jobsFile(profileName));
  const archiver = new SessionArchive(paths.archivesDir(profileName));
  const workspaces = new WorkspaceStore(paths.workspacesFile(profileName));
  const roleStore = new RoleStore(paths.profilePath(profileName, 'roles.json'));
  const scopeDirectory = new ScopeDirectory(paths.profilePath(profileName, 'scopes.json'));
  const isolationStore = new IsolationStore(paths.profilePath(profileName, 'isolation.json'));
  const permissionPolicies = new PermissionPolicyStore(paths.permissionPoliciesFile(profileName));
  const notificationPreferences = new NotificationPreferenceStore(paths.notificationPreferencesFile(profileName));
  const replyPolicies = new ReplyPolicyStore(paths.replyPoliciesFile(profileName));
  const executionModes = new ExecutionModeStore(paths.executionModesFile(profileName));
  const languagePolicies = new LanguagePolicyStore(paths.languagePoliciesFile(profileName));
  const updateHandoff = new GuardianUpdateHandoff({
    file: paths.profilePath(profileName, 'guardian', 'update.json'),
    packageName: ownPackageInfo().name,
    dshProfile: dshProfileName,
  });
  const channelUpdates = new ChannelUpdateController({ handoff: updateHandoff });
  const worktreeManager = new GitWorktreeManager({
    worktreesRoot: paths.profilePath(profileName, 'worktrees'),
  });
  await Promise.all([
    sessions.load(),
    sessionProjections.load(),
    jobs.load(),
    workspaces.load(),
    roleStore.load(),
    scopeDirectory.load(),
    isolationStore.load(),
    permissionPolicies.load(),
    notificationPreferences.load(),
    replyPolicies.load(),
    executionModes.load(),
    languagePolicies.load(),
  ]);
  process.env.DSH_LARK_REPLY_LANG = languagePolicies.get().plain;
  // Freeze the recovery set before the channel can deliver live events. A
  // message accepted after connect then belongs only to the live path and
  // cannot be pushed once more by the startup replay.
  const jobRecovery = await prepareDurableJobRecovery(jobs);
  // Schema 1 keyed a scope by its execution cwd, which could be a generated
  // worktree. Prefer the legacy worktree's verified owning repository: old
  // `/cd B` could update WorkspaceStore while still reusing A's scope-only
  // worktree. Keep the current pointer on B, but correctly bind that session
  // to A so each project can recover independently under schema 2.
  for (const scope of sessions.legacyScopeIds()) {
    const legacyCwd = sessions.legacyWorkspaceCwd(scope);
    const legacyBase = await worktreeManager.legacyWorkspaceBase(scope);
    const canonicalCwd = legacyBase ?? workspaces.cwdFor(scope) ?? defaultWorkspace;
    // Rebind archives before committing schema 2. If any archive I/O fails,
    // schema 1 remains durable and the whole idempotent migration retries on
    // the next boot rather than losing its only retry marker.
    if (legacyCwd !== undefined) {
      await archiver.rebindWorkspaceCwd(scope, legacyCwd, canonicalCwd);
    }
    sessions.adoptLegacyWorkspace(scope, canonicalCwd);
  }

  const adapter =
    options.adapter ??
    (await buildAgentAdapter(env, {
      stopGraceMs: activeProfile.preferences.stopGraceMs ?? env.stopGraceMs,
      model: activeProfile.preferences.model,
    }));
  if (profileName !== 'default' && fleet.get(profileName) && adapter.id === 'dsh-web') {
    await adapter.dispose?.();
    throw new Error(
      '多机器人实例不能共享 Web adapter 事件流；请将该实例配置为 sdk 或 acp。',
    );
  }
  if (adapter instanceof WebDshAdapter) {
    adapter.setPromptObserver(async ({ sessionId, rpcId, origin }) => {
      const binding = sessionProjections.get(origin.scope, origin.workspaceCwd);
      if (!binding || binding.sessionId !== sessionId) return;
      await sessionProjections.recordCorrelation(
        origin.scope,
        origin.workspaceCwd,
        sessionId,
        { rpcId, feishuMessageId: origin.messageId, createdAt: Date.now() },
      );
    });
  }
  const activeRuns = new ActiveRuns();
  const runPolicies = new RunPolicyStore();
  const concurrencyStore = new ConcurrencyStore();
  const retentionStore = new RetentionStore();
  const approvals = new ApprovalRegistry();
  const questions = new QuestionRegistry();
  const plans = new PlanApprovalRegistry();
  const densityStore = new DensityStore();
  const runCardAnchors = new RunCardAnchors();
  const models = new ModelStore();
  const wizardStore = new WizardStore();
  const dshConfig = new DshProviderManager({ env: process.env });
  const secretRequests = new SecretRequestRegistry(new SecretTargetManager({
    dsh: dshConfig, profiles: configStore, profileName,
  }));
  const accessManager = new AccessManager(configStore, profileName);
  const sessionActors = new Map<string, string>();
  let defaultModel = env.model;
  let liveSettingsModel: string | undefined;
  let defaultScopeConcurrency = env.scopeConcurrency;
  let defaultNotificationPreference = notificationPreferenceFor(env.notificationDefault);
  let streaming: StreamingChannel | undefined;
  let larkChannel: LarkChannel | undefined;
  const notificationDispatcher = new NotificationDispatcher({
    preferences: notificationPreferences,
    ...(defaultNotificationPreference
      ? { defaultPreference: { ...defaultNotificationPreference, events: [...defaultNotificationPreference.events] } }
      : {}),
    scopeDirectory,
    send: async (chatId, markdown, options) => {
      if (!streaming) throw new Error('bridge channel is not ready');
      await streaming.sendMarkdown(chatId, markdown, options);
    },
  });
  const replyDispatcher = new ReplyDispatcher({
    policies: replyPolicies,
    send: async (chatId, markdown, options) => {
      if (!streaming) throw new Error('bridge channel is not ready');
      await streaming.sendMarkdown(chatId, markdown, options);
    },
  });
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
          return streaming.sendCard(chatId, card, options);
        },
      },
    }),
    plan: buildPlanHandler({
      sessions,
      scopeDirectory,
      plans,
      channel: {
        sendMarkdown: async (chatId, markdown, options) => {
          if (!streaming) throw new Error('bridge channel is not ready');
          await streaming.sendMarkdown(chatId, markdown, options);
        },
        sendCard: async (chatId, card, options) => {
          if (!streaming) throw new Error('bridge channel is not ready');
          if (!streaming.sendCard) throw new Error('bridge channel does not support cards');
          return streaming.sendCard(chatId, card, options);
        },
        recallMessage: async (messageId: string) => {
          if (!streaming?.recallMessage) throw new Error('bridge channel does not support recall');
          await streaming.recallMessage(messageId);
        },
      },
    }),
    approval: buildApprovalHandler({
      sessions,
      scopeDirectory,
      approvals,
      permissionPolicies,
      onApprovalWaiting: (scope, toolName) => notificationDispatcher.scheduleApprovalReminder(scope, toolName),
      channel: {
        sendCard: async (chatId, card, options) => {
          if (!streaming) throw new Error('bridge channel is not ready');
          if (!streaming.sendCard) throw new Error('bridge channel does not support cards');
          return streaming.sendCard(chatId, card, options);
        },
        sendMarkdown: async (chatId, markdown, options) => {
          if (!streaming) throw new Error('bridge channel is not ready');
          await streaming.sendMarkdown(chatId, markdown, options);
        },
        recallMessage: async (messageId) => {
          if (!streaming?.recallMessage) throw new Error('bridge channel does not support recall');
          await streaming.recallMessage(messageId);
        },
      },
    }),
    file: buildFileHandler({
      sessions,
      scopeDirectory,
      allowedRoots: async (_sessionId, scope, workspace) => {
        const executionRoot = (await worktreeManager.ensure(scope, workspace)).cwd;
        return [
          workspace,
          executionRoot,
          join(paths.archivesDir(profileName), archiveScopeSlug(scope)),
          paths.logsDir(profileName),
        ];
      },
      channel: {
        sendFile: async (chatId, fileName, content, options) => {
          if (!streaming?.sendFile) throw new Error('bridge channel does not support file uploads');
          await streaming.sendFile(chatId, fileName, content, options);
        },
      },
    }),
    secret: buildSecretHandler({
      sessions,
      scopes: scopeDirectory,
      requests: secretRequests,
      actorForSession: (sessionId) => sessionActors.get(sessionId),
      isAdmin: (actor) => accessManager.isAdmin(actor),
      sendCard: async (chatId, card, options) => {
        if (!streaming?.sendCard) throw new Error('bridge channel does not support cards');
        return streaming.sendCard(chatId, card, options);
      },
    }),
  });
  process.env.DSH_LARK_NOTIFY_TOKEN = notifyToken;

  const pending = new PendingQueue<QueuedMessage>(
    DEBOUNCE_MS,
    async (scope, batch) => {
      if (!streaming) return;
      const first = batch[0];
      if (!first) return;
      let ledgerMessageIds: string[] = [];
      let ledgerState: 'completed' | 'failed' | 'interrupted' = 'failed';
      let ledgerError: string | undefined;
      let ledgerClaimed = false;
      try {
        // Merge only messages captured for the same workspace. Messages for a
        // different project keep their immutable snapshot and return to the
        // queue for the next run instead of being dropped or cross-routed.
        const selected = batch.filter((message) => message.workspaceCwd === first.workspaceCwd);
        ledgerMessageIds = selected.map((message) => message.messageId);
        for (const deferred of batch) {
          if (deferred.workspaceCwd !== first.workspaceCwd) pending.push(scope, deferred);
        }
        ledgerClaimed = await claimJobDispatch({
          jobs,
          messageIds: ledgerMessageIds,
          runId: `dispatch-${randomUUID()}`,
          first,
          channel: streaming,
        });
        if (!ledgerClaimed) return;
        const prepared = await Promise.all(selected.map(async (message) => ({
          message,
          attachments: await prepareAttachments(
            larkChannel,
            message,
            paths.mediaDir(profileName),
          ),
        })));
        const messages = prepared.flatMap(({ message, attachments }) => [
          message.content,
          ...attachments.textFileNotes,
        ]).filter(Boolean);
        const role = roleStore.roleForScope(scope);
        const resumedSessionId = sessions.resumeFor(scope, first.workspaceCwd);
        if (first.senderId && resumedSessionId) sessionActors.set(resumedSessionId, first.senderId);
        const collaborationPeers = await fleet.peersFor(profileName);
        const dshDefault = await dshConfig.defaultModelSelection().catch(() => undefined);
        const resolvedModel =
          models.get(scope) ??
          role?.model ??
          liveSettingsModel ??
          activeProfile.preferences.model ??
          (dshDefault ? `${dshDefault.provider}/${dshDefault.model}` : undefined) ??
          defaultModel;
        let modelRoute: Awaited<ReturnType<DshProviderManager['resolveRuntimeModelRoute']>>;
        if (resolvedModel) {
          try {
            modelRoute = await dshConfig.resolveRuntimeModelRoute(resolvedModel);
          } catch (error) {
            // A settings read/parse failure is a different problem than a
            // missing model; report it instead of a misleading "not found".
            await streaming.sendMarkdown(
              first.chatId,
              bilingualMarkdown(
                `⚠️ 读取或准备 dsh 运行时配置失败，无法解析模型 \`${resolvedModel}\` 的 provider 路由：${error instanceof Error ? error.message : String(error)}`,
                `⚠️ Failed to read or prepare dsh runtime configuration, so the provider route for model \`${resolvedModel}\` could not be resolved: ${error instanceof Error ? error.message : String(error)}`,
              ),
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
            bilingualMarkdown(
              `⚠️ 模型 \`${resolvedModel}\` 未在任何已配置 provider 中找到。可用 \`/model\` 查看列表，或用 \`/model add|remove\` 管理。`,
              `⚠️ Model \`${resolvedModel}\` was not found in any configured provider. Use \`/model\` to list models or \`/model add|remove\` to manage them.`,
            ),
            { replyTo: first.messageId },
          );
          return;
        }
        // Heal the common "credential named after the provider id" setup
        // (`/key set kingapi …`) where the provider lacks an apiKeyEnv link;
        // otherwise the runtime would send unauthenticated requests.
        if (modelRoute && modelRoute.provider !== DEEPSEEK_PROVIDER) {
          await dshConfig.linkCredentialRefIfMissing(modelRoute.provider).catch(() => undefined);
        }
        const scopeOwner = memberOwnerForScope(scope, first.chatId);
        const runInput: Parameters<typeof runAgentBatch>[0] = {
          scope,
          chatId: first.chatId,
          messages,
          adapter,
          sessions,
          workspaces,
          workspaceCwd: first.workspaceCwd,
          workspaceManager: worktreeManager,
          activeRuns,
          runPolicies,
          archiver,
          ...(role === undefined ? {} : { role }),
          approvals,
          permissionPolicies,
          onApprovalWaiting: (approvalScope, toolName) => notificationDispatcher.scheduleApprovalReminder(approvalScope, toolName),
          questions,
          plans,
          densityStore,
          channel: streaming,
          runCardAnchors,
          defaultWorkspace,
          replyTo: first.messageId,
          deliverFinalReply: (replyScope, chatId, markdown, options) => replyDispatcher.deliver(replyScope, chatId, markdown, options),
          ...(scopeOwner ? { scopeOwner } : {}),
          ...(collaborationPeers.length > 0 ? { collaborationPeers } : {}),
          runTimeoutMs: activeProfile.preferences.runTimeoutMs ?? env.runTimeoutMs,
          maxConcurrency: concurrencyStore.get(scope) ?? defaultScopeConcurrency,
          retention: retentionStore.get(scope) ?? env.retentionMsgs,
          images: prepared.flatMap(({ attachments }) => attachments.imagePaths),
          ...(modelRoute?.provider === undefined
            ? {}
            : { provider: modelRoute.provider }),
          model: modelRoute?.model ?? resolvedModel,
          executionMode: executionModes.get(scope),
          channelContext: {
            channel: 'dsh-lark-bot',
            tenant: activeProfile.tenant,
            chatType: first.chatMode ?? first.chatType,
            scope,
            bridgeProfile: profileName,
            adapter: adapter.id,
            tools: ['lark_notify', 'lark_send_file', 'lark_ask_user', 'lark_request_plan_approval', 'lark_request_secret'],
            language: languagePolicies.get(),
            secretCollection: 'available',
          },
          onCheckpoint: (checkpoint) => {
            if (first.senderId && checkpoint.nativeSessionId) sessionActors.set(checkpoint.nativeSessionId, first.senderId);
            return jobs.checkpoint(
              ledgerMessageIds,
              {
                stage: checkpoint.stage,
                ...(checkpoint.detail ? { detail: checkpoint.detail } : {}),
                ...(checkpoint.nativeSessionId
                  ? { nativeSessionId: checkpoint.nativeSessionId }
                  : {}),
              },
              checkpoint.runId,
            );
          },
        };
        if (activeProfile.preferences.stopGraceMs !== undefined) {
          runInput.stopGraceMs = activeProfile.preferences.stopGraceMs;
        }
        const outcome = await runAgentBatch(runInput);
        ledgerState = outcome === 'completed'
          ? 'completed'
          : outcome === 'interrupted'
            ? 'interrupted'
            : 'failed';
      } catch (error) {
        ledgerError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        if (ledgerClaimed) {
          await persistJobTerminalAndNotify({
            jobs,
            messageIds: ledgerMessageIds,
            state: ledgerState,
            ...(ledgerError ? { error: ledgerError } : {}),
            first,
            channel: streaming,
            scope,
            notify: (notificationScope, event) => notificationDispatcher.notify(notificationScope, event),
          });
        }
      }
    },
    (scope) => concurrencyStore.get(scope) ?? defaultScopeConcurrency,
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
    defaultScopeConcurrency,
    retentionStore,
    roleStore,
    isolationStore,
    scopeDirectory,
    archiver,
    defaultRetention: env.retentionMsgs,
    archiveMax: env.archiveMax,
    archiveMaxAgeDays: env.archiveMaxAgeDays,
    approvals,
    permissionPolicies,
    notificationPreferences,
    ...(defaultNotificationPreference
      ? { defaultNotificationPreference: { ...defaultNotificationPreference, events: [...defaultNotificationPreference.events] } }
      : {}),
    replyPolicies,
    executionModes,
    languagePolicies,
    questions,
    plans,
    densityStore,
    models,
    wizardStore,
    dshConfig,
    secretRequests,
    defaultRunTimeoutMs: activeProfile.preferences.runTimeoutMs ?? env.runTimeoutMs,
    defaultModel: effectiveProfileModel(liveSettingsModel, activeProfile.preferences.model, defaultModel),
    resolveDefaultModel: async (scope: string) => {
      const higherPriority = roleStore.roleForScope(scope)?.model ?? liveSettingsModel ?? activeProfile.preferences.model;
      if (higherPriority) return higherPriority;
      const dshDefault = await dshConfig.defaultModelSelection().catch(() => undefined);
      return dshDefault
        ? `${dshDefault.provider}/${dshDefault.model}`
        : defaultModel;
    },
    setDefaultModelPreference: async (model: string) => {
      await configStore.saveProfile(profileName, {
        tenant: activeProfile.tenant,
        appId: activeProfile.accounts.appId,
        appSecret: activeProfile.accounts.appSecret,
        model,
      });
    },
    accessManager,
    pending,
    defaultWorkspace,
    accessDefaultDeny: env.accessDefaultDeny,
    eventFreshnessMs: env.eventFreshnessMs,
    groupNoAt: env.groupNoAt,
    groupPollMs: env.groupPollMs,
    isTrustedBot: (openId) => fleet.isTrustedPeer(openId, profileName),
    botHandoffMax: env.botHandoffMax,
    handoffGuard,
    channelUpdates,
    jobs,
    ...(env.sessionProjectionEnabled && adapter instanceof WebDshAdapter
      ? {
          sessionProjectionStore: sessionProjections,
          sessionProjectionSource: new WebSessionProjectionSource(adapter),
          sessionProjectionLimits: {
            backfillMessages: env.sessionBackfillMessages,
            backfillBytes: env.sessionBackfillBytes,
            historyPageMessages: Math.max(env.sessionBackfillMessages, 100),
            streamUpdateMs: env.sessionStreamUpdateMs,
            reconnectMs: 5_000,
          },
        }
      : {}),
    createDiagnosticBundle: async (request) => {
      const service = new ServiceManager({
        profile: dshProfileName,
        env: process.env,
        paths,
        version: currentVersion(),
      });
      const serviceStatus = await service.status().catch(() => undefined);
      return createDiagnosticBundle({
        version: currentVersion(),
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
        profile: profileName,
        dshProfile: dshProfileName,
        tenant: activeProfile.tenant,
        adapter: adapter.id,
        config: {
          credentialsConfigured: Boolean(activeProfile.accounts.appId && activeProfile.accounts.appSecret),
          allowedUsers: activeProfile.access.allowedUsers.length,
          allowedChats: activeProfile.access.allowedChats.length,
          admins: activeProfile.access.admins.length,
          groupNoAt: env.groupNoAt,
          sessionProjectionEnabled: env.sessionProjectionEnabled && adapter instanceof WebDshAdapter,
          projectionBindings: sessionProjections.list().length,
        },
        request,
        ...(serviceStatus
          ? {
              service: {
                installed: serviceStatus.installed,
                state: serviceStatus.state,
                platform: serviceStatus.platform,
                autostartEnabled: serviceStatus.autostartEnabled,
                detail: serviceStatus.detail,
              },
            }
          : {}),
        runtimeLogs: log.recent(200),
        knownSecrets: [
          activeProfile.accounts.appSecret,
          ...knownSecretsFromEnv(process.env),
        ],
        homeDir: homedir(),
      });
    },
    allowedUsers: activeProfile.access.allowedUsers,
    allowedChats: activeProfile.access.allowedChats,
    ...(options.createChannel ? { createChannel: options.createChannel } : {}),
    channelPingTimeoutSec: env.channelPingTimeoutSec,
    channelKeepalive: env.channelKeepalive,
    channelKeepaliveMs: env.channelKeepaliveMs,
    channelHealthPollMs: env.channelHealthPollMs,
    onChannelUnrecoverable: (error) => {
      // Last-resort self-heal (issue #108): the persistent channel could not
      // be restored by the SDK's ping timeout or the app-level keepalive, so
      // the engine cannot keep publishing a healthy heartbeat. Exit non-zero
      // so the managed service / guardian restarts it with a fresh WebSocket
      // generation. The guardian's takeover only engages once the engine
      // stops writing a fresh heartbeat, so no double-consumer results.
      log.fail('engine', 'channel-unrecoverable', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exitCode = 1;
      setTimeout(() => process.exit(1), 300);
    },
  };
  if (activeProfile.preferences.stopGraceMs !== undefined) {
    channelInput.stopGraceMs = activeProfile.preferences.stopGraceMs;
  }
  const bridge = await startChannel(channelInput);
  if (typeof bridge.channel.getBotIdentity === 'function') {
    const identity = bridge.channel.getBotIdentity();
    try {
      await fleet.registerIdentity(profileName, {
        openId: identity.openId,
        ...(identity.name ? { name: identity.name } : {}),
      });
    } catch (error) {
      await bridge.disconnect();
      await adapter.dispose?.();
      throw error;
    }
  } else {
    log.warn('fleet', 'identity-unavailable', {
      profile: profileName,
      error: 'channel does not expose getBotIdentity',
    });
  }
  streaming = attachRunCardAnchors(adaptLarkChannel(bridge.channel), runCardAnchors);
  larkChannel = bridge.channel;
  const deliverUpdateResult = async (): Promise<void> => {
    await updateHandoff.deliverResult(async (state) => {
      if (!streaming) throw new Error('channel is not ready');
      const failureHint = guardianUpdateFailureHint(state.errorCode);
      const markdown = state.status === 'succeeded'
        ? bilingualMarkdown(
            `✅ dsh-lark-bot 已更新到 \`${state.targetVersion}\`，机器人已完成重载。`,
            `✅ dsh-lark-bot was updated to \`${state.targetVersion}\` and reloaded.`,
          )
        : bilingualMarkdown(
            `⚠️ dsh-lark-bot 更新到 \`${state.targetVersion}\` 失败。${failureHint.zh}`,
            `⚠️ Failed to update dsh-lark-bot to \`${state.targetVersion}\`. ${failureHint.en}`,
          );
      await streaming.sendMarkdown(state.route.chatId, markdown, {
        ...(state.route.threadId ? { threadId: state.route.threadId } : {}),
      });
      if (state.status === 'failed') {
        log.warn('upgrade', 'channel-update-failed', {
          id: state.id,
          targetVersion: state.targetVersion,
          error: state.error,
        });
      }
    });
  };
  void deliverUpdateResult().catch((error) => log.fail('upgrade', error, { step: 'deliver-result' }));
  const updateResultTimer = setInterval(() => {
    void deliverUpdateResult().catch((error) => log.fail('upgrade', error, { step: 'deliver-result' }));
  }, 2_000);
  updateResultTimer.unref?.();
  await recoverDurableJobs(jobRecovery, jobs, pending, streaming);
  await notifyServer.start();
  process.env.DSH_LARK_NOTIFY_URL = notifyServer.url ?? '';
  process.env.DSH_LARK_ASK_URL = notifyServer.askUrl ?? '';
  process.env.DSH_LARK_PLAN_URL = notifyServer.planUrl ?? '';
  process.env.DSH_LARK_APPROVAL_URL = notifyServer.approvalUrl ?? '';
  process.env.DSH_LARK_FILE_URL = notifyServer.fileUrl ?? '';
  process.env.DSH_LARK_SECRET_URL = notifyServer.secretUrl ?? '';
  const heartbeat = startHeartbeat(
    paths.profilePath(profileName, 'guardian', 'heartbeat.json'),
    process.pid,
    env.heartbeatMs,
    () => bridge.channelHealth?.(),
  );
  // Version equality only proves that replacement files were loaded. Mark the
  // handoff successful after the channel, callback server, and heartbeat are
  // all ready so a bridge that fails during startup cannot report success.
  await updateHandoff.reconcile(currentVersion());
  void deliverUpdateResult().catch((error) => log.fail('upgrade', error, { step: 'deliver-result' }));
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
    updateSafeSettings: (settings) => {
      defaultModel = settings.model;
      liveSettingsModel = settings.model;
      defaultScopeConcurrency = settings.scopeConcurrency;
      defaultNotificationPreference = notificationPreferenceFor(settings.notificationDefault);
      notificationDispatcher.setDefaultPreference(defaultNotificationPreference);
      channelInput.defaultScopeConcurrency = defaultScopeConcurrency;
      channelInput.defaultModel = effectiveProfileModel(
        liveSettingsModel,
        activeProfile.preferences.model,
        defaultModel,
      );
      if (defaultNotificationPreference) {
        channelInput.defaultNotificationPreference = defaultNotificationPreference;
      } else {
        delete channelInput.defaultNotificationPreference;
      }
    },
    stop: async () => {
      if (stopped) return;
      stopped = true;
      updateNotifier.stop();
      clearInterval(updateResultTimer);
      heartbeat.stop();
      await notifyServer.stop();
      await bridge.disconnect();
      await adapter.dispose?.();
      await Promise.all([
        sessions.flush(),
        sessionProjections.flush(),
        workspaces.flush(),
        roleStore.flush(),
        scopeDirectory.flush(),
        isolationStore.flush(),
        permissionPolicies.flush(),
        notificationPreferences.flush(),
        replyPolicies.flush(),
        executionModes.flush(),
        jobs.flush(),
      ]);
    },
  };
}

/** Web's live composition layer overrides the profile snapshot captured at boot. */
export function effectiveProfileModel(
  liveSettingsModel: string | undefined,
  profileModel: string | undefined,
  environmentModel: string,
): string {
  return liveSettingsModel ?? profileModel ?? environmentModel;
}

function notificationPreferenceFor(
  value: RuntimeEnv['notificationDefault'],
): NotificationPreference | undefined {
  if (value === 'off') return undefined;
  return {
    events: value === 'all'
      ? ['completed', 'failed', 'approval']
      : ['completed', 'failed'],
    mentionUserIds: [],
    approvalReminderMs: 10 * 60_000,
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
