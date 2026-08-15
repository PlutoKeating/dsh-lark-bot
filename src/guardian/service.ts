import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLarkChannel, type LarkChannel, type NormalizedMessage } from '@larksuite/channel';
import { DshAdapter } from '../adapters/dsh/adapter.js';
import type { AgentAdapter } from '../adapters/types.js';
import { resolveAppPaths, type AppPaths } from '../config/app-paths.js';
import { discoverDshBin } from '../config/dsh-runtime.js';
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
      | 'takeoverGracePolls'
      | 'sendDelayMs'
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
      | 'runPluginList'
      | 'dshBin'
      | 'saveState'
      | 'logger'
      | 'now'
    >;

  private state: GuardianState;
  private channel: LarkChannel | undefined;
  private safeAdapter: AgentAdapter | undefined;
  private readonly transcripts = new Map<string, TranscriptEntry[]>();
  private downStreak = 0;
  private lastRelaunchAt: number | undefined;
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
      takeoverGracePolls: options.takeoverGracePolls ?? 2,
      sendDelayMs: options.sendDelayMs ?? 600,
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
    await Promise.allSettled([...this.activeMessages]);
    await this.disconnectChannel();
    await this.safeAdapter?.dispose?.();
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
        await this.setSeenUp();
        if (this.state.mode !== 'standby' || this.channel !== undefined) {
          // The full profile came back (or the user started it manually):
          // release the Feishu channel and leave safe mode immediately.
          await this.disconnectChannel();
          this.transcripts.clear();
          await this.setMode('standby');
        }
        return;
      }

      // dsh is down.
      if (!this.state.profileSeenUp) return; // never observed up: stay silent
      this.downStreak += 1;
      if (this.downStreak < this.options.takeoverGracePolls) return;
      // Auto-relaunch the bridge so Feishu keeps working without a manual
      // restart. The spawned process inherits this guardian's env, so run the
      // guardian with DSH_LARK_ADAPTER=web and the bridge comes back in web
      // mode (single writer). 60s cooldown prevents a spawn loop.
      let relaunchedNow = false;
      try {
        const now = (this.options.now ?? Date.now)();
        if (this.lastRelaunchAt === undefined || now - this.lastRelaunchAt > 60_000) {
          const bin = this.dshBin;
          if (bin && !processAlive) {
            const spawn = this.options.spawnDetachedFn ?? spawnDetached;
            const spawned: DetachedSpawn = spawn('node', [bin, '--profile', this.state.dshProfile]);
            if (spawned.pid !== undefined) {
              this.state.relaunchedPid = spawned.pid;
              this.lastRelaunchAt = now;
              relaunchedNow = true;
              await this.save();
              this.log().info('guardian', 'bridge-relaunched', {
                pid: spawned.pid,
                dshProfile: this.state.dshProfile,
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
      case 'safemode-help':
        await this.sendMarkdown(msg.chatId, safemodeHelpText(), msg.messageId);
        return;
    }
  }

  private async enterSafeMode(msg: NormalizedMessage): Promise<void> {
    if (this.state.mode === 'safe') {
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
      this.safeAdapter ??=
        this.options.adapter ??
        new DshAdapter({
          command: 'node',
          args: [bin, '--profile', this.state.safeProfile],
          stopGraceMs: 5_000,
        });
      await this.setMode('safe');
      await this.sendMarkdown(
        msg.chatId,
        [
          '安全模式已就绪：dsh 主核心运行中，第三方插件未加载。',
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
    if (spawned.pid !== undefined) this.state.relaunchedPid = spawned.pid;
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
    this.transcripts.clear();
    await this.disconnectChannel();
  }

  private async runSafeTask(scope: string, msg: NormalizedMessage): Promise<void> {
    const adapter = this.safeAdapter;
    if (!adapter) {
      await this.sendMarkdown(
        msg.chatId,
        '安全模式未就绪，请先发送 `/safemode`。',
        msg.messageId,
      );
      return;
    }
    const transcript = this.transcripts.get(scope) ?? [];
    const prompt = buildSafePrompt(transcript, msg.content);
    await this.sendMarkdown(
      msg.chatId,
      '（安全模式 · dsh 核心处理中…）',
      msg.messageId,
    );

    const run = adapter.run({
      runId: randomUUID(),
      prompt,
      cwd: this.config?.workspaces.default,
      sessionId: undefined,
      model: undefined,
      images: undefined,
      stopGraceMs: 5_000,
    });
    const textParts: string[] = [];
    let finalText: string | undefined;
    let errorText: string | undefined;
    let terminal = false;
    try {
      for await (const event of run.events) {
        if (event.type === 'text' && event.delta) textParts.push(event.delta);
        if (event.type === 'final_text') finalText = event.content;
        if (event.type === 'error') {
          errorText = event.message;
          terminal = true;
        }
        if (event.type === 'done') terminal = true;
      }
    } catch (error) {
      errorText = error instanceof Error ? error.message : String(error);
      terminal = true;
    }

    if (!terminal) {
      await run.waitForExit(SAFE_RUN_TIMEOUT_MS);
    }

    if (errorText) {
      await this.sendMarkdown(
        msg.chatId,
        `（安全模式 · dsh 核心错误）\n${errorText.slice(0, 2_000)}`,
        msg.messageId,
      );
      return;
    }
    const answer = finalText ?? textParts.join('').trim();
    if (!answer) {
      await this.sendMarkdown(
        msg.chatId,
        '（安全模式 · dsh 核心未返回内容）',
        msg.messageId,
      );
      return;
    }
    await this.sendMarkdown(msg.chatId, answer, msg.messageId);
    this.transcripts.set(scope, pushTranscript(transcript, [
      { role: 'user', content: msg.content },
      { role: 'assistant', content: answer },
    ]));
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

function parseFreshness(value: string | undefined): number {
  const raw = value?.trim();
  if (!raw) return 600_000;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 600_000;
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
    ...overrides,
  });
}
