import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  createLarkChannel,
  type CardActionEvent,
  type CardStreamController,
  type LarkChannel,
  type NormalizedMessage,
} from '@larksuite/channel';
import { parse } from 'yaml';
import { DshAdapter } from '../adapters/dsh/adapter.js';
import { SdkDshAdapter } from '../adapters/dsh/sdk-adapter.js';
import {
  DEFAULT_SAFE_SDK_PROFILE,
  ensureSdkProfile,
  resolveSdkLaunch,
  type SdkLaunchSpec,
  type SdkProfileEnsureResult,
} from '../adapters/dsh/sdk-runtime.js';
import type { AgentAdapter } from '../adapters/types.js';
import type { CardDensity } from '../card/density.js';
import { parseCardDensity } from '../card/density.js';
import {
  finalizeIfRunning,
  initialState,
  markIdleTimeout,
  markInterrupted,
  reduce,
  type RunState,
} from '../card/run-state.js';
import { renderCard } from '../card/run-renderer.js';
import { resolveAppPaths, type AppPaths } from '../config/app-paths.js';
import { discoverDshBin, resolveDshHome } from '../config/dsh-runtime.js';
import type { RuntimeEnv } from '../config/env.js';
import { ConfigStore, type ProfileConfig } from '../config/profile-store.js';
import { isEventFresh } from '../config/security.js';
import { log } from '../core/logger.js';
import {
  parseGuardianCommand,
  safemodeHelpText,
} from './control.js';
import type { GuardianControlKind } from './control.js';
import {
  isHeartbeatFresh,
  readHeartbeat,
  heartbeatAgeMs,
} from './heartbeat.js';
import {
  captureOutput,
  findProfileProcess,
  spawnDetached,
  type DetachedSpawn,
  type ProfileProcess,
} from './process.js';
import {
  ensureSafeProfile,
  probeSafeProfile,
  type SafeProfileProbeResult,
} from './safe-profile.js';
import {
  loadGuardianState,
  newGuardianState,
  saveGuardianState,
  type GuardianState,
} from './state.js';

/**
 * Safety-net guardian service.
 *
 * A minimal process independent of dsh / Cordis that:
 *  1. stays silent (no Feishu connection) while the dsh profile is up
 *     (fresh bridge heartbeat or live `dsh --profile <name>` process);
 *  2. after the profile has been observed up once, takes over the Feishu
 *     channel when dsh goes down and accepts control signals
 *     (`/safemode` family);
 *  3. on `/safemode`, provisions a core-only safe profile
 *     (`dsh-base` + `dsh-headless`, no third-party plugins) and proxies a
 *     restricted conversation to it for self-healing;
 *  4. on `/safemode exit`, relaunches the full profile, disconnects and
 *     hands the channel back.
 */

export interface GuardianServiceOptions {
  stateFile: string;
  configFile: string;
  heartbeatFile: string;
  home: string;
  /** Explicit dsh bin override (tests / unusual installs); else auto-discovered. */
  dshBin?: string;
  env?: NodeJS.ProcessEnv;
  dshProfile: string;
  bridgeProfile: string;
  safeProfile: string;
  pollMs?: number;
  staleMs?: number;
  /** Live-process grace: heartbeat stale this long means the engine is dead. */
  engineDeadMs?: number;
  /** Cooldown between full-profile relaunch attempts (default 60s). */
  relaunchCooldownMs?: number;
  /** How long to wait for a relaunched profile to come up before giving up and taking over (default 15s). */
  relaunchReadyTimeoutMs?: number;
  /** Consecutive polls dsh must be down before taking over (flap guard). */
  takeoverGracePolls?: number;
  /** Delay between the `/safemode exit` reply and channel disconnect (ms). */
  sendDelayMs?: number;
  now?: () => number;
  createChannel?: typeof createLarkChannel;
  adapter?: AgentAdapter;
  findProcess?: (dshProfile: string) => Promise<ProfileProcess | undefined>;
  spawnDetachedFn?: typeof spawnDetached;
  probeSafeProfileFn?: (
    input: {
      bin: string;
      dshProfile: string;
      home: string;
      env?: NodeJS.ProcessEnv;
    },
  ) => Promise<SafeProfileProbeResult>;
  /** Adapter engine selection for safe-mode tasks. */
  safeAdapterMode?: 'auto' | 'sdk' | 'headless';
  /** Safe-mode task wall-clock timeout before the run is stopped. */
  safeTimeoutMs?: number;
  /** Card density used for safe-mode run cards. */
  safeDensity?: CardDensity;
  /** Injectable SDK runtime provisioning (tests). */
  ensureSdkProfile?: (
    options: Parameters<typeof ensureSdkProfile>[0],
  ) => Promise<SdkProfileEnsureResult>;
  runPluginList?: (
    bin: string,
    dshProfile: string,
  ) => Promise<{ stdout: string; stderr: string }>;
  saveState?: (state: GuardianState) => Promise<void>;
  logger?: Pick<typeof log, 'info' | 'warn' | 'fail'>;
}

export interface GuardianSnapshot {
  mode: GuardianState['mode'];
  dshProfile: string;
  bridgeProfile: string;
  safeProfile: string;
  profileSeenUp: boolean;
  dshUp: boolean;
  heartbeatAgeMs: number | undefined;
  channelConnected: boolean;
  safeEngine: 'sdk' | 'headless' | 'test' | undefined;
  safeRuns: number;
  pid: number;
  dshBin: string | undefined;
  relaunchedPid: number | undefined;
  updatedAt: string;
}

