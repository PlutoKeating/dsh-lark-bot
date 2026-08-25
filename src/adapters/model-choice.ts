/**
 * Resolve the effective model from a bridge-profile preference and the
 * `DSH_LARK_MODEL` env var.
 *
 * A fresh install writes `preferences.model` as the empty string. `??` only
 * falls back on `null`/`undefined`, so `preferences.model ?? env.model` would
 * let the blank string "poison" the config and override the env var, producing
 * an empty `AgentOptions.model` that fails agent startup. Treat a blank
 * preference as unset so it falls back to the env model (issue #112 Bug C).
 */
export function resolveModelChoice(
  preferenceModel: string | undefined,
  envModel: string,
): string {
  return preferenceModel?.trim() || envModel;
}
