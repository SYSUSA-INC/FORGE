/**
 * BL-AIX Phase 1b — the prompt revision behind every AI feature.
 *
 * The gateway stores the feature's version on every ai_call_log row (a
 * caller may still pass its own), so a prompt change can be compared
 * with the one before it in telemetry, golden evals and acceptance
 * rates.
 *
 * Bump a feature's version whenever what the model reads changes: its
 * system prompt, its instructions, the layout of the context it is given,
 * or the quoted-material rule the gateway appends to every system prompt.
 * tests/ai/prompt-versions.test.ts renders every prompt from fixed
 * fixtures and fails when one changes without its version moving.
 *
 * Format: the date of the change plus a same-day counter. A version that
 * has shipped is never reused for different text. Pure constants; the
 * gateway and the prompt builders both import it.
 */
import type { AiFeature } from "@/lib/ai-features";

/** Embedding calls send no prompt; their model and dimensions are recorded instead. */
export type PromptedFeature = Exclude<AiFeature, "embedding" | "embedding_query">;

export const PROMPT_VERSIONS: Record<PromptedFeature, string> = {
  opportunity_brief: "2026-09-28.1",
  pipeline_brief: "2026-09-28.1",
  section_draft: "2026-10-04.2",
  section_chat: "2026-10-05.1",
  proposal_scan: "2026-10-05.1",
  proposal_scan_background: "2026-10-05.1",
  compliance_preflight: "2026-10-05.1",
  compliance_automap: "2026-10-05.1",
  winner_analysis: "2026-10-05.1",
  protest_viability: "2026-10-05.1",
  solicitation_extract: "2026-10-05.1",
  solicitation_review: "2026-10-05.1",
  capability_matrix: "2026-10-05.1",
  question_generator: "2026-10-05.1",
  ebuy_extract: "2026-10-05.1",
  gsa_extract: "2026-10-05.1",
  image_ocr: "2026-10-05.1",
  knowledge_classify: "2026-10-05.1",
  knowledge_extract: "kb-extract-v1",
  loss_intelligence: "2026-10-05.1",
  review_preflight: "2026-10-05.1",
  proposal_bootstrap: "2026-09-28.1",
  opportunity_triage: "2026-09-29.1",
  brain_answer: "2026-10-05.1",
  onboarding_assist: "2026-10-01.1",
  graphics_suggest: "2026-10-03.1",
  review_summary: "2026-10-03.1",
};

/** The version the gateway records for a feature; "" for one that sends no prompt. */
export function promptVersionFor(feature: AiFeature): string {
  return (PROMPT_VERSIONS as Record<string, string>)[feature] ?? "";
}
