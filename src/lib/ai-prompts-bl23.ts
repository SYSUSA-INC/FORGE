/**
 * BL-23 prompts: solicitation review + capability matrix + question generator.
 *
 * Kept in a sibling file (rather than appended to ai-prompts.ts)
 * because that file is already 750+ lines and these three prompts
 * are tightly coupled — they only make sense as a triad. Re-exported
 * from ai-prompts.ts so call sites import from one place.
 *
 * BL-STAB-9 — each answer is sized to fit its output limit whatever the
 * size of the RFP. The review no longer re-extracts the requirements,
 * Sections L and M or the evaluation factors (they come from the parse,
 * `review-basis.ts`); the matrix scores the requirements a window at a
 * time and judges PWin in its own small answer; every list is read entry
 * by entry, so one bad entry is dropped instead of failing the answer.
 * The tool schema is the only schema the model sees.
 */
import { z } from "zod";
import type { AIMessage } from "@/lib/ai";
import type { SolicitationReviewResult } from "@/db/schema";
import { frontPassExcerpt } from "@/lib/solicitation-sections";
import { fenced } from "@/lib/prompt-safety";
import { choice, tolerant, tolerantList } from "@/lib/zod-tolerant";

type ReviewRequirement = SolicitationReviewResult["requirements"][number];
type ReviewFactor = SolicitationReviewResult["evaluationFactors"][number];

// ────────────────────────────────────────────────────────────────────
// 1. Solicitation review — the judgement the parse does not make
// ────────────────────────────────────────────────────────────────────

const SOLICITATION_REVIEW_SYSTEM = `You are a senior federal capture analyst inside FORGE, a proposal operations platform, reviewing an RFP / RFI / Sources Sought / RFQ document. FORGE has already extracted the document's requirements and its Sections L and M; you are given how many requirements it found and the evaluation factors, for context. Your answer is the capture team's first read of the opportunity.

Record:
- summary: 1-2 paragraphs of plain prose (at most about 1,200 characters): what the agency is buying, the scale and shape of the work, and what will decide the award. No marketing tone.
- periodOfPerformance: as stated (e.g. "One 12-month base year and four 12-month option years"); "" when not stated.
- placeOfPerformance: as stated; "" when not stated.
- setAside: the set-aside as stated (e.g. "Total Small Business", "8(a) competitive"); "" when none.
- mandatoryCertifications: certifications, clearances or accreditations an offeror must hold (e.g. "FedRAMP High", "CMMC Level 2", "Facility clearance: Secret"); at most 12; [] when none.
- flaggedQuestions: up to 10 ambiguities a capture team should raise with the contracting office, one sentence each, each tied to something the document says. A dedicated question generator goes deeper later; list only the most consequential.

Rules:
- Record only what the document states. Never invent a period, place, set-aside or certification.
- If the document is clearly not a solicitation, say so in the summary and leave the other fields empty.`;

export function buildSolicitationReviewPrompt(input: {
  title: string;
  fileName: string;
  rawText: string;
  /** What the parse already holds, given as context (BL-STAB-9). */
  basis?: { requirementCount: number; factors: string[] };
}): { system: string; messages: AIMessage[] } {
  // BL-AIX Phase 0 — the beginning plus the located Sections L and M
  // (they sit at the end of a long RFP), not just the first 100k characters.
  const excerpt = frontPassExcerpt(input.rawText, 100_000);
  const userPrompt = [
    `Document title: ${input.title || "(untitled)"}`,
    `Source file: ${input.fileName || "(no file)"}`,
    ...(input.basis
      ? [
          `Requirements FORGE extracted from the whole document: ${input.basis.requirementCount}`,
          `Evaluation factors: ${input.basis.factors.length > 0 ? input.basis.factors.join("; ") : "(none structured)"}`,
        ]
      : []),
    ``,
    excerpt.partial ? `Excerpts (the document is ${input.rawText.length.toLocaleString("en-US")} characters; each excerpt is labelled with its position):` : `Full text:`,
    fenced(excerpt.text),
    ``,
    `Record the review with the tool.`,
  ].join("\n");

  return {
    system: SOLICITATION_REVIEW_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  };
}

