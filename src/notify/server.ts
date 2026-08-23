import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { log } from '../core/logger.js';
import type { MentionTarget } from '../bridge/types.js';
import type { AskPayload, AskResult } from './ask-handler.js';
import type { PlanPayload, PlanResult } from './plan-handler.js';
import type { ApprovalPayload, ApprovalResult } from './approval-handler.js';
import type { FilePayload, FileResult } from './file-handler.js';

export interface NotifyMessage {
  token: string;
  /** Scope key (chat id or `chat:thread`); resolved via the scope directory. */
  scope?: string;
  /** Direct chat id fallback when scope is unknown. */
  chatId?: string;
  threadId?: string;
  text: string;
  mentions?: MentionTarget[];
}

export interface NotifyDestination {
  chatId: string;
  threadId: string | undefined;
}

export interface NotifyServerDeps {
  token: string;
  port?: number;
  /** Test override for the JSON-whitespace heartbeat used by human waits. */
  longPollHeartbeatMs?: number;
  /** Resolve a scope/chat target to a concrete chat destination. */
  resolve: (message: NotifyMessage) => NotifyDestination | undefined;
  /** Send the outbound message (mentions supported). */
  send: (
    destination: NotifyDestination,
    payload: { text: string; mentions?: MentionTarget[] },
  ) => Promise<void>;
  /** Optional handler for the `lark_ask_user` question-card channel. */
  ask?: (payload: AskPayload, signal?: AbortSignal) => Promise<AskResult>;
  /** Optional handler for the `lark_request_plan_approval` channel. */
  plan?: (payload: PlanPayload, signal?: AbortSignal) => Promise<PlanResult>;
  /** Optional handler for dsh rc.8 one-shot tool approval requests. */
  approval?: (payload: ApprovalPayload, signal?: AbortSignal) => Promise<ApprovalResult>;
  /** Optional handler for the `lark_send_file` channel. */
  file?: (payload: FilePayload) => Promise<FileResult>;
}

/**
 * Localhost-only callback server for the dsh `lark_notify` tool. The dsh
 * runtime (a child process) calls back into the bridge process over
 * `http://127.0.0.1:<port>/notify` with a shared token, so agents can mention
 * users and push messages to other chats/topics without exposing anything to
 * the network.
 */
export class NotifyServer {
  private server: Server | undefined;
  private readonly token: string;
  private readonly deps: NotifyServerDeps;
  url: string | undefined;
  askUrl: string | undefined;
  planUrl: string | undefined;
  approvalUrl: string | undefined;
  fileUrl: string | undefined;

