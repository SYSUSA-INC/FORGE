/**
 * BL-9 Slice 2b — stable per-user presence color generator.
 *
 * Each collaborator's cursor needs a stable color so a viewer can
 * recognize "that's Alex, that's Jamie" across reconnects, page reloads,
 * and across documents. Random per-session colors confuse users.
 *
 * Deterministic: same userId always returns the same color. Drawn from
 * the theme's presence palette (src/lib/theme-colors.ts), tuned for
 * visibility against FORGE's navy canvas.
 *
 * Output is a hex string suitable for the TipTap CollaborationCaret
 * `user.color` prop.
 */

import { PRESENCE_PALETTE } from "@/lib/theme-colors";

const PALETTE = PRESENCE_PALETTE;

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
