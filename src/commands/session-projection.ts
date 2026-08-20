import { randomUUID } from 'node:crypto';
import {
  renderSessionBindingConfirmCard,
  renderSessionSelectorCard,
  type SessionActionIdentity,
} from '../card/session-projection-card.js';
import { bilingualMarkdown } from '../card/i18n.js';
import type { AccessManager } from '../config/access-manager.js';
import type { SessionStore } from '../session/store.js';
import type { ScopeDirectory } from '../bridge/scope-directory.js';
import { memberOwnerForScope } from '../bridge/scope-isolation.js';
import type { CommandChannel, CommandContext } from './index.js';
import type { PreparedSessionBinding, SessionProjectionBridge } from '../session/projection-bridge.js';
import type { SessionProjectionStore } from '../session/projection-store.js';

interface PendingBinding {
  nonce: string;
  actorId: string;
  scope: string;
  workspaceCwd: string;
  chatId: string;
  threadId?: string;
  prepared: PreparedSessionBinding;
  expectedOwner?: { scope: string; workspaceCwd: string };
  expiresAt: number;
  timer: NodeJS.Timeout;
}

export interface SessionProjectionActionInput {
  value: Record<string, unknown>;
  operatorId: string | undefined;
  chatId: string;
  threadId: string | undefined;
  currentScope: string;
}

/** Explicit selector/confirmation workflow; no external activity can call bind. */
export class SessionProjectionController {
  private readonly pending = new Map<string, PendingBinding>();

  constructor(private readonly deps: {
    bridge: SessionProjectionBridge;
    store: SessionProjectionStore;
    sessions: SessionStore;
    scopes: ScopeDirectory;
    access: AccessManager;
    channel: CommandChannel;
    confirmationTtlMs?: number;
    selectorLimit?: number;
  }) {}

  async handleCommand(args: string, ctx: CommandContext): Promise<void> {
    const actorId = this.requireAuthorized(ctx.scope, ctx.chatId, ctx.chatMode, ctx.senderId);
    const workspaceCwd = ctx.workspaces.cwdFor(ctx.scope) ?? ctx.defaultWorkspace;
    const tokens = args.trim().split(/\s+/).filter(Boolean);
    if (tokens[0] === 'current') {
      const current = this.deps.store.get(ctx.scope, workspaceCwd);
      await ctx.channel.sendMarkdown(ctx.chatId, current
        ? bilingualMarkdown(
            `当前显式绑定：\`${current.sessionId}\`\n\nscope：\`${ctx.scope}\`\nworkspace：\`${workspaceCwd}\``,
            `Current explicit binding: \`${current.sessionId}\`\n\nscope: \`${ctx.scope}\`\nworkspace: \`${workspaceCwd}\``,
          )
        : bilingualMarkdown('当前 scope + workspace 尚未绑定 DSH session。', 'No DSH session is bound to this scope + workspace.'),
      this.options(ctx.threadId));
      return;
    }
    const requestedId = tokens[0] === 'bind' ? tokens[1] : undefined;
    if (tokens.length > 0 && !requestedId) {
      throw new Error('用法：/session [current|bind <sessionId>]');
    }
    if (requestedId) {
      await this.prepareConfirmation({
        sessionId: requestedId,
        identity: { scope: ctx.scope, workspaceCwd, actorId },
        chatId: ctx.chatId,
        ...(ctx.threadId ? { threadId: ctx.threadId } : {}),
      });
      return;
    }
    const sessions = (await this.deps.bridge.eligibleSessions(workspaceCwd)).slice(0, this.deps.selectorLimit ?? 10);
    if (sessions.length === 0) {
      await ctx.channel.sendMarkdown(ctx.chatId, bilingualMarkdown(
        '当前 canonical workspace 没有可绑定的普通 DSH session。',
        'No selectable regular DSH session exists in the current canonical workspace.',
      ), this.options(ctx.threadId));
      return;
    }
    if (!ctx.channel.sendCard) throw new Error('当前渠道不支持 session 选择卡片');
    await ctx.channel.sendCard(ctx.chatId, renderSessionSelectorCard({
      sessions,
      identity: { scope: ctx.scope, workspaceCwd, actorId },
    }), this.options(ctx.threadId));
  }

