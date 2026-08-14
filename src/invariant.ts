/**
 * Package-owned invariant companion for `dsh-lark-bot`, mirroring the
 * `dsh-lark-channel/invariant` ecosystem contract: it reserves package
 * ownership in the host `invariants` registry when a runtime-diagnostics
 * composition is present.
 * @module dsh-lark-bot/invariant
 */
import type { Context } from '@deepseek-ai/cordis';

const PACKAGE_NAME = 'dsh-lark-bot';

/** A package-attributed invariant failure reported by the host registry. */
type InvariantFailure = (message: string) => never;

/** Installer callback accepted by the host's invariant registry. */
type InvariantInstaller = (ctx: Context, fail: InvariantFailure) => void | Promise<void>;

/** Minimal runtime contract used without a host source checkout. */
interface InvariantRegistry {
  register(packageName: string, installer: InvariantInstaller): () => void;
}

/** Cordis companion plugin name. */
export const name = 'dsh-lark-bot-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];

/**
 * No runtime invariant: the bridge's chat→agent bindings are process-local
 * ephemera keyed by host-owned ids; every durable relation they touch is
 * owned by the host session/approval packages.
 */
const install: InvariantInstaller = () => {};

function getInvariantRegistry(ctx: Context): InvariantRegistry {
  const registry = ctx.get('invariants') as InvariantRegistry | undefined;
  if (registry === undefined) {
    throw new Error(`invariant companion requires the "invariants" service for ${PACKAGE_NAME}`);
  }
  return registry;
}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(getInvariantRegistry(ctx).register(PACKAGE_NAME, install));
