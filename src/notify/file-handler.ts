import type { SessionStore } from '../session/store.js';
import type { ScopeDirectory } from '../bridge/scope-directory.js';
import type { SendOptions } from '../bridge/send-options.js';
import { prepareOutboundFile } from '../media/outbound-files.js';

export interface FilePayload {
  token: string;
  sessionId: string;
  path: string;
  runtimeCwd?: string;
  fileName?: string;
}

export interface FileResult {
  ok: boolean;
  fileName?: string;
  size?: number;
  error?: string;
}

export interface FileHandlerDeps {
  sessions: SessionStore;
  scopeDirectory: ScopeDirectory;
  allowedRoots: (
    sessionId: string,
    scope: string,
    workspace: string,
  ) => string[] | Promise<string[]>;
  maxBytes?: number;
  channel: {
    sendFile(chatId: string, fileName: string, content: Buffer, options?: SendOptions): Promise<void>;
  };
}

export function buildFileHandler(deps: FileHandlerDeps): (payload: FilePayload) => Promise<FileResult> {
  return async (payload) => {
    const scope = deps.sessions.scopeForSession(payload.sessionId);
    const workspace = deps.sessions.workspaceForSession(payload.sessionId);
    if (!scope || !workspace) return { ok: false, error: `unknown session: ${payload.sessionId}` };
    const destination = deps.scopeDirectory.resolve(scope);
    if (!destination) return { ok: false, error: `unknown scope: ${scope}` };
    try {
      const prepared = await prepareOutboundFile({
        path: payload.path,
        baseDir: payload.runtimeCwd ?? workspace,
        allowedRoots: await deps.allowedRoots(payload.sessionId, scope, workspace),
        ...(payload.fileName ? { fileName: payload.fileName } : {}),
        ...(deps.maxBytes === undefined ? {} : { maxBytes: deps.maxBytes }),
      });
      const options = destination.threadId && destination.messageId
        ? { threadId: destination.threadId, replyTo: destination.messageId }
        : undefined;
      await deps.channel.sendFile(destination.chatId, prepared.fileName, prepared.content, options);
      return { ok: true, fileName: prepared.fileName, size: prepared.size };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}