  async handleAction(input: SessionProjectionActionInput): Promise<{ toast: { type: 'success' | 'info' | 'error'; content: string } }> {
    this.pruneExpired();
    const action = typeof input.value.action === 'string' ? input.value.action : '';
    const requestedScope = typeof input.value.scope === 'string' ? input.value.scope : '';
    const workspaceCwd = typeof input.value.workspaceCwd === 'string' ? input.value.workspaceCwd : '';
    const cardActor = typeof input.value.actorId === 'string' ? input.value.actorId : '';
    if (!input.operatorId || input.operatorId !== cardActor || requestedScope !== input.currentScope) {
      return { toast: { type: 'error', content: '身份或 scope 不匹配 / Operator or scope mismatch' } };
    }
    const entry = this.deps.scopes.entry(requestedScope);
    const mode = entry?.chatMode ?? (input.threadId ? 'topic' : 'group');
    try {
      this.requireAuthorized(requestedScope, input.chatId, mode, input.operatorId);
      if (action === 'select') {
        const sessionId = typeof input.value.sessionId === 'string' ? input.value.sessionId : '';
        if (!sessionId || !workspaceCwd) throw new Error('invalid session selection');
        await this.prepareConfirmation({
          sessionId,
          identity: { scope: requestedScope, workspaceCwd, actorId: input.operatorId },
          chatId: input.chatId,
          ...(input.threadId ? { threadId: input.threadId } : {}),
        });
        return { toast: { type: 'info', content: '请检查披露范围并确认 / Review and confirm disclosure' } };
      }
      const nonce = typeof input.value.nonce === 'string' ? input.value.nonce : '';
      const pending = this.pending.get(nonce);
      if (!pending || pending.expiresAt <= Date.now() ||
          pending.actorId !== input.operatorId || pending.scope !== requestedScope ||
          pending.workspaceCwd !== workspaceCwd || pending.chatId !== input.chatId ||
          pending.threadId !== input.threadId) {
        if (pending) clearTimeout(pending.timer);
        this.pending.delete(nonce);
        throw new Error('confirmation expired or no longer matches its original target');
      }
      if (action === 'cancel') {
        clearTimeout(pending.timer);
        this.pending.delete(nonce);
        return { toast: { type: 'info', content: '已取消，绑定和历史均未改变 / Cancelled; binding and history unchanged' } };
      }
      if (action !== 'confirm') throw new Error('unknown session action');
      clearTimeout(pending.timer);
      this.pending.delete(nonce); // one-shot before any asynchronous side effect
      const result = await this.deps.bridge.bindConfirmed({
        scope: pending.scope,
        workspaceCwd: pending.workspaceCwd,
        chatId: pending.chatId,
        ...(pending.threadId ? { threadId: pending.threadId } : {}),
        prepared: pending.prepared,
        ...(this.deps.access.isAdmin(pending.actorId) ? { allowCrossScopeMigration: true } : {}),
        ...(pending.expectedOwner ? { expectedOwner: pending.expectedOwner } : {}),
        onBindingCommitted: () => {
          // ProjectionStore is now the exclusive authority. Switch the legacy
          // run-flow mapping synchronously before any transcript/catch-up I/O.
          this.deps.sessions.clearSessionElsewhere(
            pending.prepared.session.sessionId,
            pending.scope,
            pending.workspaceCwd,
          );
          this.deps.sessions.set(pending.scope, pending.prepared.session.sessionId, pending.workspaceCwd);
        },
      });
      return result.transcriptDelivered
        ? { toast: { type: 'success', content: '绑定完成，历史已回填 / Bound and history backfilled' } }
        : { toast: { type: 'info', content: '绑定完成，但历史卡发送失败；可重新绑定重试 / Bound, but history delivery failed; bind again to retry' } };
    } catch (error) {
      return { toast: { type: 'error', content: error instanceof Error ? error.message : String(error) } };
    }
  }

