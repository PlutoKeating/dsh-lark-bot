export type WizardAnswer = string | string[] | undefined;

export interface WizardData {
  [key: string]: WizardAnswer;
}

export interface WizardState<D extends WizardData = WizardData> {
  /** Wizard flow id (e.g. `provider-add`). */
  flow: string;
  /** Index of the next step to ask; steps beyond the last are finalization. */
  step: number;
  startedAt: number;
  data: D;
}

export const WIZARD_TTL_MS = 30 * 60_000;

/**
 * In-memory per-scope multi-turn wizard state for the interactive
 * provider / model / key management flows (BotFather-style dialogs).
 */
export class WizardStore {
  private readonly wizards = new Map<string, WizardState>();

  get<D extends WizardData = WizardData>(scope: string, now = Date.now()): WizardState<D> | undefined {
    const state = this.wizards.get(scope) as WizardState<D> | undefined;
    if (!state) return undefined;
    if (now - state.startedAt > WIZARD_TTL_MS) {
      this.wizards.delete(scope);
      return undefined;
    }
    return state;
  }

  begin(scope: string, flow: string, data: WizardData = {}): void {
    this.wizards.set(scope, {
      flow,
      step: 0,
      startedAt: Date.now(),
      data,
    });
  }

  set(scope: string, state: WizardState): void {
    this.wizards.set(scope, state);
  }

  clear(scope: string): boolean {
    return this.wizards.delete(scope);
  }
}
