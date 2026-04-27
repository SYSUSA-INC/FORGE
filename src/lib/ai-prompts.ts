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
