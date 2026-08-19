import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  spawn as defaultSpawn,
  type ChildProcess,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process';
import { homedir } from 'node:os';
import { Readable as NodeReadable, Writable as NodeWritable } from 'node:stream';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent as AcpAgent,
  type Client as AcpClient,
  type ContentBlock as AcpContentBlock,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk';
import type { RuntimeEnv } from '../../config/env.js';
import type {
  AgentAdapter,
  AgentAvailability,
  AgentEvent,
  AgentRun,
  AgentRunOptions,
  ApprovalOutcome,
  ApprovalRequest,
} from '../types.js';
import { ensureAcpProfile, resolveAcpLaunch, type AcpLaunchSpec } from './acp-runtime.js';
import { EventChannel } from './event-channel.js';

export interface AcpAdapterOptions {
  launch: AcpLaunchSpec;
  provider: string;
  model: string;
  probeTimeoutMs?: number;
  spawn?: (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcess;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOfContent(content: unknown): string {
  if (!isRecord(content) || typeof content.text !== 'string') return '';
  return content.text;
}

function acpImageFallback(content: unknown): string {
  if (!isRecord(content) || content.type !== 'image') return '';
  const mime = typeof content.mimeType === 'string' ? content.mimeType : 'unknown';
  return `\n[ACP 返回了一张 ${mime} 图片；当前飞书桥接暂不支持图片出站，未静默丢弃。]\n`;
}

/** Translate an ACP session update into bridge events (forward-compatible). */
export function translateAcpUpdate(notification: SessionNotification): AgentEvent[] {
  const update = notification.update;
  if (!isRecord(update)) return [];
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return textOfContent(update.content) || acpImageFallback(update.content)
        ? [{ type: 'text', delta: textOfContent(update.content) || acpImageFallback(update.content) }]
        : [];
    case 'agent_thought_chunk':
      return textOfContent(update.content)
        ? [{ type: 'thinking', delta: textOfContent(update.content) }]
        : [];
    case 'usage_update':
      return typeof update.used === 'number' && typeof update.size === 'number'
        ? [{
            type: 'context_usage',
            usedTokens: update.used,
            contextWindow: update.size,
          }]
        : [];
    case 'tool_call': {
      if (typeof update.toolCallId !== 'string') return [];
      return [
        {
          type: 'tool_use',
          id: update.toolCallId,
          name: typeof update.title === 'string' ? update.title : 'tool',
          input: update.rawInput ?? {},
        },
      ];
    }
    default:
      return [];
  }
}

function mapApprovalOutcome(
  outcome: ApprovalOutcome,
  options: RequestPermissionRequest['options'],
): RequestPermissionResponse {
  if (outcome === 'cancelled' || outcome === 'unavailable') {
    return { outcome: { outcome: 'cancelled' } };
  }
  const wanted: 'allow_once' | 'reject_once' =
    outcome === 'allowed-once' ? 'allow_once' : 'reject_once';
  const option = options.find((item) => item.kind === wanted);
  if (!option) return { outcome: { outcome: 'cancelled' } };
  return { outcome: { outcome: 'selected', optionId: option.optionId } };
}

function imageMimeType(data: Buffer): string | undefined {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.subarray(0, 6).toString('ascii') === 'GIF87a' || data.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return undefined;
}

async function buildPromptBlocks(
  prompt: string,
  images: readonly string[] | undefined,
): Promise<AcpContentBlock[]> {
  const blocks: AcpContentBlock[] = [{ type: 'text', text: prompt }];
  for (const path of images ?? []) {
    const data = await readFile(path);
    const mimeType = imageMimeType(data);
    if (!mimeType) throw new Error(`ACP image input has unsupported format: ${path}`);
    blocks.push({ type: 'image', data: data.toString('base64'), mimeType });
  }
  return blocks;
}

function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<{ code: number | null; timedOut: boolean }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, timedOut: false });
  }
  return new Promise((resolve) => {
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            child.removeListener('exit', onExit);
            resolve({ code: child.exitCode, timedOut: true });
          }, timeoutMs)
        : undefined;
    const onExit = (code: number | null): void => {
      if (timer !== undefined) clearTimeout(timer);
      resolve({ code, timedOut: false });
    };
    child.once('exit', onExit);
  });
}

