import { z } from "zod";
import type { AIMessage } from "@/lib/ai";

// BL-23 prompts live in a sibling file; re-exported here so call
// sites can import everything ai-prompt-related from one place.
export {
  buildCapabilityMatrixPrompt,
  buildQuestionGeneratorPrompt,
  buildSolicitationReviewPrompt,
  capabilityMatrixSchema,
  questionSetSchema,
  solicitationReviewSchema,
  type CapabilityMatrixVerdict,
  type QuestionSetVerdict,
  type SolicitationReviewVerdict,
} from "@/lib/ai-prompts-bl23";

export type SolicitationExtractionResult = {
  title: string;
  agency: string;
  office: string;
  solicitationNumber: string;
  type: "rfp" | "rfi" | "rfq" | "sources_sought" | "other";
  naicsCode: string;
  setAside: string;
  responseDueDate: string | null;
  sectionLSummary: string;
  sectionMSummary: string;
  requirements: { kind: "shall" | "should" | "may"; text: string; ref: string }[];
};

const SOLICITATION_EXTRACT_SYSTEM = `You are a federal solicitation analyst inside FORGE — a proposal operations platform. You read raw RFP/RFI/RFQ/SS text and return structured facts as strict JSON.

Rules:
- Return ONLY a single JSON object matching the schema below. No commentary, no markdown fences.
- Use empty string "" for any field you cannot find. Use null for missing dates.
- Date format: YYYY-MM-DD. Convert any encountered date format to that.
- Type must be one of: rfp, rfi, rfq, sources_sought, other.
- Requirement kind must be one of: shall, should, may.
- Each requirement.ref should be a section reference if available (e.g., "L.5.2.1", "M-1", "C.3"); otherwise empty string.
- Limit requirements to the 25 most important shall/should/may statements you can find. Prefer Section L (instructions) and Section M (evaluation criteria) over Section C boilerplate.
- Section L summary: 2–4 sentences describing what offerors must submit, page caps, and format requirements you found.
- Section M summary: 2–4 sentences describing evaluation factors and weights you found.
- If the document is clearly not a federal solicitation, set title to "" and return mostly empty fields.

Schema:
{
  "title": string,
  "agency": string,
  "office": string,
  "solicitationNumber": string,
  "type": "rfp" | "rfi" | "rfq" | "sources_sought" | "other",
  "naicsCode": string,
  "setAside": string,
  "responseDueDate": string | null,
  "sectionLSummary": string,
  "sectionMSummary": string,
  "requirements": [{ "kind": "shall" | "should" | "may", "text": string, "ref": string }]
}`;

export function buildSolicitationExtractPrompt(
  rawText: string,
): { system: string; messages: AIMessage[] } {
  // Trim to a manageable size — first 80k chars covers the front matter
  // (cover sheet + Section L + Section M) of nearly every RFP.
  const trimmed = rawText.slice(0, 80_000);
  const userPrompt = [
    `Extract structured facts from the following solicitation text.`,
    ``,
    `Raw text:`,
    "```",
    trimmed,
    "```",
    ``,
    rawText.length > trimmed.length
      ? `(Text was trimmed from ${rawText.length} chars to first ${trimmed.length}.)`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    system: SOLICITATION_EXTRACT_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  };
}

/**
 * Vision-mode variant. The PDF bytes are attached as a document block on
 * the user turn (handled by the AI gateway). The model OCRs the document
 * directly — used as a fallback when pdf-parse returns no text.
 */
export function buildSolicitationVisionPrompt(): {
  system: string;
  messages: AIMessage[];
} {
  const userPrompt = [
    `The attached PDF is a federal solicitation. The document may be a scanned image,`,
    `a mixed text/image PDF, or a born-digital PDF whose text layer is unreadable.`,
    `Read the document directly and extract structured facts per the schema in the system prompt.`,
    ``,
    `Return ONLY the JSON object. No commentary.`,
  ].join(" ");
  return {
    system: SOLICITATION_EXTRACT_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  };
}

export type EbuyExtractionResult = {
  title: string;
  rfqNumber: string;
  /** Buying agency for which GSA is fronting the RFQ (e.g., "Department of Veterans Affairs"). */
  buyingAgency: string;
  /** GSA contract vehicle the RFQ runs against (e.g., "MAS", "Polaris", "OASIS+"). */
  vehicle: string;
  naicsCode: string;
  setAside: string;
  /** ISO date YYYY-MM-DD of when quotes are due, or null. */
  responseDueDate: string | null;
  placeOfPerformance: string;
  /** Summary of the work scope — 2-4 sentences. */
  scopeSummary: string;
  /** Bulleted CLIN / line-item summary or "" if none parseable. */
  clinSummary: string;
  /** Free-text notes the model thinks the buyer should know (page caps, eval criteria, etc.). */
  notes: string;
};

const EBUY_EXTRACT_SYSTEM = `You are an analyst inside FORGE — a federal proposal operations platform — reading a GSA eBuy RFQ that a Schedule holder has pasted in. The text may be the RFQ description copied from eBuy, the body of a forwarded eBuy notification email, or a mix.

Return ONLY a single JSON object matching the schema below. No commentary, no markdown fences.

Rules:
- Use empty string "" for any field you cannot find. Use null for missing dates.
- Date format: YYYY-MM-DD. Convert any encountered date format to that.
- buyingAgency: the agency the GOODS or SERVICES are FOR — not GSA itself unless GSA is the literal end user. eBuy RFQs are typically posted by an Ordering Agency that bought through GSA's vehicles.
- vehicle: identify the GSA vehicle if mentioned (MAS, OASIS+, Polaris, Alliant 2, STARS III, VETS 2, EIS, 2GIT, ASCEND). Use "MAS" if it's an unnamed Schedule order. Use "" if you genuinely can't tell.
- naicsCode: 6-digit NAICS if present; otherwise "".
- setAside: e.g., "Total Small Business", "8(a)", "WOSB", "SDVOSB", "HUBZone", "Unrestricted", or "".
- scopeSummary: 2–4 sentences in plain prose describing what's being bought. No marketing language.
- clinSummary: bulleted CLINs if present (use "- " prefix on each line). Otherwise "".
- notes: short list of anything a quoter must know (page caps, evaluation factors, period of performance, ROM/firm-fixed-price hints, security requirements). Free text, 1-3 sentences.
- If the text is clearly NOT an RFQ (e.g., admin email, unrelated content), set title to "" and return mostly empty fields.

Schema:
{
  "title": string,
  "rfqNumber": string,
  "buyingAgency": string,
  "vehicle": string,
  "naicsCode": string,
  "setAside": string,
  "responseDueDate": string | null,
  "placeOfPerformance": string,
  "scopeSummary": string,
  "clinSummary": string,
  "notes": string
}`;