export const solicitationReviewSchema = z.object({
  summary: tolerant(z.string(), ""),
  periodOfPerformance: tolerant(z.string(), ""),
  placeOfPerformance: tolerant(z.string(), ""),
  setAside: tolerant(z.string(), ""),
  mandatoryCertifications: tolerantList(z.string(), 12),
  flaggedQuestions: tolerantList(z.string(), 10),
});

export type SolicitationReviewVerdict = z.output<typeof solicitationReviewSchema>;

// ────────────────────────────────────────────────────────────────────
// 2. Capability Matrix — requirements × knowledge entries, a window at a time
// ────────────────────────────────────────────────────────────────────

export const MATRIX_CELL_STATUSES = ["strong", "partial", "gap", "not_addressed"] as const;
export type MatrixCellStatus = (typeof MATRIX_CELL_STATUSES)[number];

export type CapabilityMatrixVerdict = {
  cells: {
    requirementId: string;
    capabilityRef: string;
    status: MatrixCellStatus;
    citation: string;
    narrative: string;
  }[];
  pwinRecommendationLow: number;
  pwinRecommendationHigh: number;
  pwinRationale: string;
};

type MatrixKnowledgeEntry = { id: string; kind: string; title: string; body: string; tags: string[] };

const CAPABILITY_MATRIX_SYSTEM = `You are a capture analyst inside FORGE judging how well the company's documented capabilities and past performance address the requirements of a specific solicitation.

You receive a part of the solicitation's requirements (each with id, kind, reference, area and text). The company's knowledge corpus is below: capabilities, past performance citations, key personnel and boilerplate, each with an id, kind, title, tags and body.

Record one cell for every requirement you are given:
- requirementId: the id of the requirement, exactly as given.
- capabilityRef: "knowledge:<entry id>" of the strongest supporting entry, or "" when no entry meaningfully supports the requirement.
- status: "strong" (the corpus shows the company has done this, with details), "partial" (adjacent capability or thin past performance), "gap" (nothing relevant in the corpus), or "not_addressed" (the corpus is empty or nothing comes close).
- citation: a verbatim slice of the supporting entry's body, at most 160 characters; "" when there is no support.
- narrative: one sentence, at most 200 characters, on why the corpus supports the requirement or what is missing. Plain prose.

Rules:
- One cell per requirement given, none skipped, none added.
- Never invent capabilities or past performance the corpus does not show. An empty corpus means "gap" or "not_addressed" cells.
- Do not gloss gaps with framing; capture managers need an honest read.`;

function corpusBlock(entries: MatrixKnowledgeEntry[]): string {
  const shown = entries
    .slice(0, 60)
    .map(
      (e) =>
        `- id=${e.id} | kind=${e.kind} | tags=${e.tags.join(",") || "(none)"} | title="${e.title}"\n  body: ${e.body.replace(/\n/g, " ").slice(0, 800)}`,
    )
    .join("\n");
  return `Knowledge corpus (${entries.length} entries; ${entries.length > 60 ? "top 60 shown" : "all shown"}):\n${shown ? fenced(shown) : "(empty corpus)"}`;
}

/**
 * One window of the matrix. The corpus sits in the system prompt, which
 * is cached, so every window after the first reads it from the cache.
 */
