import { loadRuntimeEnv } from '../../config/env.js';
import { resolveAppPaths } from '../../config/app-paths.js';
import { ConfigStore } from '../../config/profile-store.js';
import { BotFleetStore, validBotInstanceName } from '../../bot/fleet-store.js';
import { ensureBotProfile } from './run.js';
import { runSetup } from './setup.js';
import { ServiceManager } from '../../service/manager.js';
import type { ServiceStatus } from '../../service/types.js';
import { discoverDshBin } from '../../config/dsh-runtime.js';
import { homedir } from 'node:os';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

export type BotCommandAction = 'add' | 'list' | 'status' | 'remove';

export interface BotCommandOptions {
  name?: string;
  appId?: string;
  appSecret?: string;
  tenant?: string;
  workspace?: string;
  model?: string;
}

interface ManagedService {
  install(): Promise<ServiceStatus>;
  status(): Promise<ServiceStatus>;
  uninstall(): Promise<ServiceStatus>;
}

export interface BotCommandDeps {
  env?: NodeJS.ProcessEnv;
  version?: string;
  output?: (text: string) => void;
  setup?: typeof runSetup;
  ensureProfile?: typeof ensureBotProfile;
  serviceFor?: (dshProfile: string, env: NodeJS.ProcessEnv) => ManagedService;
  waitForIdentity?: typeof waitForBotIdentity;
  identityWaitMs?: number;
}

export async function runBotCommand(
  action: BotCommandAction,
  options: BotCommandOptions = {},
  deps: BotCommandDeps = {},
): Promise<void> {
  const output = deps.output ?? ((text: string) => process.stdout.write(text));
  const sourceEnv = mergeBotEnv(deps.env ?? process.env, options);
  const runtime = loadRuntimeEnv(sourceEnv);
  const paths = resolveAppPaths(runtime.home);
  const fleet = new BotFleetStore(paths.fleetFile);
  const configs = new ConfigStore(paths.configFile);
  await Promise.all([fleet.load(), configs.load()]);
  const sharedDshBin = discoverDshBin(homedir(), deps.env ?? process.env);

  const serviceFor = deps.serviceFor ?? ((dshProfile: string, env: NodeJS.ProcessEnv) =>
    new ServiceManager({
      profile: dshProfile,
      env,
      paths,
      version: deps.version ?? '0.0.0',
      ...(sharedDshBin ? { dshBin: sharedDshBin } : {}),
    }));

  if (action === 'list') {
    const rows = await Promise.all(fleet.list().map(async (entry) => {
      const status = await serviceFor(
        entry.dshProfile,
        instanceEnv(sourceEnv, entry.name, entry.dshHome),
      ).status();
      const profile = configs.getProfile(entry.bridgeProfile);
      return [
        entry.name,
        entry.botName ?? entry.botOpenId ?? 'identity pending',
        entry.dshProfile,
        entry.dshHome,
        status.state,
        profile?.preferences.model ?? 'default',
      ].join('\t');
    }));
    output(rows.length > 0
      ? `name\tbot\tdsh profile\tdsh home\tservice\tmodel\n${rows.join('\n')}\n`
      : '尚未添加多机器人实例。使用 `dsh-lark-bot bot add <name>` 添加。\n');
    return;
  }

  const name = requiredName(options.name);
  if (action === 'remove' && name === 'default') {
    throw new Error('默认主机器人不能通过 `bot remove` 删除；请使用标准 service/plugin 生命周期命令。');
  }
  const current = fleet.get(name);
  if (action === 'status') {
    if (!current) throw new Error(`机器人实例不存在：${name}`);
    const status = await serviceFor(
      current.dshProfile,
      instanceEnv(sourceEnv, name, current.dshHome),
    ).status();
    output(formatBotStatus(current, status, configs.getProfile(current.bridgeProfile)?.preferences.model));
    return;
  }

  if (action === 'remove') {
    if (!current) throw new Error(`机器人实例不存在：${name}`);
    await serviceFor(
      current.dshProfile,
      instanceEnv(sourceEnv, name, current.dshHome),
    ).uninstall();
    await rm(join(paths.botDshHome(name), '.credentials.yaml'), { force: true });
    await configs.removeProfile(current.bridgeProfile);
    await fleet.remove(name);
    output(
      `✅ 已移除机器人实例 ${name}；服务和凭据已删除，${paths.profileDir(current.bridgeProfile)} 中的会话/工作树数据保留。\n`,
    );
    return;
  }

  if (current) throw new Error(`机器人实例已存在：${name}`);
  if (configs.getProfile(name)) {
    throw new Error(`bridge profile 已存在但不属于 fleet：${name}；请使用其他实例名。`);
  }
  if (Boolean(options.appId) !== Boolean(options.appSecret)) {
    throw new Error('--app-id 与 --app-secret 必须同时提供；都不提供时使用二维码绑定。');
  }
  if (runtime.adapterMode === 'web') {
    throw new Error(
      '多机器人实例不支持共享 Web adapter 事件流；请为附加实例使用 sdk 或 acp。',
    );
  }
  const dshProfile = name === 'default' ? 'dsh-lark' : `dsh-lark-${name}`;
  const dshHome = paths.botDshHome(name);
  const setup = deps.setup ?? runSetup;
  const ensure = deps.ensureProfile ?? ensureBotProfile;
  await setup({ profile: dshProfile, dshHome, guardian: false });
  await ensure(configs, { env: runtime, profileName: name, allowOnboarding: true });
  await fleet.add({ name, bridgeProfile: name, dshProfile, dshHome });
  const service = serviceFor(dshProfile, instanceEnv(sourceEnv, name, dshHome));
  try {
    const status = await service.install();
    if (status.state !== 'running') throw new Error(`服务未进入 running（当前 ${status.state}）`);
    const waitForIdentity = deps.waitForIdentity ?? waitForBotIdentity;
    await waitForIdentity(fleet, name, deps.identityWaitMs ?? 120_000);
  } catch (error) {
    try {
      await service.uninstall();
      await rm(join(dshHome, '.credentials.yaml'), { force: true });
      await fleet.remove(name);
      await configs.removeProfile(name);
    } catch (cleanupError) {
      throw new Error(
        `机器人实例 ${name} 启动失败，且自动回滚未完成（可重试 bot remove）：` +
        `${errorMessage(error)}；清理错误：${errorMessage(cleanupError)}`,
      );
    }
    throw new Error(`机器人实例 ${name} 启动失败，已回滚凭据与 fleet 注册：${errorMessage(error)}`);
  }
  output(`✅ 机器人实例 ${name} 已添加并启动（dsh profile: ${dshProfile}）。\n`);
}