export function buildEbuyExtractPrompt(rawText: string): {
  system: string;
  messages: AIMessage[];
} {
  // eBuy RFQ bodies are short — 30k chars covers any realistic paste.
  const trimmed = rawText.slice(0, 30_000);
  const userPrompt = [
    `Extract structured facts from this eBuy RFQ text:`,
    "```",
    trimmed,
    "```",
  ].join("\n");
  return {
    system: EBUY_EXTRACT_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  };
}

// ────────────────────────────────────────────────────────────────────
// GSA email paste — broader than eBuy.
//
// Handles any forwarded GSA email about an upcoming or open
// contracting opportunity. eBuy is one source; others include GSA
// Schedule sub-CO notifications, OASIS+ task order announcements,
// Polaris/Alliant 2/STARS III RFP forwards, sources sought emails,
// and so on. The output shape mirrors eBuy where possible but adds
// `noticeType` so downstream code can branch on RFP vs RFQ vs RFI.
// ────────────────────────────────────────────────────────────────────

export type GsaExtractionResult = {
  title: string;
  /** "rfp" | "rfq" | "rfi" | "sources_sought" | "task_order" | "other" */
  noticeType: string;
  /** RFQ / RFP / solicitation number, if surfaced. */
  solicitationNumber: string;
  /** End customer agency the goods/services are for. */
  buyingAgency: string;
  office: string;
  /** GSA vehicle if mentioned (MAS, Polaris, OASIS+, etc.). "" if unclear. */
  vehicle: string;
  naicsCode: string;
  setAside: string;
  /** YYYY-MM-DD or null. */
  responseDueDate: string | null;
  placeOfPerformance: string;
  /** 2-4 sentence scope summary. */
  scopeSummary: string;
  /** Free-text notes — page caps, evaluation criteria, security clearance, etc. */
  notes: string;
};

const GSA_EXTRACT_SYSTEM = `You are an analyst inside FORGE — a federal proposal operations platform — reading a forwarded email from GSA that announces a contracting opportunity. The email may be:

- A GSA eBuy RFQ description copy or notification
- A GSA Schedule sub-CO opportunity forward
- An OASIS+, Polaris, Alliant 2, STARS III, VETS 2, EIS, 2GIT, or ASCEND task order announcement
- A sources sought / RFI from any GSA-fronted vehicle
- A general GSA acquisition email pointing the recipient at a SAM.gov or eBuy posting

Return ONLY a single JSON object matching the schema below. No commentary, no markdown fences.

Rules:
- Use empty string "" for any field you cannot find. Use null for missing dates.
- Date format: YYYY-MM-DD. Convert any encountered date format to that.
- noticeType: one of "rfp", "rfq", "rfi", "sources_sought", "task_order", "other". Choose based on the email's strongest signal — if the email says "RFQ" use "rfq", if it says "Sources Sought" use "sources_sought", if uncertain use "other".
- buyingAgency: the agency the goods/services are FOR. NOT GSA itself unless GSA is the literal end user. GSA is almost always just the contracting vehicle host.
- office: sub-organization within the buying agency if mentioned (e.g. "PEO EIS", "VA OIT").
- vehicle: identify the GSA vehicle if mentioned (MAS, OASIS+, Polaris, Alliant 2, STARS III, VETS 2, EIS, 2GIT, ASCEND). Use "MAS" if it's an unnamed Schedule order. Use "" if the email doesn't reference a specific vehicle.
- naicsCode: 6-digit NAICS if present; otherwise "".
- setAside: "Total Small Business", "8(a)", "WOSB", "SDVOSB", "HUBZone", "Unrestricted", or "".
- scopeSummary: 2–4 sentences in plain prose describing what's being bought. No marketing language. If the email is just a notification with no scope detail, summarize what the recipient is being told to expect (e.g. "GSA notifies SCHEDULE holders that VA is releasing an RFQ for cloud migration services next week.")
- notes: short list of anything a quoter must know — page caps, evaluation factors, period of performance, security/clearance requirements, ROM/firm-fixed-price hints, key dates other than the response due date. 1-3 sentences.
- If the email is clearly NOT an opportunity announcement (admin email, password reset, unrelated content), set title to "" and return mostly empty fields.

Schema:
{
  "title": string,
  "noticeType": "rfp" | "rfq" | "rfi" | "sources_sought" | "task_order" | "other",
  "solicitationNumber": string,
  "buyingAgency": string,
  "office": string,
  "vehicle": string,
  "naicsCode": string,
  "setAside": string,
  "responseDueDate": string | null,
  "placeOfPerformance": string,
  "scopeSummary": string,
  "notes": string
}`;

export function buildGsaExtractPrompt(rawText: string): {
  system: string;
  messages: AIMessage[];
} {
  const trimmed = rawText.slice(0, 50_000);
  const userPrompt = [
    `Extract structured fields from the following forwarded GSA email.`,
    ``,
    `Email body:`,
    "```",
    trimmed,
    "```",
    rawText.length > trimmed.length
      ? `(Email was trimmed from ${rawText.length} chars to first ${trimmed.length}.)`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    system: GSA_EXTRACT_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  };
}

