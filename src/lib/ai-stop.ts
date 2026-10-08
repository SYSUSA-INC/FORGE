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

/**
 * BL-STAB-9 — why a structured answer that hit the output ceiling is not
 * used. Said instead of a shape error: a cut-off answer is missing its
 * last fields, which reads as if the model had sent the wrong shape.
 */
export function truncatedAnswerMessage(maxTokens: number | null | undefined): string {
  const limit = maxTokens && maxTokens > 0 ? `${maxTokens.toLocaleString("en-US")}-token ` : "";
  return `The AI's answer was cut off at its ${limit}output limit before it finished.`;
}

/** What the author sees when a draft hit the output ceiling. */
export const TRUNCATED_DRAFT_NOTE =
  "The model hit its output limit before finishing, so this draft is cut short. Accept it as a start, then use Tighten, or split the section.";