export function buildCapabilityMatrixPrompt(input: {
  solicitationTitle: string;
  agency: string;
  setAside: string;
  requirements: ReviewRequirement[];
  knowledgeEntries: MatrixKnowledgeEntry[];
}): { system: string; messages: AIMessage[] } {
  const reqs = input.requirements
    .map((r) => `- id=${r.id} | ${r.kind} | ref=${r.sectionRef || "(none)"} | area=${r.capabilityArea || "(none)"} | text="${r.text.replace(/"/g, '\\"').slice(0, 600)}"`)
    .join("\n");
  const userPrompt = [
    `Solicitation: ${input.solicitationTitle}`,
    `Agency: ${input.agency || "(unknown)"}`,
    `Set-aside: ${input.setAside || "(none)"}`,
    ``,
    `Requirements to score (${input.requirements.length}):`,
    fenced(reqs || "(none)"),
    ``,
    `Record one cell per requirement with the tool.`,
  ].join("\n");
  return {
    system: `${CAPABILITY_MATRIX_SYSTEM}\n\n${corpusBlock(input.knowledgeEntries)}`,
    messages: [{ role: "user", content: userPrompt }],
  };
}

const matrixCellSchema = z.object({
  requirementId: z.string(),
  capabilityRef: tolerant(z.string(), ""),
  status: choice(MATRIX_CELL_STATUSES, "not_addressed"),
  citation: tolerant(z.string(), ""),
  narrative: tolerant(z.string(), ""),
});

export const capabilityMatrixSchema = z.object({
  cells: tolerantList(matrixCellSchema, 60),
});

const CAPABILITY_PWIN_SYSTEM = `You are a capture analyst inside FORGE giving a probability-of-win recommendation for a solicitation from a scored capability matrix: how strongly the company's documented capabilities and past performance cover each requirement.

Record:
- pwinRecommendationLow and pwinRecommendationHigh: integer percentages (0-100). The range expresses uncertainty: narrow when coverage is decisive (e.g. 65-75), wide when it is patchy (e.g. 30-55).
- pwinRationale: 2-4 sentences naming the strongest coverage and the most consequential gaps, weighed against the evaluation factors.

Rules:
- Judge only from the matrix and factors given. Mostly gaps means a low PWin.`;

export function buildCapabilityPwinPrompt(input: {
  solicitationTitle: string;
  agency: string;
  setAside: string;
  counts: Record<MatrixCellStatus, number>;
  strong: string[];
  gaps: string[];
  factors: ReviewFactor[];
}): { system: string; messages: AIMessage[] } {
  const total = MATRIX_CELL_STATUSES.reduce((n, s) => n + input.counts[s], 0);
  const userPrompt = [
    `Solicitation: ${input.solicitationTitle}`,
    `Agency: ${input.agency || "(unknown)"}`,
    `Set-aside: ${input.setAside || "(none)"}`,
    ``,
    `Requirements scored: ${total} — strong ${input.counts.strong}, partial ${input.counts.partial}, gap ${input.counts.gap}, not addressed ${input.counts.not_addressed}.`,
    ``,
    `Evaluation factors:`,
    input.factors.map((f) => `- ${f.name}${f.weight ? ` (${f.weight})` : ""}`).join("\n") || "(none structured)",
    ``,
    `Strongest coverage:`,
    fenced(input.strong.join("\n") || "(none)"),
    ``,
    `Most consequential gaps:`,
    fenced(input.gaps.join("\n") || "(none)"),
    ``,
    `Record the PWin recommendation with the tool.`,
  ].join("\n");
  return {
    system: CAPABILITY_PWIN_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  };
}

export const capabilityPwinSchema = z.object({
  pwinRecommendationLow: tolerant(z.number(), 0),
  pwinRecommendationHigh: tolerant(z.number(), 0),
  pwinRationale: tolerant(z.string(), ""),
});

// ────────────────────────────────────────────────────────────────────
// 3. Question Generator — clarifications for the contracting office
// ────────────────────────────────────────────────────────────────────

export const QUESTION_CATEGORIES = [
  "scope_ambiguity",
  "evaluation_criteria",
  "submission_logistics",
  "technical_constraints",
  "security_clearance",
  "subcontracting",
] as const;
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