export type SectionDraftMode = "draft" | "improve" | "tighten";

/**
 * Phase 14d — pattern intel attached to the snapshot.
 *
 * The drafter reads:
 *   - winningPatterns:  top corpus excerpts from won proposals matching
 *                       this section kind (filtered by Phase 14a outcome)
 *   - lostPatterns:     a smaller sample from lost proposals so the
 *                       model can avoid repeating known-bad phrasing
 *   - complianceGaps:   pre-flight (Phase 14c) verdicts for items
 *                       mapped to this section that are not_addressed
 *                       or partial — the draft MUST address these
 *   - sectionSignal:    Phase 14b pass-rate for this section kind in
 *                       wins vs losses, so the model knows where the
 *                       reviewer bar sits
 */
export type SectionDraftPatternIntel = {
  winningPatterns: { excerpt: string; provenance: string }[];
  lostPatterns: { excerpt: string }[];
  complianceGaps: {
    requirementNumber: string;
    requirementText: string;
    gap: string;
    suggestion: string;
  }[];
  sectionSignal: {
    wonPassRate: number | null;
    lostPassRate: number | null;
    sampleSize: number;
  } | null;
};

export type SectionDraftSnapshot = {
  organizationName: string;
  proposal: {
    title: string;
    agency: string;
    solicitationNumber: string;
    naicsCode: string;
    setAside: string;
    incumbent: string;
    opportunityDescription: string;
  };
  section: {
    title: string;
    kind: string;
    pageLimit: number | null;
    currentBodyPlain: string;
    currentWordCount: number;
  };
  pastPerformance: {
    customer: string;
    contract: string;
    description: string;
  }[];
  /** Phase 14d — optional. Drafter falls back to non-pattern-guided when omitted. */
  patternIntel?: SectionDraftPatternIntel;
};

const SECTION_DRAFT_SYSTEM = `You are an embedded proposal writer inside FORGE — a federal proposal operations platform. You produce compliance-grade prose that reads like an experienced capture lead wrote it.

Style rules:
- Plain prose. No markdown headings, no bullet markers like "*". Use real paragraphs and, when appropriate, indented sub-points.
- Speak with confidence and specificity. Avoid filler ("we are pleased to", "world-class", "best-in-class", "robust").
- Match section conventions: Executive Summary → 1–2 punchy paragraphs; Technical → numbered approach steps + how-it-mitigates-risk; Management → roles + governance + risk register; Past Performance → CPARS-style references; Pricing → assumptions + cost model; Compliance → traceability statements.
- Cite the customer (agency, office, mission) and the solicitation number when context is provided.
- Reuse facts from the snapshot exactly as given. Do NOT invent contract numbers, dates, dollar values, customer names, or staff bios.
- If the snapshot is sparse, write what you can with general best practices and explicitly mark TBD placeholders in [BRACKETS] for the human author to fill.

Phase 14d — pattern guidance:
- When the snapshot includes \`patternIntel.winningPatterns\`, treat them as known-effective shapes for THIS section kind on similar work. Internalize their structure, level of specificity, and tone. Do NOT copy sentences verbatim — paraphrase and adapt to the current opportunity's facts.
- When \`patternIntel.lostPatterns\` is present, those are excerpts from past losses. Avoid the patterns they exhibit (vague verbs, missing metrics, generic capability claims).
- When \`patternIntel.complianceGaps\` is non-empty, every entry MUST be addressed in the draft. For each gap, write a concrete sentence or paragraph that satisfies the requirement. Reference the requirement number inline in [BRACKETS] so the reviewer can see traceability — e.g. "[L.5.2.1]".
- When \`patternIntel.sectionSignal\` shows the won pass rate is well above the lost pass rate for this section kind, hold the bar high — the reviewer rubric is reliable here. When the deltas are negligible, the rubric isn't predictive, so prioritize crisp specificity over rubric-speak.`;

const MODE_INSTRUCTIONS: Record<SectionDraftMode, string> = {
  draft:
    "The author wants a fresh first draft. Use the section's title and kind plus the proposal context to produce a complete draft suitable as a starting point. Aim for the section's page cap if one is given (assume 350 words/page for prose sections).",
  improve:
    "The author has a draft and wants you to strengthen it. Keep the structure but tighten the prose, add specificity, surface win themes, and fix weak phrasing. Do NOT change facts. Preserve TBD placeholders in [BRACKETS] when present.",
  tighten:
    "The author needs the draft reduced to fit. Cut filler aggressively, merge paragraphs, remove redundant sentences. Preserve every concrete fact, citation, and number. Aim for the section's page cap if one is given (assume 350 words/page).",
};

export function buildSectionDraftPrompt(
  mode: SectionDraftMode,
  snapshot: SectionDraftSnapshot,
): { system: string; messages: AIMessage[] } {
  const userPrompt = [
    `Mode: ${mode}.`,
    MODE_INSTRUCTIONS[mode],
    ``,
    `Section + proposal snapshot (JSON):`,
    "```json",
    JSON.stringify(snapshot, null, 2),
    "```",
    ``,
    mode === "draft"
      ? `Produce the section body. Output ONLY the body text — no title, no preamble, no commentary about your process.`
      : mode === "improve"
        ? `Return the improved body. Output ONLY the body text — no diff, no commentary about what you changed.`
        : `Return the tightened body. Output ONLY the body text — no commentary about what you cut.`,
  ].join("\n");

  return {
    system: SECTION_DRAFT_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  };
}

export type PipelineSnapshot = {
  organizationName: string;
  asOf: string;
  opportunities: {
    total: number;
    byStage: Record<string, number>;
    topByPwin: {
      title: string;
      agency: string;
      stage: string;
      pwin: number | null;
      dueDate: string | null;
    }[];
    upcomingDueWithin14Days: {
      title: string;
      agency: string;
      dueDate: string;
    }[];
  };
  proposals: {
    total: number;
    byStage: Record<string, number>;
    inActiveReview: number;
  };
};

