/**
 * BL-23 prompts: solicitation review + capability matrix + question generator.
 *
 * Kept in a sibling file (rather than appended to ai-prompts.ts)
 * because that file is already 750+ lines and these three prompts
 * are tightly coupled — they only make sense as a triad. Re-exported
 * from ai-prompts.ts so call sites import from one place.
 *
 * BL-STAB-9 — the review no longer re-extracts the requirements,
 * Sections L and M or the evaluation factors (they come from the parse,
 * `review-basis.ts`); it asks for judgement only, sized to fit its
 * output limit whatever the size of the RFP, with fields that fall back
 * one by one. The tool schema is the only schema it shows the model.
 */
import { z } from "zod";
import type { AIMessage } from "@/lib/ai";
import type { SolicitationReviewResult } from "@/db/schema";
import { frontPassExcerpt } from "@/lib/solicitation-sections";
import { fenced } from "@/lib/prompt-safety";
import { tolerant, tolerantList } from "@/lib/zod-tolerant";

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
// 2. Capability Matrix — review × knowledge entries
// ────────────────────────────────────────────────────────────────────

export type CapabilityMatrixVerdict = {
  cells: {
    requirementId: string;
    capabilityRef: string;
    status: "strong" | "partial" | "gap" | "not_addressed";
    citation: string;
    narrative: string;
  }[];
  pwinRecommendationLow: number;
  pwinRecommendationHigh: number;
  pwinRationale: string;
};

const CAPABILITY_MATRIX_SYSTEM = `You are a capture analyst inside FORGE judging how well the company's documented capabilities and past performance address the requirements of a specific solicitation.

You receive:
  - A list of requirements from the solicitation review (with id, text, sectionRef, capabilityArea, kind).
  - A corpus of "knowledge entries" the company has captured — capabilities, past performance citations, key personnel, boilerplate. Each has an id, kind, title, body, and tags.

Your job: produce a cell for every requirement. Score how strongly the corpus supports that requirement, cite the supporting entry, and give a 1-2 sentence narrative of the fit.

Output ONLY a single JSON object matching the schema below.

Rules:
- One cell per input requirement. Don't skip any.
- "requirementId" must match the id of the input requirement.
- "capabilityRef": "knowledge:<entry_id>" of the strongest supporting entry, or "" if no entry meaningfully supports the requirement.
- "status":
    * "strong"        — corpus has clear evidence the company has done this (past performance with details, capability with depth).
    * "partial"       — adjacent capability or thin past performance; might cover the requirement with framing.
    * "gap"           — corpus has nothing relevant; the company would have to pitch capability they haven't built yet.
    * "not_addressed" — same as gap; use when the corpus is empty or the requirement is so out-of-scope no entry was even close.
- "citation": a verbatim slice from the supporting knowledge entry's body (≤ 240 chars). Empty string if no support.
- "narrative": 1-2 sentences explaining either why the corpus supports the requirement (for strong/partial) or what's missing (for gap/not_addressed). Plain prose, no marketing tone.

After scoring all cells, give a PWin recommendation:
- "pwinRecommendationLow" / "pwinRecommendationHigh": integer percentage (0-100). The range expresses uncertainty — narrow when coverage is decisive (e.g. 65-75), wide when patchy (e.g. 30-55).
- "pwinRationale": 2-4 sentences explaining the recommendation, with reference to the dominant strong cells and the most consequential gaps.

Hard rules:
- Do not invent capabilities or past performance the corpus doesn't show. Empty corpus → mostly "gap" / "not_addressed" cells, low PWin.
- Do not gloss gaps with framing — capture managers need an honest read.

Schema:
{
  "cells": [
    {
      "requirementId": string,
      "capabilityRef": string,
      "status": "strong" | "partial" | "gap" | "not_addressed",
      "citation": string,
      "narrative": string
    }
  ],
  "pwinRecommendationLow": number,
  "pwinRecommendationHigh": number,
  "pwinRationale": string
}`;

export function buildCapabilityMatrixPrompt(input: {
  solicitationTitle: string;
  agency: string;
  setAside: string;
  requirements: ReviewRequirement[];
  knowledgeEntries: {
    id: string;
    kind: string;
    title: string;
    body: string;
    tags: string[];
  }[];
}): { system: string; messages: AIMessage[] } {
  const reqs = input.requirements
    .map(
      (r) =>
        `  - id=${r.id} | ${r.kind} | ref=${r.sectionRef} | area=${r.capabilityArea} | text="${r.text.replace(/"/g, '\\"').slice(0, 600)}"`,
    )
    .join("\n");

  // Body trimmed per entry; corpus capped overall.
  const entries = input.knowledgeEntries
    .slice(0, 60)
    .map(
      (e) =>
        `  - id=${e.id} | kind=${e.kind} | tags=${e.tags.join(",") || "(none)"} | title="${e.title}"\n    body: ${e.body.replace(/\n/g, " ").slice(0, 800)}`,
    )
    .join("\n");

  const userPrompt = [
    `Solicitation: ${input.solicitationTitle}`,
    `Agency: ${input.agency || "(unknown)"}`,
    `Set-aside: ${input.setAside || "(none)"}`,
    ``,
    `Requirements (${input.requirements.length}):`,
    reqs || "(none)",
    ``,
    `Knowledge corpus (${input.knowledgeEntries.length} entries; ${input.knowledgeEntries.length > 60 ? `top 60 shown` : "all shown"}):`,
    entries || "(empty corpus)",
    ``,
    `Score each requirement against the corpus. Return strict JSON per the schema in the system prompt.`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    system: CAPABILITY_MATRIX_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  };
}

