import { mkdir } from 'node:fs/promises';
import type { LarkChannel, NormalizedMessage } from '@larksuite/channel';
import type { RuntimeEnv } from '../../config/env.js';
import { buildAgentAdapter } from '../../adapters/index.js';
import { ActiveRuns } from '../../bot/active-runs.js';
import { ApprovalRegistry } from '../../bot/approvals.js';
import { ConcurrencyStore } from '../../bot/concurrency-store.js';
import { DensityStore } from '../../bot/density-store.js';
import { ModelStore } from '../../bot/model-store.js';
import { PendingQueue } from '../../bot/pending-queue.js';
import { QuestionRegistry } from '../../bot/questions.js';
import { RetentionStore } from '../../bot/retention-store.js';
import { RoleStore } from '../../bot/role-store.js';
import { RunPolicyStore } from '../../bot/run-policy.js';
import { startChannel } from '../../bridge/channel.js';
import { adaptLarkChannel } from '../../bridge/lark-channel.js';
import { runAgentBatch } from '../../bridge/run-flow.js';
import type { StreamingChannel } from '../../bridge/types.js';
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

const DEBOUNCE_MS = 600;

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
    process.stderr.write(
      '未检测到飞书 / Lark 应用凭据。请先在终端运行 `dsh-lark-bot start` 完成扫码绑定。\n',
    );
    return false;
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
    process.stderr.write('扫码创建应用失败，未写入本地配置。\n');
    process.exitCode = 1;
    return false;
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

export async function runBot(options: StartOptions): Promise<void> {
  const env = loadRuntimeEnv(mergeStartEnv(options));
  const paths = resolveAppPaths(env.home);
  const profileName = options.profile ?? 'default';
  const configStore = new ConfigStore(paths.configFile);
  await configStore.load();

  const ready = await ensureBotProfile(configStore, {
    env,
    profileName,
    allowOnboarding: false,
  });
  if (!ready) {
    process.exitCode = 1;
    return;
  }
  const activeProfile = configStore.getProfile(profileName);
  if (!activeProfile) {
    process.stderr.write('本地配置读取失败，请检查后重试。\n');
    process.exitCode = 1;
    return;
  }

  const defaultWorkspace =
    options.workspace ??
    activeProfile.workspaces.default ??
    env.workspace ??
    paths.profilePath(profileName, 'workspace');
  await mkdir(defaultWorkspace, { recursive: true });

  const sessions = new SessionStore(paths.sessionsFile(profileName));
  const archiver = new SessionArchive(paths.archivesDir(profileName));
  const workspaces = new WorkspaceStore(paths.workspacesFile(profileName));
  const roleStore = new RoleStore(paths.profilePath(profileName, 'roles.json'));
  const worktreeManager = new GitWorktreeManager({
    worktreesRoot: paths.profilePath(profileName, 'worktrees'),
  });
  await Promise.all([sessions.load(), workspaces.load(), roleStore.load()]);

  let adapter;
  try {
    adapter = await buildAgentAdapter(env, {
      stopGraceMs:
        activeProfile.preferences.stopGraceMs ?? env.stopGraceMs,
      model: activeProfile.preferences.model,
    });
  } catch (error) {
    log.fail('adapter', error);
    process.stderr.write(`agent adapter 初始化失败：${errorMessage(error)}\n`);
    process.exitCode = 1;
    return;
  }
  const activeRuns = new ActiveRuns();
  const runPolicies = new RunPolicyStore();
  const concurrencyStore = new ConcurrencyStore();
  const retentionStore = new RetentionStore();
  const approvals = new ApprovalRegistry();
  const questions = new QuestionRegistry();
  const densityStore = new DensityStore();
  const models = new ModelStore();
  const dshConfig = new DshProviderManager({ env: process.env });
  let streaming: StreamingChannel | undefined;
  let larkChannel: LarkChannel | undefined;

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
          model:
            models.get(scope) ??
            role?.model ??
            activeProfile.preferences.model ??
            (await dshConfig.defaultModel().catch(() => undefined)) ??
            env.model,
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
    archiver,
    defaultRetention: env.retentionMsgs,
    archiveMax: env.archiveMax,
    archiveMaxAgeDays: env.archiveMaxAgeDays,
    approvals,
    questions,
    densityStore,
    models,
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
  };
  if (activeProfile.preferences.stopGraceMs !== undefined) {
    channelInput.stopGraceMs = activeProfile.preferences.stopGraceMs;
  }
  const bridge = await startChannel(channelInput);
  streaming = adaptLarkChannel(bridge.channel);
  larkChannel = bridge.channel;

  log.info('cli', 'started', {
    profile: profileName,
    home: paths.root,
    tenant: activeProfile.tenant,
    workspace: defaultWorkspace,
  });
  process.stdout.write(`dsh-lark-bot 已启动，profile=${profileName}\n`);

  await waitForShutdown();
  await bridge.disconnect();
  await adapter.dispose?.();
  await Promise.all([sessions.flush(), workspaces.flush(), roleStore.flush()]);
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
