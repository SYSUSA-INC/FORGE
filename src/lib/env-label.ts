/**
 * BL-ENV-SEP — one definition of "which environment is this process".
 *
 * Precedence: `FORGE_ENV_OVERRIDE` (operator-set, any label) →
 * `VERCEL_ENV`. Vercel itself only ever sets production / preview /
 * development; the staging Vercel project sets `VERCEL_ENV=staging` by
 * hand (docs/ENVIRONMENTS.md §4 step 4), so "staging" is a first-class
 * label here. The marker check and the banner used to carry their own
 * copies of this logic and disagreed: the marker did not recognise
 * "staging" and skipped the check on the one environment the guard was
 * built for. Pure; no DB, no server-only, so it can be unit-tested.
 */

export const KNOWN_ENV_LABELS = ["production", "staging", "preview", "development"] as const;
export type KnownEnvLabel = (typeof KNOWN_ENV_LABELS)[number];

export function isKnownEnvLabel(s: string): s is KnownEnvLabel {
  return (KNOWN_ENV_LABELS as readonly string[]).includes(s);
}

/**
 * The runtime's environment label, or null when nothing recognisable is
 * set (a local machine with neither variable). An override is returned
 * as given (lower-cased) so an operator can tag an unusual runtime.
 */
export function resolveEnvLabel(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const override = (env.FORGE_ENV_OVERRIDE || "").trim().toLowerCase();
  if (override) return override;
  const vercel = (env.VERCEL_ENV || "").trim().toLowerCase();
  return isKnownEnvLabel(vercel) ? vercel : null;
}

export function isProductionEnv(env: Record<string, string | undefined> = process.env): boolean {
  return resolveEnvLabel(env) === "production";
}

/** Short banner text for a label. */
export function envDisplayLabel(label: string): string {
  if (label === "development") return "DEV";
  return label.toUpperCase();
}
