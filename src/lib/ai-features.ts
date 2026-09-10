/**
 * BL-AI-TELEMETRY — stable feature keys for AI calls.
 *
 * Every completeForTenant call declares which product surface it serves.
 * Keys are stored verbatim in ai_call_log.feature, so treat them as an
 * append-only vocabulary: add new keys freely, never rename one that has
 * shipped (historical rows would orphan). Labels are for the admin UI.
 *
 * No "server-only" here on purpose — this is a pure constants module
 * that both the gateway and UI can import.
 */
export const AI_FEATURES = {
  opportunity_brief: "Opportunity brief",
  pipeline_brief: "Pipeline brief",
  section_draft: "Section draft",
  section_chat: "Section chat",
  proposal_scan: "Health scan (on demand)",
  proposal_scan_background: "Health scan (background)",
  compliance_preflight: "Compliance pre-flight",
  compliance_automap: "Compliance auto-map",
  winner_analysis: "Winner analysis",
  protest_viability: "Protest viability",
  solicitation_extract: "Solicitation extraction",
  solicitation_review: "Solicitation AI review",
  capability_matrix: "Capability matrix",
  question_generator: "Question generator",
  ebuy_extract: "eBuy extraction",
  gsa_extract: "GSA extraction",
  image_ocr: "Image OCR",
  knowledge_classify: "Knowledge classification",
  knowledge_extract: "Knowledge extraction",
  loss_intelligence: "Loss intelligence narrative",
} as const;

export type AiFeature = keyof typeof AI_FEATURES;

/** Human label for a stored feature key; falls back to the raw key. */
export function aiFeatureLabel(key: string): string {
  return (AI_FEATURES as Record<string, string>)[key] ?? key;
}
