import { z } from "zod";
import type { CapabilityMatrixCell } from "@/db/schema";
import {
  CAPABILITY_ANSWER_VALUES,
  CAPABILITY_EVIDENCE_MAX,
  type CapabilityAnswer,
  type CapabilityAnswerValue,
  type CapabilityQuestion,
  type CapabilitySuggestion,
  type CapabilitySuggestionSource,
} from "@/lib/capability-matrix-types";

/**
 * BL-CAP-MATRIX phase C — suggested answers. FORGE pre-fills a question
 * from what it already knows: the solicitation's AI-scored capability
 * matrix (BL-STAB-9b, one cell per requirement), the standing answers a
 * person gave on an earlier questionnaire, and (through one AI call) the
 * organisation's past performance and knowledge base. Pure: no DB, no AI.
 *
 * Nothing here counts. A suggestion sits beside the question until a
 * person confirms it (it becomes their answer), changes it, or dismisses
 * it; coverage and PWin read `answers` only.
 */

export const CAPABILITY_SUGGESTION_REASON_MAX = 300;
/** How many knowledge entries the suggestion prompt sees. */
export const CAPABILITY_SUGGESTION_KNOWLEDGE_LIMIT = 40;

/**
 * Standing questions that state a company fact, not an opportunity fact,
 * so the answer given on the last bid is a fair starting point: clearances,
 * certifications, facilities, financial capacity. Incumbency, key personnel,
 * past performance fit, geography and eligibility depend on the opportunity.
 */
export const CARRY_STANDING_IDS: ReadonlySet<string> = new Set(["s2", "s5", "s6", "s7"]);

/** A requirement row of the review the matrix was scored against. */
export type MatrixRequirement = { id: string; sectionRef: string };

/** Strongest first; a question is only as covered as its weakest requirement. */
const STRENGTH: Record<CapabilityAnswerValue, number> = {
  have_proven: 5,
  have_unproven: 4,
  partial: 3,
  gap_partner: 2,
  gap_none: 1,
  na: 0,
};

function cellValue(cell: CapabilityMatrixCell): CapabilityAnswerValue | null {
  switch (cell.status) {
    case "strong":
      return cell.capabilityRef ? "have_proven" : "have_unproven";
    case "partial":
      return "partial";
    case "gap":
      return "gap_none";
    default:
      return null;
  }
}

/**
 * Suggestions from the solicitation's scored matrix. A question's refs
 * name requirements; each matched cell gives a value, the weakest wins,
 * and the strongest cell's citation is the evidence.
 */
export function suggestFromMatrixCells(input: {
  questions: CapabilityQuestion[];
  requirements: MatrixRequirement[];
  cells: CapabilityMatrixCell[];
  /** knowledge entry id → title, for the citation's source label. */
  knowledgeTitles: ReadonlyMap<string, string>;
  now: string;
}): Record<string, CapabilitySuggestion> {
  const idsByRef = new Map<string, string[]>();
  for (const r of input.requirements) {
    if (!r.sectionRef) continue;
    idsByRef.set(r.sectionRef, [...(idsByRef.get(r.sectionRef) ?? []), r.id]);
  }
  const cellById = new Map(input.cells.map((c) => [c.requirementId, c]));
  const out: Record<string, CapabilitySuggestion> = {};

  for (const q of input.questions) {
    if (q.kind === "standing" || q.refs.length === 0) continue;
    const matched: { ref: string; cell: CapabilityMatrixCell; value: CapabilityAnswerValue }[] = [];
    for (const ref of q.refs) {
      for (const id of idsByRef.get(ref) ?? []) {
        const cell = cellById.get(id);
        const value = cell ? cellValue(cell) : null;
        if (cell && value) matched.push({ ref, cell, value });
      }
    }
    if (matched.length === 0) continue;

    const weakest = matched.reduce((a, b) => (STRENGTH[b.value] < STRENGTH[a.value] ? b : a));
    const strongest = matched.reduce((a, b) => (STRENGTH[b.value] > STRENGTH[a.value] ? b : a));
    const sources: CapabilitySuggestionSource[] = matched.map((m) => ({
      kind: "matrix",
      ref: m.ref,
      label: m.cell.status.replace("_", " "),
    }));
    for (const m of matched) {
      const entryId = m.cell.capabilityRef.startsWith("knowledge:") ? m.cell.capabilityRef.slice("knowledge:".length) : "";
      if (entryId && !sources.some((s) => s.kind === "knowledge" && s.ref === entryId)) {
        sources.push({ kind: "knowledge", ref: entryId, label: input.knowledgeTitles.get(entryId) ?? "Knowledge entry" });
      }
    }
    const counts = { strong: 0, partial: 0, gap: 0 };
    for (const m of matched) {
      if (m.cell.status === "strong") counts.strong += 1;
      else if (m.cell.status === "partial") counts.partial += 1;
      else counts.gap += 1;
    }
    out[q.id] = {
      value: weakest.value,
      evidence: (strongest.cell.citation || strongest.cell.narrative).trim().slice(0, CAPABILITY_EVIDENCE_MAX),
      reason: `The solicitation's capability matrix scored ${matched.length} requirement${matched.length === 1 ? "" : "s"} this question covers: ${counts.strong} strong, ${counts.partial} partial, ${counts.gap} gap.`,
      sources,
      suggestedAt: input.now,
    };
  }
  return out;
}

