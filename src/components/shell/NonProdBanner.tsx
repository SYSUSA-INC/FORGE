/**
 * BL-ENV-SEP — non-prod banner.
 *
 * Renders a thin sticky bar at the top of the app shell whenever
 * `VERCEL_ENV !== "production"` (or `FORGE_ENV_OVERRIDE` is set to a
 * non-prod value). The bar is loud on purpose so anyone testing on
 * staging never confuses it with the live customer environment.
 *
 * Stays hidden in production so customer pages aren't visually
 * polluted.
 *
 * Server component — reads env vars at render time. Cheap.
 */

function currentEnvLabel(): string | null {
  const override = (process.env.FORGE_ENV_OVERRIDE || "").trim().toLowerCase();
  if (override) return override;
  const vercel = (process.env.VERCEL_ENV || "").trim().toLowerCase();
  if (vercel === "preview" || vercel === "development" || vercel === "staging") {
    return vercel;
  }
  return null;
}

export function NonProdBanner() {
  const env = currentEnvLabel();
  if (!env) return null;

  const label =
    env === "preview"
      ? "PREVIEW"
      : env === "development"
        ? "DEV"
        : env.toUpperCase();

  return (
    <div
      role="status"
      aria-label={`${label} environment — not production`}
      className="sticky top-0 z-40 flex h-6 w-full items-center justify-center gap-2 border-b border-amber-400/40 bg-amber-400/15 px-3 font-mono text-[10px] uppercase tracking-[0.25em] text-amber-200"
    >
      <span aria-hidden>⚠</span>
      <span>{label} — not production · data here is disposable</span>
    </div>
  );
}