  constructor(deps: NotifyServerDeps) {
    this.deps = deps;
    this.token = deps.token;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => {
      void this.handle(req, res);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.deps.port ?? 0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        this.url = `http://127.0.0.1:${String(address.port)}/notify`;
        this.askUrl = `http://127.0.0.1:${String(address.port)}/ask`;
        this.planUrl = `http://127.0.0.1:${String(address.port)}/plan`;
        this.approvalUrl = `http://127.0.0.1:${String(address.port)}/approval`;
        this.fileUrl = `http://127.0.0.1:${String(address.port)}/file`;
        resolve();
      });
    });
    log.info('notify', 'server-started', { url: this.url });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let heartbeat: NodeJS.Timeout | undefined;
    const stopHeartbeat = (): void => {
      if (heartbeat === undefined) return;
      clearInterval(heartbeat);
      heartbeat = undefined;
    };
    const beginHumanWait = (): void => {
      if (res.headersSent || res.destroyed || res.writableEnded) return;
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.flushHeaders();
      const intervalMs = this.deps.longPollHeartbeatMs ?? 30_000;
      heartbeat = setInterval(() => {
        if (res.destroyed || res.writableEnded) {
          stopHeartbeat();
          return;
        }
        // JSON permits leading whitespace. A newline keeps both Undici's
        // response-body watchdog and intermediaries active while a human
        // decides, without changing the eventual response object.
        res.write('\n');
      }, intervalMs);
      heartbeat.unref();
      res.once('close', stopHeartbeat);
    };
    const respond = (status: number, body: Record<string, unknown>): void => {
      stopHeartbeat();
      res.off('close', stopHeartbeat);
      if (res.destroyed || res.writableEnded) return;
      if (!res.headersSent) {
        res.writeHead(status, { 'content-type': 'application/json' });
      }
      res.end(`${JSON.stringify(body)}\n`);
    };
    const waitForHuman = async <T>(
      handler: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> => {
      const controller = new AbortController();
      const abort = (): void => controller.abort();
      req.once('aborted', abort);
      const onResponseClose = (): void => {
        if (!res.writableEnded) abort();
      };
      res.once('close', onResponseClose);
      try {
        beginHumanWait();
        return await handler(controller.signal);
      } finally {
        req.off('aborted', abort);
        res.off('close', onResponseClose);
      }
    };
    try {
      const body = await readBody(req);
      if (req.method !== 'POST') {
        respond(404, { ok: false, error: 'not found' });
        return;
      }
      if (req.url === '/ask') {
        if (!this.deps.ask) {
          respond(404, { ok: false, error: 'ask channel is not wired' });
          return;
        }
        const payload = JSON.parse(body) as AskPayload;
        if (payload.token !== this.token) {
          respond(401, { ok: false, error: 'invalid token' });
          return;
        }
        if (!payload.sessionId || !payload.question?.trim()) {
          respond(400, { ok: false, error: 'sessionId and question are required' });
          return;
        }
        const result = await waitForHuman((signal) => this.deps.ask!(payload, signal));
        if (!result.ok) {
          respond(404, { ok: false, ...(result.error === undefined ? {} : { error: result.error }) });
          return;
        }
        respond(200, { ok: true, ...(result.answer === undefined ? {} : { answer: result.answer }) });
        return;
      }
      if (req.url === '/plan') {
        if (!this.deps.plan) {
          respond(404, { ok: false, error: 'plan channel is not wired' });
          return;
        }
        const payload = JSON.parse(body) as PlanPayload;
        if (payload.token !== this.token) {
          respond(401, { ok: false, error: 'invalid token' });
          return;
        }
        if (!payload.sessionId || !payload.plan?.trim()) {
          respond(400, { ok: false, error: 'sessionId and plan are required' });
          return;
        }
        const result: PlanResult = await waitForHuman((signal) =>
          this.deps.plan!(payload, signal)
        );
        if (!result.ok) {
          respond(404, { ok: false, ...(result.error ? { error: result.error } : {}) });
          return;
        }
        respond(200, {
          ok: true,
          decision: result.decision,
          ...(result.feedback ? { feedback: result.feedback } : {}),
        });
        return;
      }
      if (req.url === '/approval') {
        if (!this.deps.approval) {
          respond(404, { ok: false, error: 'approval channel is not wired' });
          return;
        }
        const payload = JSON.parse(body) as ApprovalPayload;
        if (payload.token !== this.token) {
          respond(401, { ok: false, error: 'invalid token' });
          return;
        }
        if (!payload.sessionId || !payload.toolName?.trim()) {
          respond(400, { ok: false, error: 'sessionId and toolName are required' });
          return;
        }
        const result: ApprovalResult = await waitForHuman((signal) =>
          this.deps.approval!(payload, signal)
        );
        if (!result.ok || !result.outcome) {
          respond(404, { ok: false, ...(result.error ? { error: result.error } : {}) });
          return;
        }
        respond(200, {
          ok: true,
          outcome: result.outcome,
          ...(result.denial === undefined ? {} : { denial: result.denial }),
        });
        return;
      }
      if (req.url === '/file') {
        if (!this.deps.file) {
          respond(404, { ok: false, error: 'file channel is not wired' });
          return;
        }
        const payload = JSON.parse(body) as FilePayload;
        if (payload.token !== this.token) {
          respond(401, { ok: false, error: 'invalid token' });
          return;
        }
        if (!payload.sessionId || !payload.path?.trim()) {
          respond(400, { ok: false, error: 'sessionId and path are required' });
          return;
        }
        const result = await this.deps.file(payload);
        if (!result.ok) {
          respond(400, { ok: false, ...(result.error ? { error: result.error } : {}) });
          return;
        }
        respond(200, {
          ok: true,
          ...(result.fileName ? { fileName: result.fileName } : {}),
          ...(result.size === undefined ? {} : { size: result.size }),
        });
        return;
      }
      if (req.url !== '/notify') {
        respond(404, { ok: false, error: 'not found' });
        return;
      }
      const message = JSON.parse(body) as NotifyMessage;
      if (message.token !== this.token) {
        respond(401, { ok: false, error: 'invalid token' });
        return;
      }
      if (!message.text?.trim()) {
        respond(400, { ok: false, error: 'text is required' });
        return;
      }
      const destination = this.deps.resolve(message);
      if (!destination) {
        respond(404, { ok: false, error: `unknown scope/chat: ${message.scope ?? message.chatId ?? ''}` });
        return;
      }
      await this.deps.send(destination, {
        text: message.text,
        ...(message.mentions === undefined ? {} : { mentions: message.mentions }),
      });
      respond(200, { ok: true, chatId: destination.chatId, threadId: destination.threadId ?? null });
    } catch (error) {
      log.fail('notify', error);
      respond(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      if (chunks.reduce((size, item) => size + item.length, 0) > 1_000_000) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function generateNotifyToken(): string {
  return `dsh-lark-${randomBytes(18).toString('hex')}`;
}
