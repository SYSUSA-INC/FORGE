/**
 * BL-9 Slice 2b — stable per-user presence color generator.
 *
 * Each collaborator's cursor needs a stable color so a viewer can
 * recognize "that's Alex, that's Jamie" across reconnects, page reloads,
 * and across documents. Random per-session colors confuse users.
 *
 * Deterministic: same userId always returns the same color. Drawn from
 * a palette tuned for visibility against FORGE's dark canvas background
 * (no near-blacks, no low-saturation colors that disappear).
 *
 * Output is a hex string suitable for the TipTap CollaborationCaret
 * `user.color` prop.
 */

const PALETTE = [
  "#F472B6", // pink
  "#22D3EE", // cyan
  "#FBBF24", // amber
  "#A78BFA", // violet
  "#34D399", // emerald
  "#F87171", // rose
  "#60A5FA", // blue
  "#FB923C", // orange
  "#A3E635", // lime
  "#E879F9", // fuchsia
  "#2DD4BF", // teal
  "#FACC15", // yellow
] as const;

/**
 * Hash a userId into a palette slot. djb2 — small, fast, deterministic.
 */
function hashStringToInt(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function pickColorForUser(userId: string): string {
  const idx = hashStringToInt(userId) % PALETTE.length;
  return PALETTE[idx]!;
}