const PIPELINE_BRIEF_SYSTEM = `You are an analyst inside FORGE — a federal proposal operations platform. You write concise, candid daily briefs for capture and proposal leaders.

Style rules:
- 4–7 sentences max. Plain prose. No markdown headings, no bullet points.
- Lead with the most important thing the leader needs to act on this week.
- Cite specific pursuits by title when calling them out.
- Note risks frankly: late-stage opportunities with no proposal, proposals stuck in a single stage, missing PWin.
- Do NOT invent numbers. Only use figures present in the snapshot.
- Do NOT use governance/risk/compliance jargon. Speak in capture language: pursuit, capture, color team, Section M, gate.
- If the snapshot is empty (no opportunities), explain there's nothing to brief on yet and suggest seeding pursuits via /opportunities/import.`;

export type OpportunitySnapshot = {
  organizationName: string;
  asOf: string;
  opportunity: {
    title: string;
    agency: string;
    office: string;
    stage: string;
    solicitationNumber: string;
    naicsCode: string;
    pscCode: string;
    setAside: string;
    contractType: string;
    placeOfPerformance: string;
    incumbent: string;
    valueLow: string;
    valueHigh: string;
    pwin: number;
    daysToDue: number | null;
    description: string;
  };
  evaluation: {
    rollupScore: number | null;
    strategicFit: number | null;
    customerRelationship: number | null;
    competitivePosture: number | null;
    resourceAvailability: number | null;
    financialAttractiveness: number | null;
    rationale: string;
  } | null;
  competitors: {
    name: string;
    isIncumbent: boolean;
    strengths: string;
    weaknesses: string;
    notes: string;
  }[];
  recentActivity: {
    kind: string;
    title: string;
    body: string;
    daysAgo: number;
  }[];
};

const OPPORTUNITY_BRIEF_SYSTEM = `You are an analyst inside FORGE — a federal proposal operations platform. You write concise, candid pursuit briefs for capture and proposal leaders thinking about a single opportunity.

Style rules:
- 5–8 sentences max. Plain prose. No markdown headings, no bullets.
- Lead with one of three takes: "strong pursue", "watch", or "consider no-bid", and tie it to one or two specific signals from the snapshot.
- Reference concrete numbers (PWin, evaluation dimension scores, days-to-due, value range) when they're present and meaningful.
- Call out incumbents and named competitors by name when present.
- Note the most recent activity if it's within 7 days; mention if the deal has been quiet for >14 days.
- Do NOT invent numbers, dates, or competitor names that aren't in the snapshot.
- Do NOT use governance/risk/compliance jargon. Speak in capture language: pursuit, capture, gate, Section M, set-aside, NAICS.
- If the snapshot is sparse (no evaluation, no competitors, no activity), say so honestly and suggest the next concrete step (e.g., "run a qualification scorecard", "log a call with the customer", "identify the incumbent").`;

export function buildOpportunityBriefPrompt(
  snapshot: OpportunitySnapshot,
): { system: string; messages: AIMessage[] } {
  const userPrompt = [
    `Write a pursuit brief for ${snapshot.organizationName} as of ${snapshot.asOf}.`,
    ``,
    `Opportunity snapshot (JSON):`,
    "```json",
    JSON.stringify(snapshot, null, 2),
    "```",
    ``,
    `Brief should help the leader decide whether to keep pushing on this pursuit, change the approach, or walk.`,
  ].join("\n");

  return {
    system: OPPORTUNITY_BRIEF_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  };
}

export function buildPipelineBriefPrompt(
  snapshot: PipelineSnapshot,
): { system: string; messages: AIMessage[] } {
  const userPrompt = [
    `Write a pipeline brief for ${snapshot.organizationName} as of ${snapshot.asOf}.`,
    ``,
    `Snapshot (JSON):`,
    "```json",
    JSON.stringify(snapshot, null, 2),
    "```",
    ``,
    `Brief should help the reader decide what to chase, what to abandon, and what's at risk this week.`,
  ].join("\n");

  return {
    system: PIPELINE_BRIEF_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  };
}

/**
 * Phase 10c — Brain knowledge extraction.
 *
 * Reads an artifact's raw text and proposes structured KB candidates
 * across the four kinds: capability, past_performance, personnel,
 * boilerplate. The model is told to be conservative — better to
 * propose nothing than to fabricate. Each candidate carries the
 * artifact text excerpt that supported it so reviewers can verify.
 */
export type KnowledgeKindEnumLike =
  | "capability"
  | "past_performance"
  | "personnel"
  | "boilerplate";

export type KnowledgeExtractionCandidateOutput = {
  kind: KnowledgeKindEnumLike;
  title: string;
  body: string;
  tags: string[];
  sourceExcerpt: string;
  metadata?: Record<string, string | number | boolean>;
};

export type KnowledgeExtractionPromptResult = {
  candidates: KnowledgeExtractionCandidateOutput[];
  notes: string;
};

