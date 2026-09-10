import { envDisplayLabel, resolveEnvLabel } from "@/lib/env-label";

/**
 * BL-ENV-SEP — non-prod banner.
 *
 * Renders a thin sticky bar at the top of the app shell whenever the
 * runtime's environment label is anything other than "production"
 * (staging, preview, development, or an operator override). The bar is
 * loud on purpose so anyone testing on staging never confuses it with
 * the live customer environment.
 *
 * Stays hidden in production so customer pages aren't visually
 * polluted, and when no label is set at all (a bare local run).
 *
 * Server component — reads env vars at render time via the same
 * resolver the boot-time marker check uses. Cheap.
 */
export function NonProdBanner() {
  const env = resolveEnvLabel();
  if (!env || env === "production") return null;

  const label = envDisplayLabel(env);

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