interface TranscriptEntry {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_TRANSCRIPT_ENTRIES = 30;
const SAFE_RUN_TIMEOUT_MS = 10 * 60_000;
const SAFE_SDK_PROVISION_TIMEOUT_MS = 3 * 60_000;
const SAFE_CARD_TICK_MS = 5_000;
const RELAUNCH_COOLDOWN_MS = 60_000;
const RELAUNCH_READY_TIMEOUT_MS = 15_000;

interface SafeEngine {
  adapter: AgentAdapter;
  kind: 'sdk' | 'headless' | 'test';
}

interface SafeRun {
  stop: () => Promise<void>;
  startedAt: number;
}

export class GuardianService {
  private readonly options: Required<
    Pick<
      GuardianServiceOptions,
      | 'stateFile'
      | 'configFile'
      | 'heartbeatFile'
      | 'home'
      | 'dshProfile'
      | 'bridgeProfile'
      | 'safeProfile'
      | 'pollMs'
      | 'staleMs'
      | 'engineDeadMs'
      | 'relaunchCooldownMs'
      | 'relaunchReadyTimeoutMs'
      | 'takeoverGracePolls'
      | 'sendDelayMs'
      | 'safeAdapterMode'
      | 'safeTimeoutMs'
      | 'safeDensity'
    >
  > &
    Pick<
      GuardianServiceOptions,
      | 'env'
      | 'createChannel'
      | 'adapter'
      | 'findProcess'
      | 'spawnDetachedFn'
      | 'probeSafeProfileFn'
      | 'ensureSdkProfile'
      | 'runPluginList'
      | 'dshBin'
      | 'saveState'
      | 'logger'
      | 'now'
    >;

  private state: GuardianState;
  private channel: LarkChannel | undefined;
  private safeEngine: SafeEngine | undefined;
  private readonly safeRuns = new Map<string, SafeRun>();
  private readonly sessionIds = new Map<string, string>();
  private readonly transcripts = new Map<string, TranscriptEntry[]>();
  private downStreak = 0;
  private lastRelaunchAt: number | undefined;
  private relaunchPending = false;
  private relaunchStartedAt: number | undefined;
  private lastHeartbeatFreshAt: number | undefined;
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;
  private stopped = false;
  private dshBin: string | undefined;
  private config: ProfileConfig | undefined;
  private readonly eventFreshnessMs: number;
  private readonly activeMessages = new Set<Promise<void>>();

  constructor(options: GuardianServiceOptions) {
    this.options = {
      pollMs: options.pollMs ?? 2_000,
      staleMs: options.staleMs ?? 15_000,
      engineDeadMs: options.engineDeadMs ?? 120_000,
      relaunchCooldownMs: options.relaunchCooldownMs ?? RELAUNCH_COOLDOWN_MS,
      relaunchReadyTimeoutMs: options.relaunchReadyTimeoutMs ?? RELAUNCH_READY_TIMEOUT_MS,
      takeoverGracePolls: options.takeoverGracePolls ?? 2,
      sendDelayMs: options.sendDelayMs ?? 600,
      safeAdapterMode: options.safeAdapterMode ?? 'auto',
      safeTimeoutMs: options.safeTimeoutMs ?? SAFE_RUN_TIMEOUT_MS,
      safeDensity: options.safeDensity ?? 'detailed',
      stateFile: options.stateFile,
      configFile: options.configFile,
      heartbeatFile: options.heartbeatFile,
      home: options.home,
      dshProfile: options.dshProfile,
      bridgeProfile: options.bridgeProfile,
      safeProfile: options.safeProfile,
      ...defined({
        env: options.env,
        createChannel: options.createChannel,
        adapter: options.adapter,
        findProcess: options.findProcess,
        spawnDetachedFn: options.spawnDetachedFn,
        probeSafeProfileFn: options.probeSafeProfileFn,
        ensureSdkProfile: options.ensureSdkProfile,
        runPluginList: options.runPluginList,
        dshBin: options.dshBin,
        saveState: options.saveState,
        logger: options.logger,
        now: options.now,
      }),
    };
    this.state = newGuardianState({
      dshProfile: options.dshProfile,
      bridgeProfile: options.bridgeProfile,
    });
    this.eventFreshnessMs = parseFreshness(this.options.env?.DSH_LARK_EVENT_FRESHNESS_MS);
  }

  get mode(): GuardianState['mode'] {
    return this.state.mode;
  }

  async start(): Promise<void> {
    const loaded = await loadGuardianState(this.options.stateFile, this.state);
    if (loaded.dshProfile !== this.options.dshProfile) {
      // The state file is authoritative once written; adopt it so the
      // guardian keeps monitoring the profile it was installed for.
      this.state = loaded;
    } else {
      this.state = loaded;
    }
    await this.loadContext();
    await this.save();
    await this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.pollMs);
    this.timer.unref?.();
    this.log().info('guardian', 'started', {
      dshProfile: this.state.dshProfile,
      bridgeProfile: this.state.bridgeProfile,
      mode: this.state.mode,
      pollMs: this.options.pollMs,
    });
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.stopAllSafeRuns();
    this.sessionIds.clear();
    await Promise.allSettled([...this.activeMessages]);
    await this.disconnectChannel();
    await this.disposeSafeEngine();
    this.log().info('guardian', 'stopped', {});
  }

