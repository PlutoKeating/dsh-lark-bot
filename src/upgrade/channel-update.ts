import { randomUUID } from 'node:crypto';
import type { GuardianUpdateHandoff, GuardianUpdateRoute } from '../guardian/update-handoff.js';
import { currentVersion, isNewer, latestVersion } from './update-check.js';

const OFFER_TTL_MS = 10 * 60_000;

export type ChannelUpdateCheck =
  | { kind: 'current'; current: string; latest: string }
  | { kind: 'unavailable'; current: string }
  | { kind: 'available'; current: string; latest: string; offerId: string };

export type ChannelUpdateDecision =
  | { kind: 'cancelled' }
  | { kind: 'stale' }
  | { kind: 'busy'; updateId: string }
  | { kind: 'started'; updateId: string; targetVersion: string };

export interface ChannelUpdateControllerOptions {
  current?: string;
  probe?: () => Promise<string | undefined>;
  handoff: Pick<GuardianUpdateHandoff, 'start'>;
  id?: () => string;
  now?: () => number;
  offerTtlMs?: number;
}

interface Offer {
  scope: string;
  actorId: string;
  targetVersion: string;
  expiresAt: number;
}

/** Owner-bound confirmation offers over the durable guardian handoff. */
export class ChannelUpdateController {
  private readonly offers = new Map<string, Offer>();
  private readonly current: string;
  private readonly probe: () => Promise<string | undefined>;
  private readonly id: () => string;
  private readonly now: () => number;
  private readonly ttl: number;

  constructor(private readonly options: ChannelUpdateControllerOptions) {
    this.current = options.current ?? currentVersion();
    this.probe = options.probe ?? (() => latestVersion({ cacheMs: 0 }));
    this.id = options.id ?? randomUUID;
    this.now = options.now ?? Date.now;
    this.ttl = options.offerTtlMs ?? OFFER_TTL_MS;
  }

  async check(input: { scope: string; actorId: string }): Promise<ChannelUpdateCheck> {
    const latest = await this.probe();
    if (latest === undefined) return { kind: 'unavailable', current: this.current };
    if (!isNewer(latest, this.current)) {
      return { kind: 'current', current: this.current, latest };
    }
    const offerId = this.id();
    this.offers.set(offerId, {
      scope: input.scope,
      actorId: input.actorId,
      targetVersion: latest,
      expiresAt: this.now() + this.ttl,
    });
    return { kind: 'available', current: this.current, latest, offerId };
  }

  async decide(input: {
    offerId: string;
    scope: string;
    actorId: string;
    decision: 'confirm' | 'cancel';
    route: GuardianUpdateRoute;
  }): Promise<ChannelUpdateDecision> {
    const offer = this.offers.get(input.offerId);
    if (
      !offer ||
      offer.scope !== input.scope ||
      offer.actorId !== input.actorId ||
      offer.expiresAt < this.now()
    ) {
      return { kind: 'stale' };
    }
    this.offers.delete(input.offerId);
    if (input.decision === 'cancel') return { kind: 'cancelled' };
    const started = await this.options.handoff.start(offer.targetVersion, input.route);
    return started.accepted
      ? { kind: 'started', updateId: started.id, targetVersion: offer.targetVersion }
      : { kind: 'busy', updateId: started.id };
  }
}
