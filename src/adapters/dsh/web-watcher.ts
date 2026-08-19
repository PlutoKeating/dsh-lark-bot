import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import type { ScopeDirectory } from '../../bridge/scope-directory.js';
import type { StreamingChannel } from '../../bridge/types.js';
import { log } from '../../core/logger.js';
import { bilingualMarkdown } from '../../card/i18n.js';
import type { SessionStore } from '../../session/store.js';
import type { WorkspaceStore } from '../../workspace/store.js';

/**
 * Minimal surface of the web adapter used by the watcher (kept as an
 * interface so the watcher does not import the concrete adapter class).
 */
export interface WebMuxProvider {
  openMux(): Promise<WebSocket>;
  lastTurnEndSeq: Map<string, number>;
}

export interface WebSessionWatcherInput {
  adapter: WebMuxProvider;
  channel: StreamingChannel;
  sessions: SessionStore;
  workspaces: WorkspaceStore;
  scopeDirectory: ScopeDirectory;
}

export interface WebSessionWatcher {
  close(): void;
}

/** Resolve Web execution cwd back to the bridge's canonical workspace key. */
export function webWorkspaceCwd(
  sessions: SessionStore,
  sessionId: string,
  executionCwd: string,
): string {
  return sessions.workspaceForSession(sessionId) ?? executionCwd;
}

interface TurnBuffer {
  userText: string;
  assistantText: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter(isRecord)
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('');
}

/** Read the persisted session header (cwd) and title for push notifications. */
async function readSessionMeta(sid: string): Promise<{ cwd: string; title: string }> {
  const home = homedir();
  const dshHome = process.env.DSH_HOME?.trim() || join(home, '.dsh');
  const root = join(dshHome, 'sessions');
  let found: string | undefined;
  try {
    const projects = await readdir(root, { withFileTypes: true });
    for (const p of projects) {
      if (!p.isDirectory()) continue;
      const dir = join(root, p.name, sid);
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && e.name.startsWith('session.jsonl')) {
            found = join(dir, e.name);
            break;
          }
        }
      } catch {
        // ignore
      }
      if (found !== undefined) break;
    }
  } catch {
    // ignore
  }
  if (found === undefined) return { cwd: '', title: '' };
  try {
    const buf = await readFile(found);
    const text = zstdDecompressSync(buf).toString('utf8');
    let cwd = '';
    let title = '';
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const o = JSON.parse(t) as Record<string, unknown>;
        if (o.type === 'session' && typeof o.cwd === 'string') cwd = o.cwd;
        if (o.type === 'session/title') {
          const data = isRecord(o.data) ? o.data : undefined;
          if (typeof data?.title === 'string' && data.title.trim()) title = data.title.trim();
        }
      } catch {
        // ignore
      }
    }
    return { cwd, title };
  } catch {
    return { cwd: '', title: '' };
  }
}

/**
 * Push web-GUI turn completions to Feishu and auto-switch the chat's session
 * mapping (and workspace cwd — `resumeFor` requires both to match) to the
 * session that just completed, so the phone follows whatever session the web
 * GUI is working on. Only web-initiated turns are pushed: turns handled by a
 * bridge run are deduped via the adapter's `lastTurnEndSeq`.
 */
