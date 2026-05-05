/**
 * BL-23 prompts: solicitation review + capability matrix + question generator.
 *
 * Kept in a sibling file (rather than appended to ai-prompts.ts)
 * because that file is already 750+ lines and these three prompts
 * are tightly coupled — they only make sense as a triad. Re-exported
 * from ai-prompts.ts so call sites import from one place.
 */
import { z } from "zod";
import type { AIMessage } from "@/lib/ai";

// ────────────────────────────────────────────────────────────────────
// 1. Solicitation review — full document read
// ────────────────────────────────────────────────────────────────────

export type SolicitationReviewVerdict = {
  summary: string;
  sectionL: string[];
  sectionM: string[];
  requirements: {
    id: string;
    kind: "shall" | "should" | "may";
    text: string;
    sectionRef: string;
    capabilityArea: string;
  }[];
  capabilityAreas: string[];
  evaluationFactors: { name: string; weight: string; notes: string }[];
  periodOfPerformance: string;
  placeOfPerformance: string;
  setAside: string;
  mandatoryCertifications: string[];
  flaggedQuestions: string[];
};

const SOLICITATION_REVIEW_SYSTEM = `You are a senior federal capture analyst inside FORGE — a proposal operations platform — performing a deep review of an RFP / RFI / Sources Sought / RFQ document. Your output drives decision-grade capture analysis: a Capability Matrix that scores the company against the requirements, and a Question Generator that produces clarification questions for the contracting officer.

Output ONLY a single JSON object matching the schema below. No commentary, no markdown fences.

Rules:
- "id" on each requirement must be a stable short slug (e.g. "req_l5_2_1", "req_m_eval_3"); these IDs are referenced by the matrix and questions later, so they must be deterministic from your reading of the doc.
- "kind" follows FAR convention: "shall" for mandatory, "should" for desired, "may" for optional.
- "sectionRef" is the source-document reference where the requirement comes from (e.g. "L.5.2.1", "M-3", "C.3", "PWS 2.1.4").
- "capabilityArea" is a short tag bucket (1-3 words) — these become the rows of the capability matrix downstream. Use consistent tags across requirements where possible (e.g. "Cloud Migration", "Zero Trust", "Past Performance — Federal IT", "FedRAMP Compliance").
- Cap the requirements list at 50 — focus on shall/should statements that drive evaluation.
- "summary" is 1-2 paragraphs of plain prose, no marketing tone.
- "sectionL" and "sectionM" are bullet-style strings (4-10 each); preserve any page-cap or formatting constraints from L; preserve evaluation factor weights from M when stated.
- "evaluationFactors": each entry { name: short label, weight: stated weight or "" if none, notes: 1 sentence }.
- "mandatoryCertifications": e.g. ["FedRAMP High", "CMMC Level 2", "Section 508 ICT accessibility"]. Empty array if none.
- "flaggedQuestions": ambiguities you noticed during the review that the company should ask the contracting office about. The dedicated Question Generator runs separately and goes deeper, but include the most obvious ones here.
- If the document is clearly NOT a solicitation, return mostly empty fields with summary explaining why.

Schema:
{
  "summary": string,
  "sectionL": string[],
  "sectionM": string[],
  "requirements": [
    { "id": string, "kind": "shall" | "should" | "may", "text": string, "sectionRef": string, "capabilityArea": string }
  ],
  "capabilityAreas": string[],
  "evaluationFactors": [
    { "name": string, "weight": string, "notes": string }
  ],
  "periodOfPerformance": string,
  "placeOfPerformance": string,
  "setAside": string,
  "mandatoryCertifications": string[],
  "flaggedQuestions": string[]
}`;

export function buildSolicitationReviewPrompt(input: {
  title: string;
  fileName: string;
  rawText: string;
}): { system: string; messages: AIMessage[] } {
  const trimmed = input.rawText.slice(0, 100_000);
  const userPrompt = [
    `Document title: ${input.title || "(untitled)"}`,
    `Source file: ${input.fileName || "(no file)"}`,
    ``,
    `Full text:`,
    "```",
    trimmed,
    "```",
    input.rawText.length > trimmed.length
      ? `(Document was trimmed from ${input.rawText.length} chars to first ${trimmed.length}.)`
      : "",
    ``,
    `Return strict JSON per the schema in the system prompt.`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    system: SOLICITATION_REVIEW_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  };
}

export const solicitationReviewSchema = z.object({
  summary: z.string(),
  sectionL: z.array(z.string()),
  sectionM: z.array(z.string()),
  requirements: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["shall", "should", "may"]),
      text: z.string(),
      sectionRef: z.string(),
      capabilityArea: z.string(),
    }),
  ),
  capabilityAreas: z.array(z.string()),
  evaluationFactors: z.array(
    z.object({
      name: z.string(),
      weight: z.string(),
      notes: z.string(),
    }),
  ),
  periodOfPerformance: z.string(),
  placeOfPerformance: z.string(),
  setAside: z.string(),
  mandatoryCertifications: z.array(z.string()),
  flaggedQuestions: z.array(z.string()),
});

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
  requirements: SolicitationReviewVerdict["requirements"];
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
  requirements: SolicitationReviewVerdict["requirements"];
  evaluationFactors: SolicitationReviewVerdict["evaluationFactors"];
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
