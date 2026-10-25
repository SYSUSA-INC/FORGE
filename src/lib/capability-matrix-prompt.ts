import type { SolicitationRequirement } from "@/db/schema";
import { CAPABILITY_DRAFTED_MAX, CAPABILITY_DRAFTED_MIN, STANDING_QUESTIONS } from "@/lib/capability-matrix-types";

/**
 * BL-CAP-MATRIX — the prompt that drafts capability questions from a
 * parsed solicitation. Pure: builds strings only.
 */
const REQUIREMENTS_MAX = 150;
const REQUIREMENT_TEXT_MAX = 300;
const SUMMARY_MAX = 2_500;

export function buildCapabilityQuestionsPrompt(input: {
  opportunity: {
    title: string;
    agency: string;
    naicsCode: string;
    setAside: string;
    placeOfPerformance: string;
    incumbent: string;
    description: string;
  };
  requirements: SolicitationRequirement[];
  sectionLSummary: string;
  sectionMSummary: string;
}): { system: string; messages: { role: "user"; content: string }[] } {
  const shallFirst = [...input.requirements].sort(
    (a, b) => rank(a.kind) - rank(b.kind),
  );
  const reqLines = shallFirst
    .slice(0, REQUIREMENTS_MAX)
    .map((r) => `- [${r.ref}] (${r.kind}) ${r.text.slice(0, REQUIREMENT_TEXT_MAX)}`)
    .join("\n");
  const standing = STANDING_QUESTIONS.map((q) => `- ${q.text}`).join("\n");

  const system = `You are a capture analyst for a US government contractor. From a solicitation's requirements you draft the capability questions a bid team must answer honestly before deciding to bid.

Rules:
- Draft between ${CAPABILITY_DRAFTED_MIN} and ${CAPABILITY_DRAFTED_MAX} questions. Each asks whether the company can do or provide one concrete thing the solicitation requires, phrased "Can we ...?" or "Do we ...?", answerable by a bid team.
- Group near-duplicate requirements into one question. Cite every requirement reference the question covers in "refs", using the references exactly as given in brackets.
- "kind" is the strongest requirement kind the question covers: shall over should over may.
- "area" is a short grouping label such as Security, Staffing, Technical, Delivery, Reporting, Past performance, Transition.
- Do not repeat these standing questions, which are asked separately:
${standing}
- Do not invent requirements. If the text gives too little to draft ${CAPABILITY_DRAFTED_MIN} questions, draft fewer.`;

  const user = `Opportunity: ${input.opportunity.title}
Agency: ${input.opportunity.agency || "unknown"}
NAICS: ${input.opportunity.naicsCode || "unknown"} · Set-aside: ${input.opportunity.setAside || "none stated"}
Place of performance: ${input.opportunity.placeOfPerformance || "unknown"} · Incumbent: ${input.opportunity.incumbent || "unknown"}

Description:
${input.opportunity.description.slice(0, SUMMARY_MAX) || "(none)"}

Section L (instructions) summary:
${input.sectionLSummary.slice(0, SUMMARY_MAX) || "(none)"}

Section M (evaluation) summary:
${input.sectionMSummary.slice(0, SUMMARY_MAX) || "(none)"}

Requirements (${input.requirements.length} total; shall first):
${reqLines || "(none)"}

Draft the capability questions.`;

  return { system, messages: [{ role: "user", content: user }] };
}

function rank(kind: SolicitationRequirement["kind"]): number {
  return kind === "shall" ? 0 : kind === "should" ? 1 : 2;
}