  rehydrateSessionMappings(): void {
    for (const binding of this.deps.store.list()) {
      this.deps.sessions.clearSessionElsewhere(binding.sessionId, binding.scope, binding.workspaceCwd);
      this.deps.sessions.set(binding.scope, binding.sessionId, binding.workspaceCwd);
    }
  }

  current(scope: string, workspaceCwd: string) {
    return this.deps.store.get(scope, workspaceCwd);
  }

  close(): void {
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
  }

  private async prepareConfirmation(input: {
    sessionId: string;
    identity: SessionActionIdentity;
    chatId: string;
    threadId?: string;
  }): Promise<void> {
    const ownerBeforeRead = this.deps.store.ownerOf(input.sessionId);
    if (ownerBeforeRead && ownerBeforeRead.scope !== input.identity.scope &&
        !this.deps.access.isAdmin(input.identity.actorId)) {
      throw new Error('该 session 已绑定其他飞书 scope；独占迁移仅 profile 管理员可确认');
    }
    const prepared = await this.deps.bridge.prepare(input.sessionId, input.identity.workspaceCwd);
    const owner = this.deps.store.ownerOf(input.sessionId);
    if (owner && owner.scope !== input.identity.scope &&
        !this.deps.access.isAdmin(input.identity.actorId)) {
      throw new Error('该 session 已绑定其他飞书 scope；独占迁移仅 profile 管理员可确认');
    }
    const nonce = randomUUID();
    const expiresAt = Date.now() + (this.deps.confirmationTtlMs ?? 10 * 60_000);
    const timer = setTimeout(() => this.pending.delete(nonce), expiresAt - Date.now());
    timer.unref?.();
    const pending: PendingBinding = {
      nonce,
      actorId: input.identity.actorId,
      scope: input.identity.scope,
      workspaceCwd: input.identity.workspaceCwd,
      chatId: input.chatId,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      prepared,
      ...(owner ? { expectedOwner: { scope: owner.scope, workspaceCwd: owner.workspaceCwd } } : {}),
      expiresAt,
      timer,
    };
    this.pending.set(nonce, pending);
    if (!this.deps.channel.sendCard) throw new Error('当前渠道不支持确认卡片');
    const current = this.deps.store.get(input.identity.scope, input.identity.workspaceCwd);
    await this.deps.channel.sendCard(input.chatId, renderSessionBindingConfirmCard({
      nonce,
      session: prepared.session,
      identity: input.identity,
      backfillCount: prepared.backfillCount,
      ...(current && current.sessionId !== input.sessionId ? { replacesScopeSession: current.sessionId } : {}),
      ...(owner && owner.scope !== input.identity.scope ? { migratesFromScope: owner.scope } : {}),
    }), this.options(input.threadId));
  }

  private requireAuthorized(
    scope: string,
    chatId: string,
    chatMode: 'p2p' | 'group' | 'topic',
    senderId: string | undefined,
  ): string {
    if (!senderId) throw new Error('无法确认操作者身份');
    if (scope !== chatId && !scope.startsWith(`${chatId}:`)) throw new Error('scope 不属于当前聊天');
    const access = this.deps.access.snapshot();
    if (access.allowedUsers.length > 0 && !access.allowedUsers.includes(senderId)) {
      throw new Error('操作者不在当前用户白名单中');
    }
    if (chatMode !== 'p2p' && access.allowedChats.length > 0 && !access.allowedChats.includes(chatId)) {
      throw new Error('当前聊天不在群聊白名单中');
    }
    const memberOwner = memberOwnerForScope(scope, chatId);
    if (memberOwner) {
      if (memberOwner !== senderId) throw new Error('member scope 只能由其本人绑定');
      return senderId;
    }
    if (chatMode === 'p2p') return senderId;
    if (!this.deps.access.isAdmin(senderId)) throw new Error('群聊/话题共享绑定仅管理员可切换');
    return senderId;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [nonce, pending] of this.pending) {
      if (pending.expiresAt <= now) {
        clearTimeout(pending.timer);
        this.pending.delete(nonce);
      }
    }
  }

  private options(threadId: string | undefined): { threadId: string } | undefined {
    return threadId ? { threadId } : undefined;
  }
}