  snapshot(): GuardianSnapshot {
    return {
      mode: this.state.mode,
      dshProfile: this.state.dshProfile,
      bridgeProfile: this.state.bridgeProfile,
      safeProfile: this.state.safeProfile,
      profileSeenUp: this.state.profileSeenUp,
      dshUp: this.dshUp,
    heartbeatAgeMs: this.lastHeartbeatAgeMs,
    channelConnected: this.channel !== undefined,
    safeEngine: this.safeEngine?.kind,
    safeRuns: this.safeRuns.size,
    pid: process.pid,
      dshBin: this.dshBin,
      relaunchedPid: this.state.relaunchedPid,
      updatedAt: this.state.updatedAt,
    };
  }

  private dshUp = false;
  private lastHeartbeatAgeMs: number | undefined;

  private log() {
    return this.options.logger ?? log;
  }

  private async loadContext(): Promise<void> {
    const store = new ConfigStore(this.options.configFile);
    await store.load();
    this.config = store.getProfile(this.state.bridgeProfile);
    this.dshBin =
      this.options.dshBin ?? discoverDshBin(this.options.home, this.options.env ?? process.env);
  }

  private async save(): Promise<void> {
    if (this.options.saveState) {
      await this.options.saveState(this.state);
      return;
    }
    await saveGuardianState(this.options.stateFile, this.state);
  }

  private async setMode(mode: GuardianState['mode']): Promise<void> {
    if (this.state.mode === mode) return;
    this.state.mode = mode;
    await this.save();
  }

