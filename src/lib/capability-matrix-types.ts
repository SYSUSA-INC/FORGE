import { z } from "zod";
import type { SolicitationRequirement } from "@/db/schema";

/**
 * BL-CAP-MATRIX — the capability matrix as a questionnaire. Pure types and
 * logic (no DB, no AI): the question set, the answer scale, the standing
 * questions every opportunity gets, and the carry-over of answers when the
 * questions are rebuilt from a re-parsed solicitation.
 */

export type CapabilityQuestionKind = "shall" | "should" | "may" | "standing";

export type CapabilityQuestion = {
  /** "s1".."s9" for standing questions, "q1".. for drafted ones. */
  id: string;
  text: string;
  /** Requirement references the question covers (e.g. "C.3.2"); empty for standing. */
  refs: string[];
  kind: CapabilityQuestionKind;
  /** Short grouping label ("Security", "Staffing", "Past performance"). */
  area: string;
};

export const CAPABILITY_ANSWER_VALUES = [
  "have_proven",
  "have_unproven",
  "partial",
  "gap_partner",
  "gap_none",
  "na",
] as const;
export type CapabilityAnswerValue = (typeof CAPABILITY_ANSWER_VALUES)[number];

export const CAPABILITY_ANSWER_LABELS: Record<CapabilityAnswerValue, string> = {
  have_proven: "Have it, proven",
  have_unproven: "Have it, unproven",
  partial: "Partial",
  gap_partner: "Gap: partner needed",
  gap_none: "Gap: no plan",
  na: "Not applicable",
};

export type CapabilityAnswer = {
  value: CapabilityAnswerValue;
  /** A past-performance or knowledge-base citation, or a note. */
  evidence: string;
  /** A company (teaming partner or subcontractor) that would cover a gap. */
  partnerCompanyId: string | null;
  updatedAt: string;
  updatedByUserId: string;
};

/** Where a suggested answer came from (phase C). */
export type CapabilitySuggestionSource =
  | { kind: "matrix"; ref: string; label: string }
  | { kind: "knowledge"; ref: string; label: string }
  | { kind: "past_performance"; ref: string; label: string }
  | { kind: "prior"; ref: string; label: string }
  | { kind: "model"; ref: string; label: string };

/**
 * An answer FORGE proposes. It never counts: coverage and PWin read
 * `answers` only. A person confirms it (it becomes an answer) or
 * changes it (their own answer replaces it) or dismisses it.
 */
export type CapabilitySuggestion = {
  value: CapabilityAnswerValue;
  evidence: string;
  /** One sentence on why, for the person deciding. */
  reason: string;
  sources: CapabilitySuggestionSource[];
  suggestedAt: string;
};

export const CAPABILITY_EVIDENCE_MAX = 1_000;
export const CAPABILITY_QUESTION_TEXT_MAX = 400;
export const CAPABILITY_DRAFTED_MAX = 20;
export const CAPABILITY_DRAFTED_MIN = 10;

/** Asked on every opportunity, before the drafted questions. */
export const STANDING_QUESTIONS: ReadonlyArray<Omit<CapabilityQuestion, "refs" | "kind">> = [
  { id: "s1", area: "Position", text: "Are we the incumbent, or a subcontractor on the incumbent contract?" },
  { id: "s2", area: "Security", text: "Do we hold the facility and personnel clearances the work needs?" },
  { id: "s3", area: "Staffing", text: "Can we name the key personnel the solicitation asks for, with the required experience?" },
  { id: "s4", area: "Past performance", text: "Do we have relevant past performance from the last 3 to 5 years, at a similar size and scope?" },
  { id: "s5", area: "Certifications", text: "Do we hold the certifications named or implied (CMMC, ISO, FedRAMP, or others)?" },
  { id: "s6", area: "Facilities", text: "Do we have the facility, equipment and systems the work needs?" },
  { id: "s7", area: "Financial", text: "Can we fund the start-up and carry the cash flow for a contract of this size?" },
  { id: "s8", area: "Geography", text: "Can we perform at the place of performance, with the on-site presence required?" },
  { id: "s9", area: "Eligibility", text: "Are we eligible for the set-aside, and is the NAICS code one we perform under?" },
];

/** What the model returns: drafted questions only (standing ones are added here). */
export const draftedQuestionSchema = z.object({
  questions: z
    .array(
      z.object({
        text: z.string().min(8).max(CAPABILITY_QUESTION_TEXT_MAX),
        refs: z.array(z.string().max(40)).max(12),
        kind: z.enum(["shall", "should", "may"]),
        area: z.string().min(2).max(40),
      }),
    )
    .min(1)
    .max(CAPABILITY_DRAFTED_MAX),
});
export type DraftedQuestions = z.infer<typeof draftedQuestionSchema>;

/**
 * The full question set: standing questions first, then the drafted ones
 * with ids q1.., de-duplicated by text, capped, and with refs trimmed to
 * ones the requirement list actually has (the model may invent a ref).
 */
export function buildQuestionSet(
  drafted: DraftedQuestions["questions"],
  knownRefs: ReadonlySet<string>,
): CapabilityQuestion[] {
  const standing: CapabilityQuestion[] = STANDING_QUESTIONS.map((q) => ({ ...q, refs: [], kind: "standing" }));
  const seen = new Set<string>(standing.map((q) => normalise(q.text)));
  const out: CapabilityQuestion[] = [];
  for (const q of drafted) {
    const key = normalise(q.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `q${out.length + 1}`,
      text: q.text.trim(),
      refs: q.refs.map((r) => r.trim()).filter((r) => r && knownRefs.has(r)),
      kind: q.kind,
      area: q.area.trim() || "General",
    });
    if (out.length >= CAPABILITY_DRAFTED_MAX) break;
  }
  return [...standing, ...out];
}

/**
 * After a rebuild, keep an answer when its question still exists with the
 * same text (standing questions always carry over; drafted ones carry over
 * by text, not id, since ids are re-numbered).
 */
export function carryOverAnswers(
  previousQuestions: CapabilityQuestion[],
  previousAnswers: Record<string, CapabilityAnswer>,
  nextQuestions: CapabilityQuestion[],
): Record<string, CapabilityAnswer> {
  const byText = new Map<string, CapabilityAnswer>();
  for (const q of previousQuestions) {
    const a = previousAnswers[q.id];
    if (a) byText.set(q.kind === "standing" ? q.id : normalise(q.text), a);
  }
  const out: Record<string, CapabilityAnswer> = {};
  for (const q of nextQuestions) {
    const a = byText.get(q.kind === "standing" ? q.id : normalise(q.text));
    if (a) out[q.id] = a;
  }
  return out;
}

/** Names the requirement set the questions came from. */
export function parseVersionOf(input: {
  primarySolicitationId: string | null;
  requirements: SolicitationRequirement[];
}): string {
  const refs = input.requirements.map((r) => r.ref).sort().join("|");
  let h = 0;
  for (let i = 0; i < refs.length; i++) h = (h * 31 + refs.charCodeAt(i)) | 0;
  return `${input.primarySolicitationId ?? "none"}:${input.requirements.length}:${(h >>> 0).toString(16)}`;
}

export function answeredCount(questions: CapabilityQuestion[], answers: Record<string, CapabilityAnswer>): number {
  return questions.filter((q) => answers[q.id]).length;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
