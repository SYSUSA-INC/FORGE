"use server";

import { requireCurrentOrg } from "@/lib/auth-helpers";
import { answerFromBrain } from "@/lib/brain-answer";
import { canSearch, type BrainAnswerResult, type PaletteRecord } from "@/lib/palette";
import { searchWorkspace } from "@/lib/palette-search";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * BL-AIP-7d — the ⌘K palette's server side. Both actions read as the
 * session's current organization; any member may search and ask, since
 * both only surface what the member could already open.
 */

/** Records of the workspace matching the text, a few per kind. */
export async function paletteSearchAction(
  query: string,
): Promise<{ ok: true; results: PaletteRecord[] } | { ok: false; error: string }> {
  const { organizationId } = await requireCurrentOrg();
  const q = String(query ?? "").slice(0, 200);
  if (!canSearch(q)) return { ok: true, results: [] };
  try {
    const results = await searchWorkspace({ organizationId, query: q, limit: 4 });
    return { ok: true, results };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Search failed." };
  }
}

/** Questions per tenant per hour from the palette. */
const ASK_RATE_LIMIT = { limit: 60, windowSeconds: 3600 };

/** A question answered from the organization's Brain, with citations. */
export async function askBrainAction(question: string): Promise<BrainAnswerResult> {
  const { user, organizationId } = await requireCurrentOrg();
  const limit = await enforceRateLimit({ key: `brain-answer:${organizationId}`, ...ASK_RATE_LIMIT });
  if (!limit.ok) {
    return {
      ok: false,
      error: `Question limit reached (${ASK_RATE_LIMIT.limit}/hour per organization). Retry in ${Math.ceil(limit.retryAfter / 60)} min.`,
    };
  }
  try {
    return await answerFromBrain({
      organizationId,
      question: String(question ?? ""),
      actor: { userId: user.id, email: user.email },
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The Brain could not answer." };
  }
}
