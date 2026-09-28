"use server";

import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { enforceRateLimit } from "@/lib/rate-limit";
import { gatherResearchForSection, type ResearchRailResult } from "@/lib/research-rail";

export type { ResearchRailResult } from "@/lib/research-rail";

export type ResearchActionResult =
  | { ok: true; data: ResearchRailResult }
  | { ok: false; error: string };

/** Section text the rail may send; the route caps live bodies the same way. */
const MAX_TEXT_CHARS = 60_000;

/**
 * BL-AIP-6 — research-while-you-write lookup for one section. Called on
 * a client-side debounce; rate-limited per user so a runaway tab cannot
 * burn embedding calls.
 */
export async function researchForSectionAction(
  sectionId: string,
  input: { text: string; focus: string },
): Promise<ResearchActionResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const limit = await enforceRateLimit({
    key: `research:user:${user.id}`,
    limit: 40,
    windowSeconds: 600,
  });
  if (!limit.ok) {
    return { ok: false, error: `Research is paused for ${Math.ceil(limit.retryAfter / 60)} min (rate limit).` };
  }

  const data = await gatherResearchForSection({
    organizationId,
    sectionId,
    text: (input.text ?? "").slice(0, MAX_TEXT_CHARS),
    focus: (input.focus ?? "").slice(0, 2_000),
  });
  if (!data) return { ok: false, error: "Section not found." };
  return { ok: true, data };
}
