/**
 * BL-AIP-5 — provider stop reasons.
 *
 * The gateway has always captured `stopReason` and nothing read it, so a
 * draft or an extraction cut at `max_tokens` looked like a finished one.
 * Pure helpers so callers can branch without knowing each provider's
 * vocabulary (Anthropic: "max_tokens"; OpenAI-compatible: "length").
 */

export function isTruncatedStop(stopReason: string | null | undefined): boolean {
  if (!stopReason) return false;
  const s = stopReason.toLowerCase();
  return s === "max_tokens" || s === "length" || s === "max_output_tokens";
}

/** What the author sees when a draft hit the output ceiling. */
export const TRUNCATED_DRAFT_NOTE =
  "The model hit its output limit before finishing, so this draft is cut short. Accept it as a start, then use Tighten, or split the section.";