export function startWebSessionWatcher(input: WebSessionWatcherInput): WebSessionWatcher {
  const { adapter, channel, sessions, workspaces, scopeDirectory } = input;
  const buffers = new Map<string, TurnBuffer>();
  let ws: WebSocket | undefined;
  let closed = false;
  let reconnectTimer: NodeJS.Timeout | undefined;

  const sendToScopes = async (
    sid: string,
    meta: { cwd: string; title: string },
    userText: string,
    assistantText: string,
  ): Promise<void> => {
    const scopes = scopeDirectory.knownScopes();
    for (const scope of scopes) {
      const dest = scopeDirectory.resolve(scope);
      if (!dest) continue;
      try {
        // A bridge-created Git session executes in a generated worktree, but
        // its durable identity remains the user-selected project directory.
        // Prefer the SessionStore's native-session index so a Web continuation
        // cannot create a second workspace keyed by the generated worktree.
        const workspaceCwd = webWorkspaceCwd(sessions, sid, meta.cwd);
        const current = sessions.getRaw(scope, workspaceCwd)?.sessionId;
        if (current !== sid) {
          sessions.set(scope, sid, workspaceCwd);
          if (workspaceCwd) workspaces.setCwd(scope, workspaceCwd);
        }
        sessions.recordExchange(scope, workspaceCwd, userText ? [userText] : [], assistantText);
        const head =
          assistantText.length > 600 ? `${assistantText.slice(0, 600)}…` : assistantText;
        const title = meta.title || sid.slice(0, 24);
        await channel.sendMarkdown(
          dest.chatId,
          bilingualMarkdown(
            [`📣 网页端会话「${title}」完成了一轮：`, '', head, '', '—— 飞书已自动进入该会话，继续发消息就在这个会话里干活。'].join('\n'),
            [`📣 Web session “${title}” completed a turn:`, '', head, '', '— Feishu/Lark is now attached to this session; keep messaging here to continue.'].join('\n'),
          ),
          dest.threadId ? { threadId: dest.threadId } : undefined,
        );
      } catch (error) {
        log.fail('web-watch-send', error, { scope, sessionId: sid });
      }
    }
  };

  const connect = async (): Promise<void> => {
    if (closed) return;
    try {
      ws = await adapter.openMux();
      const onMessage = (event: { data: unknown }): void => {
        let full: unknown;
        try {
          full = JSON.parse(String(event.data));
        } catch {
          return;
        }
        const frame = (full as { payload?: Record<string, unknown> })?.payload;
        if (!frame || frame.type !== 'session/event' || typeof frame.sessionId !== 'string') return;
        const sid = frame.sessionId;
        const ev = isRecord(frame.event) ? frame.event : undefined;
        if (ev === undefined || typeof ev.type !== 'string') return;
        if (ev.type === 'turn/start') {
          buffers.set(sid, { userText: '', assistantText: '' });
        } else if (ev.type === 'user/message') {
          const buf = buffers.get(sid);
          if (!buf) return;
          const data = isRecord(ev.data) ? ev.data : undefined;
          const txt = textOf(data?.content);
          if (
            txt &&
            !txt.startsWith('Current runtime context') &&
            !txt.startsWith('<system-reminder>') &&
            !txt.startsWith('background job')
          ) {
            buf.userText = txt;
          }
        } else if (ev.type === 'assistant/chunk') {
          const buf = buffers.get(sid);
          const data = isRecord(ev.data) ? ev.data : undefined;
          const chunk = isRecord(data?.chunk) ? data.chunk : undefined;
          if (
            buf &&
            chunk?.type === 'text-delta' &&
            typeof chunk.text === 'string'
          ) {
            buf.assistantText += chunk.text;
          }
        } else if (ev.type === 'assistant/message') {
          const buf = buffers.get(sid);
          if (!buf) return;
          const data = isRecord(ev.data) ? ev.data : undefined;
          const msg = isRecord(data?.message) ? data.message : undefined;
          const txt = textOf(msg?.content);
          if (txt) buf.assistantText = txt;
        } else if (ev.type === 'turn/end') {
          const buf = buffers.get(sid);
          buffers.delete(sid);
          if (!buf) return;
          const finalText = buf.assistantText.trim();
          if (!finalText) return;
          const seq = typeof ev.seq === 'number' ? ev.seq : 0;
          // Small delay so a concurrent bridge run can record its handled turn
          // first; without it the same turn could be pushed twice.
          setTimeout(() => {
            const handledSeq = adapter.lastTurnEndSeq.get(sid);
            if (typeof handledSeq === 'number' && handledSeq >= seq) return;
            void (async () => {
              try {
                const meta = await readSessionMeta(sid);
                await sendToScopes(sid, meta, buf.userText, finalText);
              } catch (error) {
                log.fail('web-watch', error, { sessionId: sid });
              }
            })();
          }, 300);
        }
      };
      ws.addEventListener('message', onMessage);
      ws.addEventListener(
        'close',
        () => {
          if (!closed) reconnectTimer = setTimeout(connect, 5_000);
        },
        { once: true },
      );
    } catch (error) {
      log.fail('web-watch', error);
      if (!closed) reconnectTimer = setTimeout(connect, 10_000);
    }
  };

  void connect();

  return {
    close: (): void => {
      closed = true;
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        // ignore
      }
    },
  };
}