const KNOWLEDGE_EXTRACT_SYSTEM = `You are an analyst inside FORGE — a federal proposal operations platform — building "corporate memory". You read a single artifact (an old proposal, RFP we responded to, contract, debrief, capability brief, resume, brochure, white paper, technical note, etc.) and propose structured knowledge entries the company should keep in its searchable knowledge base.

You are STRICT and CONSERVATIVE. It is far better to propose nothing than to fabricate facts. Every candidate must trace back to evidence in the artifact text via the sourceExcerpt field.

Output ONLY a single JSON object matching the schema below. No commentary, no markdown fences, no preamble.

Four candidate kinds:
- "capability" — descriptions of what the company does (services, tech stacks, methodologies, certifications, compliance work). Title should be a short capability label ("Cloud migration to AWS GovCloud", "Zero-trust architecture for shipboard C5ISR"). Body 2-5 sentences in the company voice.
- "past_performance" — references to specific past contracts. Title should be the contract or customer name. Body must include at least one of: customer/agency, contract or PIID number, period of performance, value, or scope. If the artifact only mentions a contract by name without details, propose with what you have but mark missing fields in metadata.
- "personnel" — named key staff. Title is the person's name. Body is their role, qualifications, certifications, clearances. Only propose when an actual name is present in the text.
- "boilerplate" — reusable corporate text blocks (corporate intro, mission statement, security overview, EEO statement, Section 508 commitment, quality management approach). Title is a short label; body is the actual reusable text, lightly cleaned up.

Rules:
- Propose AT MOST 12 candidates total per artifact. Pick the highest-value ones.
- Each candidate's sourceExcerpt MUST be a verbatim slice of the artifact text (≤ 600 characters), copy-paste accurate. Do not paraphrase.
- title ≤ 200 chars. body ≤ 2500 chars. tags ≤ 8 items, each ≤ 32 chars, lowercase, hyphenated where appropriate.
- If the artifact contains no extractable corporate-memory content, return { "candidates": [], "notes": "..." }.
- Do NOT invent contract numbers, dollar values, dates, customer names, or staff bios that aren't in the text.
- Do NOT use governance/risk/compliance jargon unless it's already in the artifact. Speak the artifact's voice.

Schema:
{
  "candidates": [
    {
      "kind": "capability" | "past_performance" | "personnel" | "boilerplate",
      "title": string,
      "body": string,
      "tags": string[],
      "sourceExcerpt": string,
      "metadata": object   // optional; flat key-value
    }
  ],
  "notes": string
}`;

export function buildKnowledgeExtractPrompt(input: {
  artifactKind: string;
  artifactTitle: string;
  artifactTags: string[];
  rawText: string;
}): { system: string; messages: AIMessage[] } {
  // Hard cap on text we send to the model. 60k chars covers virtually
  // any single artifact's worthwhile content without blowing context.
  const trimmed = input.rawText.slice(0, 60_000);

  const userPrompt = [
    `Artifact metadata:`,
    `- kind: ${input.artifactKind}`,
    `- title: ${input.artifactTitle}`,
    `- tags: ${input.artifactTags.length > 0 ? input.artifactTags.join(", ") : "(none)"}`,
    ``,
    `Artifact text:`,
    "```",
    trimmed,
    "```",
    ``,
    input.rawText.length > trimmed.length
      ? `(Text was trimmed from ${input.rawText.length} chars to first ${trimmed.length}.)`
      : "",
    ``,
    `Propose knowledge candidates per the schema in the system prompt. Be strict; nothing without evidence.`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    system: KNOWLEDGE_EXTRACT_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  };
}

// ────────────────────────────────────────────────────────────────────
// BL-10 Phase A — artifact kind classifier
// ────────────────────────────────────────────────────────────────────

/**
 * Classifies a knowledge artifact's kind from its extracted text.
 * Replaces the file-extension-based heuristic in
 * `defaultKindFromFormat` when the user picks "Auto-detect" on upload.
 *
 * Output is a single enum value (matching `knowledgeArtifactKindEnum`)
 * plus a 0..1 confidence score and a one-sentence reasoning string.
 * The dispatcher only applies the AI's kind when confidence ≥ 0.6 and
 * the response was real (not stub-mode), otherwise the file-extension
 * heuristic stays.
 */