function requiredName(value: string | undefined): string {
  if (!value) throw new Error('请提供机器人实例名。');
  if (!validBotInstanceName(value)) {
    throw new Error('机器人实例名必须以小写字母开头，只能包含小写字母、数字和连字符，最长 32 字符。');
  }
  return value;
}

function mergeBotEnv(base: NodeJS.ProcessEnv, options: BotCommandOptions): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = {
    ...base,
    ...(options.tenant ? { DSH_LARK_TENANT: options.tenant } : {}),
    ...(options.workspace ? { DSH_LARK_WORKSPACE: options.workspace } : {}),
    ...(options.model ? { DSH_LARK_MODEL: options.model } : {}),
  };
  // Adding without explicit app flags must onboard a new PersonalAgent rather
  // than silently cloning credentials exported for the primary bot.
  delete merged.DSH_LARK_APP_ID;
  delete merged.DSH_LARK_APP_SECRET;
  if (options.appId) merged.DSH_LARK_APP_ID = options.appId;
  if (options.appSecret) merged.DSH_LARK_APP_SECRET = options.appSecret;
  return merged;
}

function instanceEnv(base: NodeJS.ProcessEnv, name: string, dshHome: string): NodeJS.ProcessEnv {
  return {
    ...base,
    DSH_LARK_PROFILE: name,
    DSH_LARK_INSTANCE: name,
    DSH_LARK_DSH_PROFILE: name === 'default' ? 'dsh-lark' : `dsh-lark-${name}`,
    DSH_HOME: dshHome,
  };
}

function formatBotStatus(
  entry: ReturnType<BotFleetStore['get']> & {},
  status: ServiceStatus,
  model: string | undefined,
): string {
  return [
    `机器人实例 ${entry.name}`,
    `  bot:            ${entry.botName ?? entry.botOpenId ?? 'identity pending'}`,
    `  bridge profile: ${entry.bridgeProfile}`,
    `  dsh profile:    ${entry.dshProfile}`,
    `  dsh home:       ${entry.dshHome}`,
    `  service:        ${status.state}`,
    `  model:          ${model ?? 'default'}`,
    '',
  ].join('\n');
}

export async function waitForBotIdentity(
  fleet: BotFleetStore,
  name: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await fleet.load();
    const entry = fleet.get(name);
    if (entry?.startupError) throw new Error(entry.startupError);
    if (entry?.botOpenId) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('服务已启动，但未在时限内完成 bot open_id 登记');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
