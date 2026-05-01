import type { AIMessage } from "@/lib/ai";

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

export type SectionDraftMode = "draft" | "improve" | "tighten";

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
};

const SECTION_DRAFT_SYSTEM = `You are an embedded proposal writer inside FORGE — a federal proposal operations platform. You produce compliance-grade prose that reads like an experienced capture lead wrote it.

Style rules:
- Plain prose. No markdown headings, no bullet markers like "*". Use real paragraphs and, when appropriate, indented sub-points.
- Speak with confidence and specificity. Avoid filler ("we are pleased to", "world-class", "best-in-class", "robust").
- Match section conventions: Executive Summary → 1–2 punchy paragraphs; Technical → numbered approach steps + how-it-mitigates-risk; Management → roles + governance + risk register; Past Performance → CPARS-style references; Pricing → assumptions + cost model; Compliance → traceability statements.
- Cite the customer (agency, office, mission) and the solicitation number when context is provided.
- Reuse facts from the snapshot exactly as given. Do NOT invent contract numbers, dates, dollar values, customer names, or staff bios.
- If the snapshot is sparse, write what you can with general best practices and explicitly mark TBD placeholders in [BRACKETS] for the human author to fill.`;

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