  private async setSeenUp(): Promise<void> {
    if (this.state.profileSeenUp) return;
    this.state.profileSeenUp = true;
    await this.save();
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.ticking) return;
    this.ticking = true;
    try {
      const heartbeat = await readHeartbeat(this.options.heartbeatFile);
      const now = (this.options.now ?? Date.now)();
      const heartbeatFresh = isHeartbeatFresh(heartbeat, this.options.staleMs, now);
      this.lastHeartbeatAgeMs = heartbeat ? heartbeatAgeMs(heartbeat, now) : undefined;
      if (heartbeatFresh) this.lastHeartbeatFreshAt = now;
      const processFound = await (this.options.findProcess ?? findProfileProcess)(
        this.state.dshProfile,
      );
      const processAlive = processFound !== undefined;
      const engineDead =
        this.lastHeartbeatFreshAt !== undefined &&
        now - this.lastHeartbeatFreshAt > this.options.engineDeadMs;
      // A live process alone does not mean the channel is owned: if the bridge
      // engine's heartbeat has been stale long enough, the engine is dead even
      // though the dsh process survives — take over so the rescue entrance
      // stays reachable.
      const up = heartbeatFresh || (processAlive && !engineDead);
      this.dshUp = up;

      if (up) {
        this.downStreak = 0;
        if (this.relaunchPending || this.state.relaunchedPid !== undefined) {
          this.relaunchPending = false;
          this.relaunchStartedAt = undefined;
          this.state.relaunchedPid = undefined;
          await this.save();
          this.log().info('guardian', 'bridge-relaunch-ready', {
            dshProfile: this.state.dshProfile,
          });
        }
        await this.setSeenUp();
        if (this.state.mode !== 'standby' || this.channel !== undefined) {
          // The full profile came back (or the user started it manually):
          // release the Feishu channel and leave safe mode immediately.
          await this.stopAllSafeRuns();
          this.sessionIds.clear();
          await this.disconnectChannel();
          this.transcripts.clear();
          await this.disposeSafeEngine();
          await this.setMode('standby');
        }
        return;
      }

      // dsh is down.
      if (!this.state.profileSeenUp) return; // never observed up: stay silent
      this.downStreak += 1;
      if (this.downStreak < this.options.takeoverGracePolls) return;
      // Auto-relaunch lifecycle: after a relaunch, wait for the bridge to come
      // up (fresh heartbeat or a live profile process) within a bounded
      // readiness window. While pending, neither take over the Feishu channel
      // (avoids a brief double connection) nor spawn again (cooldown).
      if (this.relaunchPending) {
        const ready =
          heartbeatFresh ||
          (await (this.options.findProcess ?? findProfileProcess)(
            this.state.dshProfile,
          )) !== undefined;
        if (ready) {
          this.relaunchPending = false;
          this.relaunchStartedAt = undefined;
          this.log().info('guardian', 'bridge-relaunch-ready', {
            dshProfile: this.state.dshProfile,
          });
          // The profile is coming up on its own: the next tick's `up` check
          // will release the channel; do not take over now.
          return;
        }
        if (now - (this.relaunchStartedAt ?? now) > this.options.relaunchReadyTimeoutMs) {
          this.relaunchPending = false;
          this.relaunchStartedAt = undefined;
          this.state.relaunchedPid = undefined;
          await this.save();
          this.log().fail('guardian', new Error('bridge relaunch did not come up within the readiness window'), {
            dshProfile: this.state.dshProfile,
          });
        } else {
          // Still giving the relaunch a chance to boot.
          return;
        }
      }
      let relaunchedNow = false;
      try {
        if (
          this.lastRelaunchAt === undefined ||
          now - this.lastRelaunchAt > this.options.relaunchCooldownMs
        ) {
          const bin = this.dshBin;
          if (bin) {
            // Re-check immediately before spawning so a profile that came back
            // between this tick's process check and the spawn is never
            // double-launched.
            const stillDown = await (this.options.findProcess ?? findProfileProcess)(
              this.state.dshProfile,
            );
            if (stillDown === undefined) {
              const spawn = this.options.spawnDetachedFn ?? spawnDetached;
              const spawned: DetachedSpawn = spawn('node', [
                bin,
                '--profile',
                this.state.dshProfile,
              ]);
              if (spawned.pid !== undefined) {
                this.state.relaunchedPid = spawned.pid;
                this.lastRelaunchAt = now;
                this.relaunchPending = true;
                this.relaunchStartedAt = now;
                relaunchedNow = true;
                await this.save();
                this.log().info('guardian', 'bridge-relaunched', {
                  pid: spawned.pid,
                  dshProfile: this.state.dshProfile,
                });
              }
            } else {
              this.log().warn('guardian', 'bridge-relaunch-skipped', {
                dshProfile: this.state.dshProfile,
                pid: stillDown.pid,
              });
            }
          }
        }
      } catch (error) {
        this.log().fail('guardian', error);
      }
      // After a fresh relaunch, give the bridge time to come up before taking
      // over the Feishu channel (avoids a brief double connection).
      if (!relaunchedNow) await this.ensureChannel();
    } catch (error) {
      this.log().fail('guardian', error);
    } finally {
      this.ticking = false;
    }
  }

  private async ensureChannel(): Promise<void> {
    if (this.channel !== undefined) return;
    const config = this.config ?? (await this.reloadConfig());
    if (!config) {
      this.log().warn('guardian', 'no-bridge-profile', {
        bridgeProfile: this.state.bridgeProfile,
      });
      return;
    }
    const create = this.options.createChannel ?? createLarkChannel;
    const channel = create({
      appId: config.accounts.appId,
      appSecret: config.accounts.appSecret,
      domain:
        config.tenant === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn',
      source: 'dsh-lark-bot-guardian',
      policy: {
        dmMode: config.access.allowedUsers.length ? 'allowlist' : 'open',
        requireMention: true,
        respondToMentionAll: false,
        ...(config.access.allowedUsers.length
          ? { dmAllowlist: config.access.allowedUsers }
          : {}),
        ...(config.access.allowedChats.length
          ? { groupAllowlist: config.access.allowedChats }
          : {}),
      },
      safety: {
        chatQueue: { enabled: false },
      },
      outbound: {
        streamThrottleMs: 400,
      },
      includeRawEvent: true,
      resolveChatMode: true,
      handshakeTimeoutMs: 8_000,
      httpTimeoutMs: 30_000,
      respectProxyEnv: true,
    });

    channel.on({
      message: (msg) => this.track(this.handleMessage(msg)),
      cardAction: (event) => this.track(this.handleCardAction(event)),
      error: (error) => {
        this.log().fail('guardian-channel', error);
      },
      reconnecting: () => {
        this.log().warn('guardian-channel', 'reconnecting', {});
      },
      reconnected: () => {
        this.log().info('guardian-channel', 'reconnected', {});
      },
    });

    try {
      await channel.connect();
      this.channel = channel;
      // Keep `safe` (restart mid-safe-mode); otherwise mark takeover.
      if (this.state.mode !== 'safe') await this.setMode('takeover');
      this.log().info('guardian', 'channel-taken-over', {
        dshProfile: this.state.dshProfile,
      });
    } catch (error) {
      this.log().fail('guardian-channel', error);
    }
  }

  private async reloadConfig(): Promise<ProfileConfig | undefined> {
    await this.loadContext();
    return this.config;
  }

  private async disconnectChannel(): Promise<void> {
    const channel = this.channel;
    this.channel = undefined;
    if (!channel) return;
    try {
      await channel.disconnect();
    } catch (error) {
      this.log().fail('guardian-channel', error);
    }
    if (this.state.mode !== 'standby') {
      await this.setMode('standby');
    }
  }

  private scopeFor(msg: NormalizedMessage): string {
    if (msg.chatMode === 'topic' && msg.threadId) return `${msg.chatId}:${msg.threadId}`;
    return msg.chatId;
  }

  private authorized(msg: NormalizedMessage): boolean {
    const access = this.config?.access;
    if (!access) return false;
    const controllers = access.admins.length > 0 ? access.admins : access.allowedUsers;
    return controllers.includes(msg.senderId);
  }

  private async sendMarkdown(
    chatId: string,
    markdown: string,
    replyTo?: string,
  ): Promise<void> {
    if (!this.channel) return;
    try {
      await this.channel.send(
        chatId,
        { markdown },
        replyTo ? { replyTo } : undefined,
      );
    } catch (error) {
      this.log().fail('guardian-send', error);
    }
  }

  private async handleMessage(msg: NormalizedMessage): Promise<void> {
    if (!this.authorized(msg)) {
      this.log().warn('guardian', 'unauthorized-message-dropped', {
        senderId: msg.senderId,
        scope: this.scopeFor(msg),
      });
      return;
    }
    if (this.eventFreshnessMs > 0 && !isEventFresh(msg.createTime, this.eventFreshnessMs)) {
      this.log().warn('guardian', 'stale-message-dropped', {
        ageMs: Date.now() - msg.createTime,
      });
      return;
    }

    const scope = this.scopeFor(msg);
    const control = parseGuardianCommand(msg.content);
    if (control) {
      await this.handleControl(control.kind, msg);
      return;
    }

    if (this.state.mode === 'safe') {
      await this.runSafeTask(scope, msg);
      return;
    }

    await this.sendMarkdown(
      msg.chatId,
      [
        'dsh 未在运行，守护进程已接管飞书通道。',
        '',
        '发送 `/safemode` 进入仅核心安全模式（dsh 主核心 + 官方 headless，不加载任何第三方插件），',
        '或发送 `/safemode status` 查看状态。',
      ].join('\n'),
      msg.messageId,
    );
  }

  private track(promise: Promise<void>): Promise<void> {
    this.activeMessages.add(promise);
    void promise.finally(() => {
      this.activeMessages.delete(promise);
    });
    return promise;
  }

  private async handleControl(
    kind: GuardianControlKind,
    msg: NormalizedMessage,
  ): Promise<void> {
    switch (kind) {
      case 'safemode':
        await this.enterSafeMode(msg);
        return;
      case 'safemode-status':
        await this.sendStatus(msg);
        return;
      case 'safemode-plugins':
        await this.sendPluginList(msg);
        return;
      case 'safemode-exit':
        await this.exitSafeMode(msg);
        return;
      case 'safemode-stop':
        await this.handleStop(msg);
        return;
      case 'safemode-help':
        await this.sendMarkdown(msg.chatId, safemodeHelpText(), msg.messageId);
        return;
    }
  }

  private async enterSafeMode(msg: NormalizedMessage): Promise<void> {
    if (this.state.mode === 'safe' && this.safeEngine) {
      await this.sendMarkdown(
        msg.chatId,
        '已在安全模式中。发送普通消息与 dsh 核心对话；`/safemode exit` 退出。',
        msg.messageId,
      );
      return;
    }
    await this.sendMarkdown(
      msg.chatId,
      '正在进入安全模式：仅挂载 dsh 主核心（`dsh-base` + `dsh-headless`），不加载任何第三方插件…',
      msg.messageId,
    );
    try {
      await ensureSafeProfile({
        home: this.options.home,
        dshProfile: this.state.dshProfile,
        env: this.options.env ?? process.env,
      });
      const bin = this.dshBin;
      if (!bin) {
        await this.sendMarkdown(
          msg.chatId,
          '未找到本机 dsh 安装，无法进入安全模式。请先确认 `dsh` 可用。',
          msg.messageId,
        );
        return;
      }
      const probe = await (this.options.probeSafeProfileFn ?? probeSafeProfile)({
        bin,
        dshProfile: this.state.dshProfile,
        home: this.options.home,
        env: this.options.env ?? process.env,
      });
      if (!probe.ok) {
        await this.sendMarkdown(
          msg.chatId,
          [
            '安全模式就绪检查失败（dsh 核心无法解析）：',
            '',
            '```',
            (probe.error ?? 'unknown error').slice(0, 1_500),
            '```',
          ].join('\n'),
          msg.messageId,
        );
        return;
      }
      const engine = await this.resolveSafeEngine();
      if (!engine) {
        await this.sendMarkdown(
          msg.chatId,
          [
            '安全模式引擎不可用：SDK runtime 未就绪且 headless 也无法启动。',
            '请检查本机 dsh 安装与 pnpm 可用性后重试。',
          ].join('\n'),
          msg.messageId,
        );
        return;
      }
      this.safeEngine = engine;
      await this.setMode('safe');
      const engineLabel =
        engine.kind === 'sdk'
          ? 'SDK 流式引擎（实时思考 / 工具调用 / 文字输出）'
          : engine.kind === 'headless'
            ? 'headless 回退引擎（完成后一次性输出，任务期间卡片实时显示活动状态）'
            : '测试引擎';
      await this.sendMarkdown(
        msg.chatId,
        [
          `安全模式已就绪：dsh 主核心运行中，第三方插件未加载。`,
          `引擎：${engineLabel}`,
          '',
          '现在可以直接对话进行自愈（定位 / 修复 / 禁用损坏插件），例如：',
          '- “列出当前 profile 安装的插件并检查哪个最近变坏”',
          '- “用 `/safemode plugins` 查看插件清单”',
          '- 修复完成后发送 `/safemode exit` 重启完整 profile。',
        ].join('\n'),
        msg.messageId,
      );
    } catch (error) {
      await this.sendMarkdown(
        msg.chatId,
        `进入安全模式失败：${error instanceof Error ? error.message : String(error)}`,
        msg.messageId,
      );
    }
  }

  private async sendStatus(msg: NormalizedMessage): Promise<void> {
    const snapshot = this.snapshot();
    await this.sendMarkdown(
      msg.chatId,
      [
        `模式：${snapshot.mode}`,
        `dsh profile：${snapshot.dshProfile}`,
        `安全 profile：${snapshot.safeProfile}`,
        `dsh 是否在线：${snapshot.dshUp ? '是' : '否'}`,
        `心跳龄：${snapshot.heartbeatAgeMs === undefined ? '无' : `${snapshot.heartbeatAgeMs}ms`}`,
        `飞书通道：${snapshot.channelConnected ? '守护已接管' : '未连接'}`,
        `安全引擎：${snapshot.safeEngine ?? '未就绪'}`,
        `安全模式运行中任务：${snapshot.safeRuns}`,
        `dsh bin：${snapshot.dshBin ?? '未发现'}`,
        `守护 pid：${snapshot.pid}`,
        `已观察过 dsh 运行：${snapshot.profileSeenUp ? '是' : '否'}`,
      ].join('\n'),
      msg.messageId,
    );
  }

  private async sendPluginList(msg: NormalizedMessage): Promise<void> {
    const bin = this.dshBin;
    if (!bin) {
      await this.sendMarkdown(
        msg.chatId,
        '未找到本机 dsh 安装，无法列出插件。',
        msg.messageId,
      );
      return;
    }
    const run = this.options.runPluginList ?? defaultRunPluginList;
    const result = await run(bin, this.state.dshProfile);
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    await this.sendMarkdown(
      msg.chatId,
      [
        `profile \`${this.state.dshProfile}\` 已安装的插件（依赖清单）：`,
        '',
        '```',
        (output || '（空）').slice(0, 3_000),
        '```',
      ].join('\n'),
      msg.messageId,
    );
  }

  private async exitSafeMode(msg: NormalizedMessage): Promise<void> {
    if (this.state.mode !== 'safe') {
      await this.sendMarkdown(
        msg.chatId,
        '当前不在安全模式，无需退出。',
        msg.messageId,
      );
      return;
    }
    const bin = this.dshBin;
    if (!bin) {
      await this.sendMarkdown(
        msg.chatId,
        '未找到本机 dsh 安装，无法重启完整 profile。',
        msg.messageId,
      );
      return;
    }
    const spawn = this.options.spawnDetachedFn ?? spawnDetached;
    const spawned: DetachedSpawn = spawn('node', [bin, '--profile', this.state.dshProfile]);
    if (spawned.pid !== undefined) {
      this.state.relaunchedPid = spawned.pid;
      // Give the relaunched profile the same readiness grace and cooldown as
      // an automatic relaunch: no immediate double spawn, no channel takeover
      // while it boots.
      this.lastRelaunchAt = (this.options.now ?? Date.now)();
      this.relaunchPending = true;
      this.relaunchStartedAt = this.lastRelaunchAt;
    }
    await this.save();
    await this.sendMarkdown(
      msg.chatId,
      [
        `正在退出安全模式并重启完整 profile（\`${this.state.dshProfile}\`）…`,
        '守护进程将断开飞书连接并把通道交还给 dsh 桥接引擎。',
      ].join('\n'),
      msg.messageId,
    );
    // Give the reply a moment to flush before releasing the channel.
    await delay(this.options.sendDelayMs);
    await this.stopAllSafeRuns();
    this.sessionIds.clear();
    this.transcripts.clear();
    await this.disposeSafeEngine();
    await this.disconnectChannel();
  }

  private async runSafeTask(scope: string, msg: NormalizedMessage): Promise<void> {
    const engine = this.safeEngine;
    if (!engine) {
      await this.sendMarkdown(
        msg.chatId,
        '安全模式未就绪，请先发送 `/safemode`。',
        msg.messageId,
      );
      return;
    }
    const active = this.safeRuns.get(scope);
    if (active) {
      const elapsed = Math.round((Date.now() - active.startedAt) / 1000);
      await this.sendMarkdown(
        msg.chatId,
        `（安全模式）上一条任务仍在处理中，已运行 ${elapsed}s。发送 \`/safemode stop\` 或点击卡片 ⏹ 按钮可终止。`,
        msg.messageId,
      );
      return;
    }
    const transcript = this.transcripts.get(scope) ?? [];
    const prompt = buildSafePrompt(transcript, msg.content);
    const runId = randomUUID();
    const density = this.options.safeDensity;
    const timeoutMs = this.options.safeTimeoutMs;
    const now = Date.now();
    let state: RunState = {
      ...initialState,
      startedAtMs: now,
      lastActivityMs: now,
    };
    let assistantOutput = '';
    let finalText: string | undefined;
    let errorText: string | undefined;
    let timedOut = false;
    let events = 0;
    let sawActivity = false;

    const run = engine.adapter.run({
      runId,
      prompt,
      cwd: this.config?.workspaces.default,
      sessionId: this.sessionIds.get(scope),
      model: undefined,
      images: undefined,
      stopGraceMs: 5_000,
    });
    this.safeRuns.set(scope, { stop: () => run.stop(), startedAt: now });
    this.log().info('guardian-safe', 'task-start', {
      runId,
      scope,
      engine: engine.kind,
      timeoutMs,
    });

    try {
      await this.streamCard(
        msg.chatId,
        renderCard(state, density, Date.now()),
        async (controller) => {
          const ticker = setInterval(() => {
            void controller.update(renderCard(state, density, Date.now())).catch(() => {
              // Best-effort heartbeat; the event loop below owns the final
              // state transition.
            });
          }, SAFE_CARD_TICK_MS);
          ticker.unref?.();
          let timeoutTimer: NodeJS.Timeout | undefined;
          let armTimeout: (() => void) | undefined;
          try {
            const consume = async (): Promise<void> => {
              for await (const event of run.events) {
                if (timedOut) return;
                events += 1;
                state = reduce(state, event);
                state = { ...state, lastActivityMs: Date.now() };
                if (event.type === 'final_text') {
                  finalText = event.content;
                } else if (event.type === 'text') {
                  assistantOutput += event.delta;
                }
                if (event.type === 'system' && event.sessionId) {
                  this.sessionIds.set(scope, event.sessionId);
                }
                if (event.type === 'error') errorText = event.message;
                if (event.type !== 'system' && event.type !== 'error') {
                  sawActivity = true;
                }
                // Every agent event counts as activity: restart the idle
                // window so a long but responsive task is never cut short.
                armTimeout?.();
                await controller.update(renderCard(state, density, Date.now()));
              }
            };
            // Idle watchdog: only a task that goes silent for the configured
            // window is stopped (active streaming work keeps re-arming it).
            const timeoutPromise =
              timeoutMs > 0
                ? new Promise<void>((resolve) => {
                    armTimeout = (): void => {
                      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
                      timeoutTimer = setTimeout(() => {
                        if (timedOut) return;
                        timedOut = true;
                        state = markIdleTimeout(
                          state,
                          Math.round(timeoutMs / 60_000),
                        );
                        void run.stop();
                        resolve();
                      }, timeoutMs);
                    };
                    armTimeout();
                  })
                : undefined;
            if (timeoutPromise) {
              await Promise.race([consume(), timeoutPromise]);
            } else {
              await consume();
            }
            if (!timedOut && state.terminal === 'running') {
              state = finalizeIfRunning(state);
            }
            await controller.update(renderCard(state, density, Date.now()));
          } finally {
            clearInterval(ticker);
            if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
          }
        },
        { replyTo: msg.messageId },
      );
    } catch (error) {
      this.log().fail('guardian-safe', error, { runId, scope });
      state = markInterrupted(state);
      try {
        await this.sendMarkdown(
          msg.chatId,
          `⚠️ 安全模式任务失败：${error instanceof Error ? error.message : String(error)}`,
          msg.messageId,
        );
      } catch {
        // best effort; the card may already have failed
      }
      return;
    } finally {
      this.safeRuns.delete(scope);
    }

    const durationMs = Date.now() - now;
    const terminal = state.terminal;
    this.log().info('guardian-safe', 'task-end', {
      runId,
      scope,
      engine: engine.kind,
      terminal,
      events,
      durationMs,
      ...(errorText === undefined ? {} : { errorText }),
      outputLength: (finalText ?? assistantOutput).trim().length,
    });

    // Terminal states are already visible on the card; only successful
    // answers are folded into the next-turn transcript.
    if (terminal === 'error' && !sawActivity) {
      // Session-level failures (e.g. dsh rejecting a resume with id
      // collision) arrive as an error event before any real activity: drop
      // the stored session binding so the next safe task starts fresh
      // instead of failing again on the same broken session.
      this.sessionIds.delete(scope);
    }
    if (timedOut || terminal === 'interrupted' || terminal === 'error' || terminal === 'idle_timeout') {
      return;
    }
    const answer = finalText ?? assistantOutput.trim();
    if (!answer) {
      this.log().warn('guardian-safe', 'task-empty', { runId, scope });
      return;
    }
    this.transcripts.set(scope, pushTranscript(transcript, [
      { role: 'user', content: msg.content },
      { role: 'assistant', content: answer },
    ]));
  }

  private async streamCard(
    chatId: string,
    initial: object,
    producer: (controller: CardStreamController) => Promise<void>,
    options?: { replyTo?: string },
  ): Promise<void> {
    if (!this.channel) return;
    await this.channel.stream(chatId, { card: { initial, producer } }, options);
  }

  private async handleCardAction(event: CardActionEvent): Promise<void> {
    const value = isRecord(event.action.value) ? event.action.value : undefined;
    if (value?.cmd !== 'stop') return;
    const scope = safeScopeForAction(event);
    const run = this.safeRuns.get(scope);
    if (!run) return;
    this.log().info('guardian-safe', 'stop-requested', { scope });
    await run.stop();
  }

  private async handleStop(msg: NormalizedMessage): Promise<void> {
    const scope = this.scopeFor(msg);
    const run = this.safeRuns.get(scope);
    if (!run) {
      await this.sendMarkdown(
        msg.chatId,
        '当前没有正在运行的安全模式任务。',
        msg.messageId,
      );
      return;
    }
    await this.sendMarkdown(
      msg.chatId,
      '已请求终止当前任务，正在停止 dsh 进程…',
      msg.messageId,
    );
    await run.stop();
  }

  private async resolveSafeEngine(): Promise<SafeEngine | undefined> {
    if (this.options.adapter) {
      return { adapter: this.options.adapter, kind: 'test' };
    }
    const mode = this.options.safeAdapterMode;
    if (mode === 'sdk' || mode === 'auto') {
      const launch = await this.provisionSafeSdk();
      if (launch) {
        this.log().info('guardian-safe', 'engine-selected', { engine: 'sdk' });
        return {
          adapter: new SdkDshAdapter({
            launch,
            provider: this.options.env?.DSH_LARK_PROVIDER ?? 'deepseek-official',
            model: this.safeModel(),
          }),
          kind: 'sdk',
        };
      }
      if (mode === 'sdk') return undefined;
    }
    if (!this.dshBin) return undefined;
    this.log().info('guardian-safe', 'engine-selected', { engine: 'headless' });
    return {
      adapter: new DshAdapter({
        command: 'node',
        args: [this.dshBin, '--profile', this.state.safeProfile],
        stopGraceMs: 5_000,
      }),
      kind: 'headless',
    };
  }

  private async provisionSafeSdk(): Promise<SdkLaunchSpec | undefined> {
    if (!this.dshBin) return undefined;
    const ensure = this.options.ensureSdkProfile ?? ensureSdkProfile;
    const result = await withTimeout(
      ensure({
        home: this.options.home,
        env: this.options.env ?? process.env,
        profile: DEFAULT_SAFE_SDK_PROFILE,
        bridgeTools: false,
      }),
      SAFE_SDK_PROVISION_TIMEOUT_MS,
    );
    if (!result) {
      this.log().warn('guardian-safe', 'sdk-provision-timeout', {
        profile: DEFAULT_SAFE_SDK_PROFILE,
      });
      return undefined;
    }
    if (!result.ok) {
      this.log().warn('guardian-safe', 'sdk-provision-failed', {
        profile: DEFAULT_SAFE_SDK_PROFILE,
        error: result.error,
      });
      return undefined;
    }
    return resolveSdkLaunch({
      home: this.options.home,
      env: this.options.env ?? process.env,
      profile: DEFAULT_SAFE_SDK_PROFILE,
    });
  }

  private safeModel(): string {
    const explicit = this.options.env?.DSH_LARK_MODEL;
    if (explicit) return explicit;
    return (
      readDshDefaultModel(this.options.home, this.options.env ?? process.env) ??
      'deepseek-v4-flash'
    );
  }

  private async stopAllSafeRuns(): Promise<void> {
    const runs = [...this.safeRuns.values()];
    this.safeRuns.clear();
    await Promise.allSettled(runs.map((run) => run.stop()));
  }

  private async disposeSafeEngine(): Promise<void> {
    const engine = this.safeEngine;
    this.safeEngine = undefined;
    if (!engine) return;
    try {
      await engine.adapter.dispose?.();
    } catch (error) {
      this.log().fail('guardian-safe', error);
    }
  }
}

