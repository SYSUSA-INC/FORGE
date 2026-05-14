/**
 * Money parse + format helpers. Centralized here so the
 * Opportunities Dashboard widget grid (BL-3), the Pipeline Funnel
 * (BL-4), and any future surface that aggregates opportunity
 * values share the same logic.
 *
 * `valueLow` and `valueHigh` on the opportunities table are free-
 * form strings — users paste "$50,000", "1.2M", "750k", etc. The
 * parse step is forgiving; anything unrecognized returns 0.
 */

export function parseDollars(s: string): number {
  if (!s) return 0;
  const trimmed = s.trim().replace(/[$,]/g, "");
  const m = trimmed.match(/^([\d.]+)\s*([kKmMbB])?$/);
  if (!m) {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : 0;
  }
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return 0;
  const suffix = (m[2] ?? "").toLowerCase();
  if (suffix === "k") return base * 1_000;
  if (suffix === "m") return base * 1_000_000;
  if (suffix === "b") return base * 1_000_000_000;
  return base;
}

export function formatDollars(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

/**
 * Render a low–high range compactly. Collapses to a single number
 * when low and high are equal (or one is zero), and returns null
 * when both are zero so the caller can hide the line entirely.
 */
export function formatDollarRange(low: number, high: number): string | null {
  if (low === 0 && high === 0) return null;
  if (low === 0) return formatDollars(high);
  if (high === 0) return formatDollars(low);
  if (low === high) return formatDollars(low);
  return `${formatDollars(low)} – ${formatDollars(high)}`;
}