export type PriorQuestionnaire = {
  opportunityId: string;
  title: string;
  answers: Record<string, CapabilityAnswer>;
};

/**
 * Suggestions from earlier questionnaires: the most recent answer to each
 * carry-over standing question. A partner is not carried (it belongs to
 * the bid it was named on); the person names one again.
 */
export function suggestFromPriorAnswers(input: {
  questions: CapabilityQuestion[];
  /** Most recent first. */
  prior: PriorQuestionnaire[];
  now: string;
}): Record<string, CapabilitySuggestion> {
  const out: Record<string, CapabilitySuggestion> = {};
  for (const q of input.questions) {
    if (q.kind !== "standing" || !CARRY_STANDING_IDS.has(q.id)) continue;
    const hit = input.prior.find((p) => p.answers[q.id]);
    const a = hit?.answers[q.id];
    if (!hit || !a) continue;
    out[q.id] = {
      value: a.value,
      evidence: a.evidence,
      reason: `Answered on ${hit.title || "an earlier opportunity"} on ${a.updatedAt.slice(0, 10)}; company facts like this one usually carry over.`,
      sources: [{ kind: "prior", ref: hit.opportunityId, label: hit.title || "Earlier questionnaire" }],
      suggestedAt: input.now,
    };
  }
  return out;
}

/** What the model returns for the questions it can answer from the evidence. */
export const aiSuggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        questionId: z.string().max(12),
        value: z.enum(CAPABILITY_ANSWER_VALUES),
        evidence: z.string().max(600),
        reason: z.string().max(CAPABILITY_SUGGESTION_REASON_MAX),
        /** "knowledge:<id>" or "pp:<id>", from the evidence given. */
        sources: z.array(z.string().max(80)).max(6),
      }),
    )
    .max(40),
});
export type AiSuggestions = z.infer<typeof aiSuggestionSchema>;

export type AllowedSource = { kind: "knowledge" | "past_performance"; label: string };

/**
 * Keep only suggestions for questions that exist, with sources from the
 * evidence the prompt showed. "Have it, proven" needs a surviving source;
 * without one it is downgraded to "Have it, unproven".
 */
export function acceptAiSuggestions(input: {
  parsed: AiSuggestions;
  questions: CapabilityQuestion[];
  allowed: ReadonlyMap<string, AllowedSource>;
  now: string;
}): Record<string, CapabilitySuggestion> {
  const ids = new Set(input.questions.map((q) => q.id));
  const out: Record<string, CapabilitySuggestion> = {};
  for (const s of input.parsed.suggestions) {
    if (!ids.has(s.questionId) || out[s.questionId]) continue;
    const sources: CapabilitySuggestionSource[] = [];
    for (const ref of s.sources) {
      const a = input.allowed.get(ref.trim());
      if (a && !sources.some((x) => x.ref === ref.trim())) sources.push({ kind: a.kind, ref: ref.trim(), label: a.label });
    }
    const value: CapabilityAnswerValue = s.value === "have_proven" && sources.length === 0 ? "have_unproven" : s.value;
    out[s.questionId] = {
      value,
      evidence: s.evidence.trim().slice(0, CAPABILITY_EVIDENCE_MAX),
      reason: s.reason.trim().slice(0, CAPABILITY_SUGGESTION_REASON_MAX),
      sources,
      suggestedAt: input.now,
    };
  }
  return out;
}

/**
 * One map: answered questions get nothing (the answer stands); for the
 * rest the first layer with a suggestion wins, so the matrix and the
 * earlier questionnaires lead and the AI fills what they left.
 */
export function mergeSuggestions(
  questions: CapabilityQuestion[],
  answers: Record<string, CapabilityAnswer>,
  layers: Record<string, CapabilitySuggestion>[],
): Record<string, CapabilitySuggestion> {
  const out: Record<string, CapabilitySuggestion> = {};
  for (const q of questions) {
    if (answers[q.id]) continue;
    for (const layer of layers) {
      const s = layer[q.id];
      if (s) {
        out[q.id] = s;
        break;
      }
    }
  }
  return out;
}

/** Suggestions still waiting on a person (the question has no answer yet). */
export function pendingSuggestions(
  questions: CapabilityQuestion[],
  answers: Record<string, CapabilityAnswer>,
  suggestions: Record<string, CapabilitySuggestion>,
): number {
  return questions.filter((q) => !answers[q.id] && suggestions[q.id]).length;
}
