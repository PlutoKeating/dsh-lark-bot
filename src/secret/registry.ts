import { randomUUID } from 'node:crypto';

export type SecretTargetType = 'dsh-credential' | 'app-secret';

export interface SecretReceipt {
  ok: boolean;
  target?: SecretTargetType;
  reference?: string;
  configured?: boolean;
  error?: 'invalid-request' | 'forbidden' | 'expired' | 'empty-value' | 'write-failed' | 'cancelled';
}

export interface SecretTargetWriter {
  validate(target: SecretTargetType, reference: string): void;
  set(target: SecretTargetType, reference: string, value: string): Promise<void>;
  remove(target: SecretTargetType, reference: string): Promise<boolean>;
  configured(target: SecretTargetType, reference: string): Promise<boolean>;
}

interface PendingSecret {
  id: string;
  scope: string;
  ownerId: string;
  target: SecretTargetType;
  reference: string;
  purpose: string;
  createdAt: number;
  resolve: (receipt: SecretReceipt) => void;
}

export interface SecretRequestView extends Omit<PendingSecret, 'resolve'> {}

export class SecretRequestRegistry {
  private readonly pending = new Map<string, PendingSecret>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly writer: SecretTargetWriter, options: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60_000;
    this.now = options.now ?? Date.now;
  }

  register(input: Omit<SecretRequestView, 'id' | 'createdAt'>): { id: string; promise: Promise<SecretReceipt> } {
    this.writer.validate(input.target, input.reference);
    const id = `secret-${randomUUID().replaceAll('-', '')}`;
    let resolve!: (receipt: SecretReceipt) => void;
    const promise = new Promise<SecretReceipt>((settle) => { resolve = settle; });
    this.pending.set(`${input.scope}:${id}`, {
      ...input,
      id,
      purpose: input.purpose.trim().slice(0, 500),
      createdAt: this.now(),
      resolve,
    });
    return { id, promise };
  }

  get(scope: string, id: string): SecretRequestView | undefined {
    const pending = this.pending.get(`${scope}:${id}`);
    if (!pending) return undefined;
    const { resolve: _resolve, ...view } = pending;
    return view;
  }

  configured(target: SecretTargetType, reference: string): Promise<boolean> {
    return this.writer.configured(target, reference);
  }

  remove(target: SecretTargetType, reference: string): Promise<boolean> {
    return this.writer.remove(target, reference);
  }

  async submit(input: {
    scope: string; id: string; operatorId: string | undefined; value: string; now?: number;
  }): Promise<SecretReceipt> {
    const key = `${input.scope}:${input.id}`;
    const pending = this.pending.get(key);
    if (!pending) return { ok: false, error: 'invalid-request' };
    if (!input.operatorId || input.operatorId !== pending.ownerId) return { ok: false, error: 'forbidden' };
    if ((input.now ?? this.now()) - pending.createdAt > this.ttlMs) {
      this.pending.delete(key);
      const receipt: SecretReceipt = { ok: false, error: 'expired' };
      pending.resolve(receipt);
      return receipt;
    }
    if (!input.value.trim()) return { ok: false, error: 'empty-value' };
    // Claim before the asynchronous write: duplicate/replayed callbacks fail closed.
    this.pending.delete(key);
    let receipt: SecretReceipt;
    try {
      await this.writer.set(pending.target, pending.reference, input.value);
      receipt = { ok: true, target: pending.target, reference: pending.reference, configured: true };
    } catch {
      // Never propagate storage errors: an upstream error may echo the supplied value.
      receipt = { ok: false, target: pending.target, reference: pending.reference, configured: false, error: 'write-failed' };
    }
    pending.resolve(receipt);
    return receipt;
  }

  cancel(scope: string, id: string, operatorId?: string): SecretReceipt {
    const key = `${scope}:${id}`;
    const pending = this.pending.get(key);
    if (!pending) return { ok: false, error: 'invalid-request' };
    if (operatorId !== undefined && operatorId !== pending.ownerId) return { ok: false, error: 'forbidden' };
    this.pending.delete(key);
    const receipt: SecretReceipt = { ok: false, target: pending.target, reference: pending.reference, configured: false, error: 'cancelled' };
    pending.resolve(receipt);
    return receipt;
  }
}