function buildSafePrompt(
  transcript: readonly TranscriptEntry[],
  current: string,
): string {
  if (transcript.length === 0) return current;
  const history = transcript
    .map((entry) => `${entry.role === 'user' ? '用户' : '助手'}: ${entry.content}`)
    .join('\n');
  return [
    '以下是本次安全模式对话的上下文（用于连续性，不是新任务指令）：',
    '',
    history,
    '',
    `用户: ${current}`,
  ].join('\n');
}

function pushTranscript(
  existing: readonly TranscriptEntry[],
  entries: readonly TranscriptEntry[],
): TranscriptEntry[] {
  return [...existing, ...entries].slice(-MAX_TRANSCRIPT_ENTRIES);
}

async function defaultRunPluginList(
  bin: string,
  dshProfile: string,
): Promise<{ stdout: string; stderr: string }> {
  return captureOutput('node', [bin, 'plugin', '--profile', dshProfile, 'list'], 60_000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeScopeForAction(event: CardActionEvent): string {
  const raw = isRecord(event.raw) ? event.raw : undefined;
  const message = isRecord(raw?.message) ? raw.message : undefined;
  const threadId =
    typeof message?.thread_id === 'string' ? message.thread_id : undefined;
  return threadId ? `${event.chatId}:${threadId}` : event.chatId;
}

/**
 * Read the dsh default model from the official settings store without
 * importing dsh code (mirrors the bridge's `agent-default-model` namespace).
 */
function readDshDefaultModel(
  home: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  try {
    const file = join(resolveDshHome(home, env), 'settings.yaml');
    const doc = parse(readFileSync(file, 'utf8')) as Record<string, unknown> | undefined;
    const value = doc?.['agent-default-model'];
    return typeof value === 'string' && value ? value : undefined;
  } catch {
    return undefined;
  }
}

function parseFreshness(value: string | undefined): number {
  const raw = value?.trim();
  if (!raw) return 600_000;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 600_000;
}

function parseSafeAdapterMode(value: string | undefined): 'auto' | 'sdk' | 'headless' {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'sdk' || normalized === 'headless') return normalized;
  return 'auto';
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const raw = value?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

type DefinedValues<T> = { [K in keyof T]: Exclude<T[K], undefined> };

/** Copy only defined values, satisfying exactOptionalPropertyTypes. */
function defined<T extends Record<string, unknown>>(input: T): DefinedValues<T> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value;
  }
  return output as DefinedValues<T>;
}