async function disposeChild(child: ChildProcess, graceMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.stdin?.end();
  if (!(await waitForChildExit(child, graceMs)).timedOut) return;
  child.kill('SIGTERM');
  if (!(await waitForChildExit(child, graceMs)).timedOut) return;
  child.kill('SIGKILL');
}

/**
 * Official ACP adapter. Spawns the `dsh-lark-acp` runtime and speaks the
 * Agent Client Protocol over stdio as a client: `session/request_permission`
 * maps to Feishu approval cards through `AgentRunOptions.onApprovalRequest`.
 * ACP sessions are fresh per run (no resume), matching the upstream server.
 */
export class AcpDshAdapter implements AgentAdapter {
  readonly id = 'dsh-acp';
  readonly displayName = 'DeepSeek Harness (ACP)';

  private readonly launch: AcpLaunchSpec;
  private readonly model: string;
  private readonly probeTimeoutMs: number;
  private readonly spawn: AcpAdapterOptions['spawn'];
  private readonly stopGraceMs: number;

  constructor(options: AcpAdapterOptions) {
    this.launch = options.launch;
    this.model = options.model;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 15_000;
    this.spawn = options.spawn;
    this.stopGraceMs = 5_000;
  }

  async isAvailable(): Promise<boolean> {
    return (await this.checkAvailability()).ok;
  }