export const capabilityMatrixSchema = z.object({
  cells: z.array(
    z.object({
      requirementId: z.string(),
      capabilityRef: z.string(),
      status: z.enum(["strong", "partial", "gap", "not_addressed"]),
      citation: z.string(),
      narrative: z.string(),
    }),
  ),
  pwinRecommendationLow: z.number(),
  pwinRecommendationHigh: z.number(),
  pwinRationale: z.string(),
});

// ────────────────────────────────────────────────────────────────────
// 3. Question Generator — clarifications for the contracting office
// ────────────────────────────────────────────────────────────────────

export type QuestionSetVerdict = {
  questions: {
    id: string;
    category:
      | "scope_ambiguity"
      | "evaluation_criteria"
      | "submission_logistics"
      | "technical_constraints"
      | "security_clearance"
      | "subcontracting";
    text: string;
    rationale: string;
    sectionRef: string;
  }[];
};

const QUESTION_GENERATOR_SYSTEM = `You are a senior capture analyst inside FORGE generating clarification questions for the contracting officer (CO) on a federal solicitation. Your goal is the list of questions a competent capture team would actually ask — precise, professional, and tied to specific points in the document.

Output ONLY a single JSON object matching the schema below. No commentary, no markdown fences.

Categories (use exactly these strings):
  - scope_ambiguity         — the work itself is unclear or contradictory
  - evaluation_criteria     — Section M is ambiguous, weights conflict, or factor wording is vague
  - submission_logistics    — page caps, font requirements, file format, due date, Q&A deadline, portal mechanics
  - technical_constraints   — performance specs, integration requirements, data formats, system constraints
  - security_clearance      — clearance level, facility clearance, CMMC / NIST 800-171 / FedRAMP applicability
  - subcontracting          — small-business participation, set-aside applicability, OEM partnerships, joint venture rules

Rules:
- "id" is a stable short slug (e.g. "q_scope_1", "q_eval_3"). Use sequential numbers within a category.
- "text" is the actual question phrased professionally. Address the CO directly. Avoid leading questions.
- "rationale" is 1-2 sentences explaining why this question matters — what risk it surfaces or what decision it unblocks. NOT for the CO; for the capture team.
- "sectionRef" is the source-document reference that prompted the question (e.g. "L.5.2.1", "M-3", "C.3"). Use "" if none directly applicable.
- Generate 8-25 questions total. Quality > quantity. If the doc is well-written and there's nothing to clarify, return a short list with high-confidence items rather than padding.
- Don't repeat questions across categories. Don't generate generic questions ("Could you clarify the period of performance?") — anchor every question in the doc.

Schema:
{
  "questions": [
    {
      "id": string,
      "category": "scope_ambiguity" | "evaluation_criteria" | "submission_logistics" | "technical_constraints" | "security_clearance" | "subcontracting",
      "text": string,
      "rationale": string,
      "sectionRef": string
    }
  ]
}`;

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
    .slice(0, 50)
    .map(
      (r) =>
        `  - ${r.kind.toUpperCase()} | ref=${r.sectionRef} | "${r.text.replace(/"/g, '\\"').slice(0, 400)}"`,
    )
    .join("\n");

  const evals = input.evaluationFactors
    .map(
      (f) =>
        `  - ${f.name} | weight=${f.weight || "(unstated)"} | ${f.notes}`,
    )
    .join("\n");

  const userPrompt = [
    `Solicitation: ${input.solicitationTitle}`,
    `Agency: ${input.agency || "(unknown)"}`,
    ``,
    `Review summary:`,
    input.reviewSummary || "(none)",
    ``,
    `Section L (instructions):`,
    input.sectionL.map((b) => `  - ${b}`).join("\n") || "(none)",
    ``,
    `Section M (evaluation factors):`,
    input.sectionM.map((b) => `  - ${b}`).join("\n") || "(none)",
    ``,
    `Evaluation factors:`,
    evals || "(none)",
    ``,
    `Requirements:`,
    reqs || "(none)",
    ``,
    `Items the review already flagged:`,
    input.flaggedQuestions.map((f) => `  - ${f}`).join("\n") || "(none)",
    ``,
    `Generate 8-25 categorized clarification questions. Return strict JSON per the schema in the system prompt.`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    system: QUESTION_GENERATOR_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  };
}

export const questionSetSchema = z.object({
  questions: z.array(
    z.object({
      id: z.string(),
      category: z.enum([
        "scope_ambiguity",
        "evaluation_criteria",
        "submission_logistics",
        "technical_constraints",
        "security_clearance",
        "subcontracting",
      ]),
      text: z.string(),
      rationale: z.string(),
      sectionRef: z.string(),
    }),
  ),
});