/** Resolve the guardian's file layout for a runtime env (used by the CLI). */
export interface GuardianLayout {
  paths: AppPaths;
  stateFile: string;
  heartbeatFile: string;
  configFile: string;
}

export function guardianLayoutFor(
  env: RuntimeEnv,
  bridgeProfile: string,
): GuardianLayout {
  const paths = resolveAppPaths(env.home);
  return {
    paths,
    stateFile: join(paths.root, 'guardian.json'),
    heartbeatFile: paths.profilePath(bridgeProfile, 'guardian', 'heartbeat.json'),
    configFile: paths.configFile,
  };
}

export async function buildGuardianService(
  env: RuntimeEnv,
  overrides: Partial<GuardianServiceOptions> = {},
): Promise<GuardianService> {
  const paths = resolveAppPaths(env.home);
  const stateFile = join(paths.root, 'guardian.json');
  const fallback = newGuardianState({
    dshProfile: env.guardianProfile,
    bridgeProfile: env.guardianBridgeProfile,
  });
  const state = await loadGuardianState(stateFile, fallback);
  return new GuardianService({
    stateFile,
    configFile: paths.configFile,
    heartbeatFile: paths.profilePath(state.bridgeProfile, 'guardian', 'heartbeat.json'),
    home: homedir(),
    env: process.env,
    dshProfile: state.dshProfile,
    bridgeProfile: state.bridgeProfile,
    safeProfile: state.safeProfile,
    pollMs: env.guardianPollMs,
    staleMs: env.guardianStaleMs,
    engineDeadMs: env.guardianEngineDeadMs,
    safeAdapterMode: parseSafeAdapterMode(process.env.DSH_LARK_GUARDIAN_SAFE_ADAPTER),
    safeTimeoutMs: parsePositiveInt(
      process.env.DSH_LARK_GUARDIAN_SAFE_TIMEOUT_MS,
      SAFE_RUN_TIMEOUT_MS,
    ),
    safeDensity: parseCardDensity(process.env.DSH_LARK_GUARDIAN_CARD_DENSITY) ?? 'detailed',
    ...overrides,
  });
}
