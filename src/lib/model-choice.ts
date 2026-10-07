/**
 * BL-AIX Phase 1i-2 — choosing a candidate model for an eval run without
 * changing any default. Pure.
 *
 * The suggestions are the current Claude line-up plus today's defaults,
 * so a run can be compared against the baseline. On the platform's
 * extraction check any provider model id is accepted as long as it looks
 * like one; the provider rejects an unknown model with a clear error,
 * which the run reports. An organization's golden eval only offers the
 * listed models, on Anthropic, and never overrides a platform pin.
 */
import { isModelClass } from "@/lib/ai-routing";

export const CANDIDATE_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-sonnet-4-6", "claude-haiku-4-5"] as const;

const MODEL_ID = /^[a-z0-9][a-z0-9.:@/_-]{2,99}$/i;

/** A trimmed model id, "" for the default, or null when it cannot be a model id. */
export function cleanModelChoice(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v || v.toLowerCase() === "default") return "";
  return MODEL_ID.test(v) ? v : null;
}

/**
 * Why an organization may not draft its golden eval on `model`, or null
 * when it may. `aiModels` is the tenant's `customOverrides.aiModels`: a
 * literal model there (rather than a class) was pinned by a platform
 * admin, and a candidate run must not route around it.
 */
export function goldenCandidateRefusal(input: {
  model: string;
  provider: string;
  aiModels: Record<string, string> | null | undefined;
}): string | null {
  if (!(CANDIDATE_MODELS as readonly string[]).includes(input.model)) return "Pick one of the listed models.";
  if (input.provider !== "anthropic") return "Candidate models need the Anthropic provider; this deployment uses another.";
  // The drafter's own key first; a class chosen there (or the default,
  // strong) names the class key that could carry the pin instead.
  const byFeature = input.aiModels?.section_draft?.trim() ?? "";
  const byClass = input.aiModels?.[isModelClass(byFeature) ? byFeature : "strong"]?.trim() ?? "";
  const pinned = [byFeature, byClass].some((v) => v && !isModelClass(v));
  return pinned ? "Your drafting model was pinned by a platform admin, so candidate runs are off." : null;
}