  async checkAvailability(): Promise<AgentAvailability> {
    const child = this.spawnChild(process.cwd());
    if (!child.stdin || !child.stdout) {
      await disposeChild(child, this.stopGraceMs);
      return { ok: false, error: 'ACP child did not expose protocol streams', version: undefined };
    }
    const conn = new ClientSideConnection(
      () => ({
        requestPermission: () => Promise.resolve({ outcome: { outcome: 'cancelled' } }),
        sessionUpdate: () => Promise.resolve(),
      }),
      ndJsonStream(
        NodeWritable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        NodeReadable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      ),
    );
    try {
      const info = await withTimeout(
        conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
        this.probeTimeoutMs,
      );
      const name = info.agentInfo?.name ?? 'deepseek-harness-acp';
      const version = info.agentInfo?.version ?? 'unknown';
      return { ok: true, error: undefined, version: `${name}@${version}` };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        version: undefined,
      };
    } finally {
      await disposeChild(child, this.stopGraceMs);
    }
  }

  run(options: AgentRunOptions): AgentRun {
    const cwd = options.cwd ?? process.cwd();
    const model = options.model ?? this.model;
    const stopRequested = { value: false };
    const channel = new EventChannel<AgentEvent>();
    const child = this.spawnChild(cwd);
    let serverSessionId: string | undefined;
    let conn: ClientSideConnection | undefined;
    let hadError = false;
    const clientSessionId = `acp-${randomUUID().replaceAll('-', '')}`;

    const makeClient = (_agent: AcpAgent): AcpClient => ({
      sessionUpdate: async (notification: SessionNotification) => {
        for (const event of translateAcpUpdate(notification)) {
          if (event.type === 'error') hadError = true;
          channel.push(event);
        }
      },
      requestPermission: async (request: RequestPermissionRequest) => {
        if (!options.onApprovalRequest) {
          return { outcome: { outcome: 'cancelled' } };
        }
        const approval: ApprovalRequest = {
          id: request.toolCall.toolCallId,
          callId: request.toolCall.toolCallId,
          sessionId: request.sessionId,
          toolName:
            typeof request.toolCall.title === 'string' ? request.toolCall.title : 'tool',
          reason: approvalReason(request),
          toolInput: request.toolCall.rawInput,
          options: request.options.map((item) => ({
            optionId: item.optionId,
            name: item.name,
            kind: item.kind,
          })),
        };
        const outcome = await options.onApprovalRequest(approval);
        return mapApprovalOutcome(outcome, request.options);
      },
    });

    const task = (async () => {
      if (!child.stdin || !child.stdout) {
        throw new Error('ACP child did not expose protocol streams');
      }
      conn = new ClientSideConnection(
        makeClient,
        ndJsonStream(
          NodeWritable.toWeb(child.stdin) as WritableStream<Uint8Array>,
          NodeReadable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
        ),
      );
      const info = await conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
      const created = await conn.newSession({ cwd, mcpServers: [] });
      serverSessionId = created.sessionId;
      if (
        options.images?.length &&
        info.agentCapabilities?.promptCapabilities?.image !== true
      ) {
        throw new Error('ACP runtime did not advertise image prompt support; attachment was not sent');
      }
      const blocks = await buildPromptBlocks(options.prompt, options.images);
      const response = await conn.prompt({ sessionId: serverSessionId, prompt: blocks });
      if (response.stopReason === 'cancelled') {
        if (!stopRequested.value) {
          channel.push({ type: 'error', message: 'ACP turn cancelled', terminationReason: 'interrupted' });
          hadError = true;
        }
        return;
      }
      if (response.stopReason === 'refusal' || response.stopReason === 'max_turn_requests') {
        channel.push({
          type: 'error',
          message: `ACP turn stopped with reason: ${response.stopReason}`,
          terminationReason: 'failed',
        });
        hadError = true;
        return;
      }
      if (response.usage) {
        const usage: AgentEvent = {
          type: 'usage',
          ...(typeof response.usage.inputTokens === 'number'
            ? { inputTokens: response.usage.inputTokens }
            : {}),
          ...(typeof response.usage.outputTokens === 'number'
            ? { outputTokens: response.usage.outputTokens }
            : {}),
          ...(typeof response.usage.cachedReadTokens === 'number'
            ? { cacheReadTokens: response.usage.cachedReadTokens }
            : {}),
          ...(typeof response.usage.cachedWriteTokens === 'number'
            ? { cacheWriteTokens: response.usage.cachedWriteTokens }
            : {}),
        };
        channel.push(usage);
      }
    })().catch((error: unknown) => {
      if (!stopRequested.value) {
        channel.push({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
          terminationReason: 'failed',
        });
        hadError = true;
      }
    }).finally(() => {
      channel.close();
    });

    async function* events(): AsyncGenerator<AgentEvent> {
      yield {
        type: 'system',
        sessionId: clientSessionId,
        cwd,
        model,
      };
      for await (const event of channel) {
        yield event;
      }
      await task;
      if (!hadError) {
        yield {
          type: 'done',
          sessionId: clientSessionId,
          terminationReason: stopRequested.value ? 'interrupted' : 'normal',
        };
      }
    }

    return {
      runId: options.runId,
      events: events(),
      stop: async () => {
        stopRequested.value = true;
        if (conn && serverSessionId !== undefined) {
          try {
            await conn.cancel({ sessionId: serverSessionId });
          } catch {
            // The child may already be gone; teardown below is authoritative.
          }
        }
        await disposeChild(child, this.stopGraceMs);
      },
      waitForExit: (timeoutMs) =>
        waitForChildExit(child, timeoutMs).then((result) => !result.timedOut && result.code !== null),
    };
  }

  private spawnChild(cwd: string): ChildProcess {
    const spawnFn = this.spawn ?? defaultSpawn;
    return spawnFn(this.launch.command, this.launch.args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
}

function approvalReason(request: RequestPermissionRequest): string {
  const rawInput = request.toolCall.rawInput;
  if (
    isRecord(rawInput) && typeof rawInput.description === 'string' &&
    rawInput.description.trim() !== ''
  ) return rawInput.description;
  const title = typeof request.toolCall.title === 'string' ? request.toolCall.title : 'tool';
  return `Execute high-risk tool ${title}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`ACP probe timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Build the ACP adapter for the configured env (used by `buildAgentAdapter`). */
export async function buildAcpAgentAdapter(
  env: RuntimeEnv,
  preferences: { stopGraceMs: number | undefined; model: string | undefined },
): Promise<AcpDshAdapter> {
  const runtimeOptions = {
    home: homedir(),
    env: process.env,
    provider: env.provider,
    model: preferences.model ?? env.model,
    ...(env.dshExplicit ? { command: env.dshCommand, args: env.dshArgs } : {}),
  };
  const ensure = await ensureAcpProfile(runtimeOptions);
  if (!ensure.ok) {
    throw new Error(
      `ACP runtime profile setup failed: ${ensure.error ?? 'unknown error'} ` +
        '(install pnpm, or set DSH_LARK_ADAPTER=headless for the legacy adapter)',
    );
  }
  const launch = resolveAcpLaunch(runtimeOptions);
  return new AcpDshAdapter({
    launch,
    provider: env.provider,
    model: preferences.model ?? env.model,
  });
}