export const artifactKindClassifySchema = z.object({
  kind: z.enum([
    "proposal",
    "rfp",
    "contract",
    "cpars",
    "debrief",
    "capability_brief",
    "resume",
    "brochure",
    "whitepaper",
    "email",
    "note",
    "image",
    "spreadsheet",
    "deck",
    "other",
  ]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

const ARTIFACT_KIND_CLASSIFY_SYSTEM = `You classify uploaded files into FORGE's knowledge-base artifact kinds.

You're shown the file name, content type, and the extracted text of one
file. Decide which kind best describes the document and return strict
JSON matching the schema in the user prompt.

Kind definitions:
- proposal: a complete or in-progress response to a government RFP/RFI/RFQ
- rfp: a government solicitation document (RFP / RFI / RFQ / Sources Sought)
- contract: an executed contract or task order
- cpars: a Contractor Performance Assessment Report
- debrief: an agency debrief letter or notes from a debrief meeting
- capability_brief: a short company-capability one-pager / pitch deck
- resume: a single person's CV / resume
- brochure: marketing collateral describing products or services
- whitepaper: a long-form technical or thought-leadership document
- email: an email message or thread
- note: free-form notes / minutes / memos / unstructured text
- deck: a slide presentation (not a marketing brochure)
- spreadsheet: a tabular workbook
- image: an image of a document (when OCR text is too thin to classify further)
- other: when nothing above fits, including form fillables / W-9s / legal misc

Heuristics:
- If the file name contains words like "RFP", "RFQ", "SOW", "PWS", "solicitation",
  "amendment", and the text reads like government-side bid documentation, prefer "rfp".
- If the text reads like a vendor RESPONSE to a solicitation (executive summary,
  technical approach, past performance, price volume), prefer "proposal".
- If the text contains CPARS rating language ("Exceptional", "Satisfactory",
  evaluation periods), prefer "cpars".
- Tabular content with column headers and many rows of data → "spreadsheet"
  (unless the workbook is clearly a price volume of a proposal — then "proposal").
- A single person's bio / experience / education / skills → "resume".

Confidence:
- 1.0 = the document explicitly states what it is (e.g., titled "Resume" or "RFP No. ...")
- 0.7 = strong content match (e.g., a clear bid response structure even if untitled)
- 0.4 = mixed signals — could plausibly be two kinds; pick the more likely
- 0.0 = no usable signal; you're guessing — return "other" with this confidence

Reasoning: one sentence, ≤30 words, citing the strongest signal that drove the
choice. Used for audit / debug only — not shown to end users.`;

export function buildArtifactKindClassifyPrompt(input: {
  fileName: string;
  contentType: string;
  rawText: string;
}): { system: string; messages: AIMessage[] } {
  // Smaller cap than knowledge-extract: classification needs less context.
  // The opening + closing of a doc usually carry enough signal.
  const trimmed = input.rawText.slice(0, 8_000);

  const userPrompt = [
    `File:`,
    `- name: ${input.fileName}`,
    `- contentType: ${input.contentType || "unknown"}`,
    ``,
    `Extracted text (first ${trimmed.length} of ${input.rawText.length} chars):`,
    "```",
    trimmed,
    "```",
    ``,
    `Return strict JSON: { "kind": "<one of the 15 enum values>", "confidence": <0..1 number>, "reasoning": "<one sentence>" }`,
  ].join("\n");

  return {
    system: ARTIFACT_KIND_CLASSIFY_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  };
}

// ────────────────────────────────────────────────────────────────────
// Phase 14f — Proposal-vs-winner analysis
// ────────────────────────────────────────────────────────────────────

export type WinnerAnalysisInput = {
  proposalTitle: string;
  agency: string;
  solicitationNumber: string;
  naicsCode: string;
  setAside: string;
  /** Plain-text summary of our submission — section titles + first 800 chars each. */
  ourSubmissionSummary: string;
  /** Snapshots of our recorded outcome + debrief. */
  outcome: {
    awardValue: string;
    decisionDate: string;
    summary: string;
    lessonsLearned: string;
    awardedToCompetitor: string;
  };
  debrief: {
    strengths: string;
    weaknesses: string;
    improvements: string;
    pastPerformanceCitation: string;
    notes: string;
  } | null;
  /** Up to 8 USAspending award rows for the competitor, summarized. */
  competitorAwards: {
    piid: string;
    agency: string;
    value: string;
    periodStart: string;
    periodEnd: string;
    description: string;
  }[];
};

export type WinnerAnalysisVerdict = {
  winnerProfileSummary: string;
  gapsWeHad: string;
  ourStrengthsUnrecognized: string;
  recommendations: string;
};

const WINNER_ANALYSIS_SYSTEM = `You are a federal capture analyst inside FORGE. A proposal was lost; the team is now reviewing why. You have access to (a) a summary of what we submitted, (b) the government's debrief, and (c) recent USAspending awards the winning competitor has received. You synthesize a candid, evidence-grounded side-by-side that helps the team beat this competitor next time.

Output rules (STRICT JSON, no prose):
{
  "winnerProfileSummary": "<2-4 sentences characterizing the winner's recent past performance — agencies they serve, contract sizes, work types, scale. Pull SPECIFICS from competitorAwards.>",
  "gapsWeHad": "<2-5 bullet-style sentences identifying concrete gaps between our submission and what the agency apparently rewarded. Cite debrief weaknesses verbatim when they connect to a competitor strength. No generic advice.>",
  "ourStrengthsUnrecognized": "<2-4 sentences naming strengths in our submission the debrief did NOT credit, with a brief argument for why they should have. Useful for protests or repositioning. If the debrief credited everything, say so explicitly.>",
  "recommendations": "<3-6 specific actions the team should take before the next bid against this competitor. Reference real names from the inputs (agency, NAICS, vehicle, capability area). No 'leverage' or 'world-class'.>"
}

Hard rules:
- Reuse facts exactly as given. Do NOT invent contract numbers, dollar values, dates, names, or capabilities.
- If competitorAwards is empty, say so directly in winnerProfileSummary — don't fabricate.
- If debrief is null, work from outcome.summary + outcome.lessonsLearned only and note that the debrief wasn't held.
- Each field's text ≤ 1200 characters. Plain prose, no markdown.
- No diplomatic hedging. The team is reviewing a loss; they need a useful read, not flattery.`;

export function buildWinnerAnalysisPrompt(
  input: WinnerAnalysisInput,
): { system: string; messages: AIMessage[] } {
  const userPrompt = [
    `Proposal context:`,
    `- Title: ${input.proposalTitle}`,
    `- Agency: ${input.agency || "(unknown)"}`,
    `- Solicitation: ${input.solicitationNumber || "(unknown)"}`,
    `- NAICS: ${input.naicsCode || "(unknown)"}`,
    `- Set-aside: ${input.setAside || "(unrestricted)"}`,
    ``,
    `Our submission (sections, trimmed):`,
    input.ourSubmissionSummary || "(no draft text recorded)",
    ``,
    `Our recorded outcome:`,
    `- Award value: ${input.outcome.awardValue || "(unknown)"}`,
    `- Decision date: ${input.outcome.decisionDate || "(unknown)"}`,
    `- Awarded to: ${input.outcome.awardedToCompetitor || "(unknown competitor)"}`,
    `- Internal summary: ${input.outcome.summary || "(none)"}`,
    `- Lessons learned: ${input.outcome.lessonsLearned || "(none)"}`,
    ``,
    input.debrief
      ? [
          `Government debrief:`,
          `- Strengths cited: ${input.debrief.strengths || "(none)"}`,
          `- Weaknesses cited: ${input.debrief.weaknesses || "(none)"}`,
          `- Improvements suggested: ${input.debrief.improvements || "(none)"}`,
          `- Past performance citation: ${input.debrief.pastPerformanceCitation || "(none)"}`,
          `- Other notes: ${input.debrief.notes || "(none)"}`,
        ].join("\n")
      : `Government debrief: NOT HELD or not yet recorded.`,
    ``,
    `Competitor's USAspending awards (${input.competitorAwards.length}):`,
    ...input.competitorAwards.map(
      (a) =>
        `  - ${a.piid} | ${a.agency} | ${a.value} | ${a.periodStart}—${a.periodEnd} | ${a.description.slice(0, 240)}`,
    ),
    ``,
    `Return strict JSON per the schema in the system prompt.`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    system: WINNER_ANALYSIS_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  };
}

// ────────────────────────────────────────────────────────────────────
// Phase 14c — Compliance pre-flight
// ────────────────────────────────────────────────────────────────────

export type CompliancePreflightItem = {
  id: string;
  number: string; // e.g. "L.5.2.1"
  category: string; // section_l / section_m / etc.
  requirementText: string;
};

export type CompliancePreflightInput = {
  sectionTitle: string;
  sectionKind: string;
  sectionBody: string;
  items: CompliancePreflightItem[];
};

export type CompliancePreflightVerdict = {
  itemId: string;
  suggestedStatus:
    | "complete"
    | "partial"
    | "not_addressed"
    | "not_applicable";
  confidence: "high" | "medium" | "low";
  gap: string; // 1-2 sentences identifying what's missing
  suggestion: string; // 1-2 sentences proposing how to close the gap
};

const COMPLIANCE_PREFLIGHT_SYSTEM = `You are a federal proposal compliance reviewer inside FORGE. You read a section of a proposal draft and a list of solicitation requirements (Section L instructions or Section M evaluation criteria) the section is supposed to address, and you judge each requirement against the draft.

Output rules (STRICT JSON, no prose):
{
  "verdicts": [
    {
      "itemId": "<echo the supplied id>",
      "suggestedStatus": "complete" | "partial" | "not_addressed" | "not_applicable",
      "confidence": "high" | "medium" | "low",
      "gap": "<one or two sentences identifying what's missing or weak>",
      "suggestion": "<one or two sentences proposing how to close the gap>"
    }
  ]
}

Status calibration:
- complete: the section explicitly addresses the requirement with concrete content. The reviewer would mark this PASS without rework.
- partial: the section gestures at the requirement but is vague, missing a sub-element, or buries the response. Reviewer would write a comment.
- not_addressed: the section does NOT address this requirement. The proposal would be docked or non-compliant.
- not_applicable: the requirement does not apply to this section kind (rare — only mark if the requirement clearly belongs to a different volume).

Confidence:
- high: clear evidence in the section text either way.
- medium: judgment call; another reviewer could disagree.
- low: section text is too short or too generic to be sure.

Hard rules:
- Echo the itemId exactly. Never invent ids.
- Return one verdict per supplied item, in the same order.
- gap and suggestion together must be ≤ 350 characters each. Plain prose, no markdown.
- Do NOT propose a "complete" status if any sub-requirement is unaddressed — use "partial".
- If the section body is empty, every status is "not_addressed" with confidence "high".`;

export function buildCompliancePreflightPrompt(
  input: CompliancePreflightInput,
): { system: string; messages: AIMessage[] } {
  const trimmedBody = input.sectionBody.slice(0, 12000);
  const userPrompt = [
    `Section: "${input.sectionTitle}" (kind: ${input.sectionKind})`,
    `Section body word count: ${input.sectionBody.split(/\s+/).filter(Boolean).length}`,
    trimmedBody.length < input.sectionBody.length
      ? `(Body trimmed from ${input.sectionBody.length} to ${trimmedBody.length} chars.)`
      : "",
    ``,
    `Section body:`,
    trimmedBody || "(empty)",
    ``,
    `Requirements assigned to this section (${input.items.length}):`,
    ...input.items.map(
      (it) =>
        `- id=${it.id} | number=${it.number || "(unset)"} | category=${it.category} | text="${it.requirementText.replace(/"/g, '\\"').slice(0, 600)}"`,
    ),
    ``,
    `Return strict JSON per the schema in the system prompt.`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    system: COMPLIANCE_PREFLIGHT_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  };
}

// ────────────────────────────────────────────────────────────────────
// Zod schemas — runtime guards on AI JSON
//
// We trust prompts to ask for the right shape, but the model is the
// model: it occasionally returns extra fields, swaps a string for a
// number, or drops an enum case. These schemas turn "the AI lied" from
// a 500 into a structured error that the action layer can present.
//
// All schemas are permissive on extras (zod's default) — we only fail
// if a required field is missing or wrong-typed. Use `.parse()` to
// throw, or `.safeParse()` to branch.
// ────────────────────────────────────────────────────────────────────

export const solicitationExtractionSchema = z.object({
  title: z.string(),
  agency: z.string(),
  office: z.string(),
  solicitationNumber: z.string(),
  type: z.enum(["rfp", "rfi", "rfq", "sources_sought", "other"]),
  naicsCode: z.string(),
  setAside: z.string(),
  responseDueDate: z.string().nullable(),
  sectionLSummary: z.string(),
  sectionMSummary: z.string(),
  requirements: z.array(
    z.object({
      kind: z.enum(["shall", "should", "may"]),
      text: z.string(),
      ref: z.string(),
    }),
  ),
});

export const ebuyExtractionSchema = z.object({
  title: z.string(),
  rfqNumber: z.string(),
  buyingAgency: z.string(),
  vehicle: z.string(),
  naicsCode: z.string(),
  setAside: z.string(),
  responseDueDate: z.string().nullable(),
  placeOfPerformance: z.string(),
  scopeSummary: z.string(),
  clinSummary: z.string(),
  notes: z.string(),
});

export const gsaExtractionSchema = z.object({
  title: z.string(),
  noticeType: z.string(),
  solicitationNumber: z.string(),
  buyingAgency: z.string(),
  office: z.string(),
  vehicle: z.string(),
  naicsCode: z.string(),
  setAside: z.string(),
  responseDueDate: z.string().nullable(),
  placeOfPerformance: z.string(),
  scopeSummary: z.string(),
  notes: z.string(),
});

export const knowledgeExtractionSchema = z.object({
  candidates: z.array(
    z.object({
      kind: z.enum(["capability", "past_performance", "personnel", "boilerplate"]),
      title: z.string(),
      body: z.string(),
      tags: z.array(z.string()),
      sourceExcerpt: z.string(),
      metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    }),
  ),
  notes: z.string(),
});

export const winnerAnalysisSchema = z.object({
  winnerProfileSummary: z.string(),
  gapsWeHad: z.string(),
  ourStrengthsUnrecognized: z.string(),
  recommendations: z.string(),
});

export const compliancePreflightVerdictSchema = z.object({
  itemId: z.string(),
  suggestedStatus: z.enum([
    "complete",
    "partial",
    "not_addressed",
    "not_applicable",
  ]),
  confidence: z.enum(["high", "medium", "low"]),
  gap: z.string(),
  suggestion: z.string(),
});

/** The compliance prompt returns `{ verdicts: [...] }`. */
export const compliancePreflightResponseSchema = z.object({
  verdicts: z.array(compliancePreflightVerdictSchema),
});

// ────────────────────────────────────────────────────────────────────
// BL-FB-CM-AUTOMAP — Auto-map requirements to proposal sections
// ────────────────────────────────────────────────────────────────────

export type ComplianceAutoMapItem = {
  itemId: string;
  number: string;
  category: string;
  requirementText: string;
};

export type ComplianceAutoMapSection = {
  sectionId: string;
  title: string;
  kind: string;
};

export type ComplianceAutoMapInput = {
  items: ComplianceAutoMapItem[];
  sections: ComplianceAutoMapSection[];
};

export type ComplianceAutoMapVerdict = {
  itemId: string;
  /** Section id to assign, or "" to leave unmapped. */
  sectionId: string;
  /** AI confidence in the mapping. */
  confidence: "high" | "medium" | "low";
  /** 1 short sentence explaining the choice. */
  rationale: string;
};

const COMPLIANCE_AUTOMAP_SYSTEM = `You are a federal proposal compliance analyst inside FORGE. Your job: assign each Section L/M requirement to the most appropriate proposal section so the team can build a compliance crosswalk fast.

You receive:
  - A list of compliance items (Section L instructions or Section M evaluation criteria) — each with an id, number, category, and the requirement text.
  - A list of proposal sections — each with an id, title, and kind (e.g. executive_summary, technical, management, past_performance, pricing, compliance).

Your job: for each item, pick the single best section to address it.

Output ONLY a single JSON object:
{
  "mappings": [
    {
      "itemId": "<echo the supplied id>",
      "sectionId": "<id of the best-fit section, or empty string '' if no section is a good fit>",
      "confidence": "high" | "medium" | "low",
      "rationale": "<one short sentence explaining the choice>"
    }
  ]
}

Heuristics:
- Section L instructions about technical approach → kind=technical or "Technical Approach"-titled section.
- Section L instructions about management approach, staffing, transition, risk → kind=management.
- Section L instructions about past performance → kind=past_performance.
- Pricing / cost / CLIN instructions → kind=pricing.
- Cover letter, executive summary, theme statements → kind=executive_summary.
- Cross-cutting requirements (page limits, font, format, table-of-contents, certifications) → kind=compliance OR no mapping if no compliance volume exists.
- Section M evaluation factors: map to the section whose CONTENT will be evaluated against that factor (e.g. Factor 1: Technical → technical section; Factor 2: Past Performance → past_performance section).

Confidence rules:
- high: the requirement's topic clearly matches the section's kind / title.
- medium: plausible match but the section could overlap with another (e.g. risk could go in technical or management).
- low: weak signal; the requirement is generic or there's no clear best section.

Hard rules:
- Echo each itemId exactly. Return one mapping per supplied item, in the same order.
- If no section is a reasonable fit (e.g. the proposal has no compliance volume), set sectionId to "" with rationale explaining why.
- rationale ≤ 200 characters. Plain prose, no markdown.
- Do NOT invent section ids. sectionId must be either an id from the input list or "".`;

export function buildComplianceAutoMapPrompt(
  input: ComplianceAutoMapInput,
): { system: string; messages: AIMessage[] } {
  const itemLines = input.items
    .map(
      (it, i) =>
        `${i + 1}. id=${it.itemId} | number=${it.number || "(none)"} | category=${it.category} | text="${it.requirementText.replace(/"/g, '\\"').slice(0, 400)}"`,
    )
    .join("\n");

  const sectionLines = input.sections
    .map(
      (s, i) =>
        `${i + 1}. id=${s.sectionId} | kind=${s.kind} | title="${s.title.replace(/"/g, '\\"')}"`,
    )
    .join("\n");

  const userPrompt = [
    `Compliance items to map (${input.items.length}):`,
    itemLines || "(none)",
    ``,
    `Proposal sections available (${input.sections.length}):`,
    sectionLines || "(none)",
    ``,
    `Return strict JSON per the schema in the system prompt. One mapping per item, in the same order.`,
  ].join("\n");

  return {
    system: COMPLIANCE_AUTOMAP_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  };
}

export const complianceAutoMapVerdictSchema = z.object({
  itemId: z.string(),
  sectionId: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  rationale: z.string(),
});

export const complianceAutoMapResponseSchema = z.object({
  mappings: z.array(complianceAutoMapVerdictSchema),
});

/**
 * Zod-parse a JSON-ish string from the AI. Strips any leading/trailing
 * prose by clipping to the first `{` and last `}` before parsing —
 * the same forgiveness the existing call sites apply.
 *
 * Returns `{ ok: true, data }` on success or `{ ok: false, error }` on
 * any failure (parse error, schema violation). Never throws.
 */
export function parseAiJson<T>(
  raw: string,
  schema: z.ZodType<T>,
): { ok: true; data: T } | { ok: false; error: string } {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const slice = start === -1 || end < start ? raw : raw.slice(start, end + 1);

  let json: unknown;
  try {
    json = JSON.parse(slice);
  } catch {
    return {
      ok: false,
      error: "AI response was not valid JSON.",
    };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      error: `AI response didn't match the expected shape (${issues}).`,
    };
  }
  return { ok: true, data: parsed.data };
}
