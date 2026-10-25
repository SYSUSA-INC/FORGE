import type { CapabilityQuestion } from "@/lib/capability-matrix-types";
import { CAPABILITY_ANSWER_LABELS, CAPABILITY_ANSWER_VALUES } from "@/lib/capability-matrix-types";
import { CAPABILITY_SUGGESTION_KNOWLEDGE_LIMIT } from "@/lib/capability-suggestions";

/**
 * BL-CAP-MATRIX phase C — the prompt that suggests answers to the
 * questions the matrix and earlier questionnaires left open, from the
 * organisation's past performance and knowledge base. Pure: strings only.
 */
const BODY_MAX = 600;
const PP_MAX = 30;

export type SuggestionPastPerformance = {
  id: string;
  customer: string;
  contract: string;
  value: string;
  periodStart: string;
  periodEnd: string;
  description: string;
};

export type SuggestionKnowledgeEntry = {
  id: string;
  kind: string;
  title: string;
  body: string;
  tags: string[];
};

export function buildCapabilitySuggestionsPrompt(input: {
  opportunity: {
    title: string;
    agency: string;
    naicsCode: string;
    setAside: string;
    placeOfPerformance: string;
    incumbent: string;
  };
  questions: CapabilityQuestion[];
  pastPerformance: SuggestionPastPerformance[];
  knowledgeEntries: SuggestionKnowledgeEntry[];
}): { system: string; messages: { role: "user"; content: string }[] } {
  const scale = CAPABILITY_ANSWER_VALUES.map((v) => `- ${v}: ${CAPABILITY_ANSWER_LABELS[v]}`).join("\n");
  const system = `You are a capture analyst for a US government contractor. A bid team has capability questions about a solicitation; you suggest an answer to each one FROM THE EVIDENCE GIVEN, so the team can confirm or correct it.

Answer scale:
${scale}

Rules:
- Use only the past performance and knowledge entries given. Never assume a capability the evidence does not show.
- "have_proven" needs a source: cite it in "sources" as "pp:<id>" or "knowledge:<id>", exactly as given. Without a source, the most you may suggest is "have_unproven" or "partial".
- Suggest "gap_none" when the evidence shows the company has not done this kind of work. Suggest "na" only when the question plainly does not apply to a company like this one.
- Skip a question when the evidence says nothing about it. Fewer, grounded suggestions beat guesses.
- "evidence" is one line naming the contract or entry and the fact in it. "reason" is one sentence on why that answer.`;

  const pp = input.pastPerformance
    .slice(0, PP_MAX)
    .map(
      (p) =>
        `- id=pp:${p.id} | ${p.customer || "unknown customer"} | ${p.contract || "unnamed contract"} | ${p.value || "value n/a"} | ${p.periodStart || "?"} to ${p.periodEnd || "?"}\n  ${p.description.replace(/\n/g, " ").slice(0, BODY_MAX) || "(no description)"}`,
    )
    .join("\n");
  const kb = input.knowledgeEntries
    .slice(0, CAPABILITY_SUGGESTION_KNOWLEDGE_LIMIT)
    .map(
      (e) =>
        `- id=knowledge:${e.id} | kind=${e.kind} | tags=${e.tags.join(",") || "(none)"} | title="${e.title}"\n  ${e.body.replace(/\n/g, " ").slice(0, BODY_MAX)}`,
    )
    .join("\n");
  const qs = input.questions
    .map((q) => `- id=${q.id} | ${q.kind} | ${q.area} | ${q.text}${q.refs.length ? ` [${q.refs.join(", ")}]` : ""}`)
    .join("\n");

  const user = `Opportunity: ${input.opportunity.title}
Agency: ${input.opportunity.agency || "unknown"} · NAICS: ${input.opportunity.naicsCode || "unknown"} · Set-aside: ${input.opportunity.setAside || "none stated"}
Place of performance: ${input.opportunity.placeOfPerformance || "unknown"} · Incumbent: ${input.opportunity.incumbent || "unknown"}

Past performance (${input.pastPerformance.length}):
${pp || "(none on file)"}

Knowledge entries (${input.knowledgeEntries.length}):
${kb || "(none)"}

Questions (${input.questions.length}):
${qs}

Suggest an answer for each question the evidence supports.`;

  return { system, messages: [{ role: "user", content: user }] };
}