export type QuestionSetVerdict = {
  questions: {
    id: string;
    category: QuestionCategory;
    text: string;
    rationale: string;
    sectionRef: string;
  }[];
};

const QUESTION_GENERATOR_SYSTEM = `You are a senior capture analyst inside FORGE generating clarification questions for the contracting officer (CO) on a federal solicitation. Your goal is the list of questions a competent capture team would actually ask: precise, professional, and tied to specific points in the document.

Categories:
  - scope_ambiguity: the work itself is unclear or contradictory
  - evaluation_criteria: Section M is ambiguous, weights conflict, or factor wording is vague
  - submission_logistics: page caps, font requirements, file format, due date, Q&A deadline, portal mechanics
  - technical_constraints: performance specs, integration requirements, data formats, system constraints
  - security_clearance: clearance level, facility clearance, CMMC / NIST 800-171 / FedRAMP applicability
  - subcontracting: small-business participation, set-aside applicability, OEM partnerships, joint venture rules

Record 8-25 questions, each with:
- id: a short slug (e.g. "q_scope_1"), numbered within its category.
- category: one of the categories above.
- text: the question, phrased professionally and addressed to the CO, at most 2 sentences. No leading questions.
- rationale: one sentence for the capture team (not the CO) on the risk it surfaces or the decision it unblocks.
- sectionRef: the reference that prompted the question (e.g. "L.5.2.1", "M-3", "C.3"); "" when none applies.

Rules:
- Quality over quantity: if the document is clear, record a short list of high-confidence questions rather than padding.
- Don't repeat a question across categories. Anchor every question in the document; no generic questions.`;

export function buildQuestionGeneratorPrompt(input: {
  solicitationTitle: string;
  agency: string;
  reviewSummary: string;
  sectionL: string[];
  sectionM: string[];
  requirements: ReviewRequirement[];
  evaluationFactors: ReviewFactor[];
  flaggedQuestions: string[];
}): { system: string; messages: AIMessage[] } {
  const reqs = input.requirements
    .slice(0, 60)
    .map((r) => `- ${r.kind.toUpperCase()} | ref=${r.sectionRef || "(none)"} | "${r.text.replace(/"/g, '\\"').slice(0, 400)}"`)
    .join("\n");
  const evals = input.evaluationFactors.map((f) => `- ${f.name} | weight=${f.weight || "(unstated)"}${f.notes ? ` | ${f.notes}` : ""}`).join("\n");

  const userPrompt = [
    `Solicitation: ${input.solicitationTitle}`,
    `Agency: ${input.agency || "(unknown)"}`,
    ``,
    `Review summary:`,
    fenced(input.reviewSummary || "(none)"),
    ``,
    `Section L (instructions):`,
    fenced(input.sectionL.map((b) => `- ${b}`).join("\n") || "(none)"),
    ``,
    `Section M (evaluation):`,
    fenced(input.sectionM.map((b) => `- ${b}`).join("\n") || "(none)"),
    ``,
    `Evaluation factors:`,
    fenced(evals || "(none)"),
    ``,
    `Requirements (${Math.min(60, input.requirements.length)} of ${input.requirements.length}, mandatory first):`,
    fenced(reqs || "(none)"),
    ``,
    `Items the review already flagged:`,
    fenced(input.flaggedQuestions.map((f) => `- ${f}`).join("\n") || "(none)"),
    ``,
    `Record 8-25 categorized clarification questions with the tool.`,
  ].join("\n");

  return {
    system: QUESTION_GENERATOR_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  };
}

const questionSchema = z.object({
  id: tolerant(z.string(), ""),
  category: choice(QUESTION_CATEGORIES, "scope_ambiguity"),
  text: z.string().min(1),
  rationale: tolerant(z.string(), ""),
  sectionRef: tolerant(z.string(), ""),
});

export const questionSetSchema = z.object({
  questions: tolerantList(questionSchema, 25),
});
