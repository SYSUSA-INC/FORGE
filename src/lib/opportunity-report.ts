/**
 * BL-NAV-LIFECYCLE phase 2b-2 (FORGE II footnote 5, E-8) — the Matrix
 * Report: a snapshot of the capability matrix as it stands when someone
 * clicks Save report. Each requirement with its answer, percentage and
 * evidence, the coverage score, the gaps, and whether a partner is needed.
 * Kept as JSON on `opportunity_report`, so a later change to the matrix
 * never rewrites a saved report. Pure.
 */
import { computeCapabilityCoverage } from "@/lib/capability-coverage";
import {
  answerLabel,
  clampPartialPercent,
  PARTIAL_PERCENT,
  threeAnswerCounts,
  threeAnswerOf,
  type CapabilityAnswer,
  type CapabilityQuestion,
  type ThreeAnswer,
} from "@/lib/capability-matrix-types";

export const MATRIX_REPORT_SCHEMA = 1;

export type MatrixReportRow = {
  id: string;
  area: string;
  kind: CapabilityQuestion["kind"];
  refs: string[];
  text: string;
  /** null when unanswered. */
  answer: ThreeAnswer | null;
  label: string;
  percent: number | null;
  proven: boolean;
  evidence: string;
  partner: string | null;
};

export type MatrixReportBody = {
  kind: "matrix";
  schema: number;
  generatedAt: string;
  opportunity: { title: string; agency: string; solicitationNumber: string; naics: string; dueDate: string | null };
  coverage: number | null;
  shallCoverage: number | null;
  partnerNeeded: boolean;
  counts: Record<ThreeAnswer, number> & { unanswered: number };
  total: number;
  rows: MatrixReportRow[];
  gaps: { text: string; refs: string[]; partner: string | null }[];
};

export function buildMatrixReport(input: {
  opportunity: MatrixReportBody["opportunity"];
  questions: CapabilityQuestion[];
  answers: Record<string, CapabilityAnswer>;
  /** Company names by id, for a named partner. */
  partnerNames: Record<string, string>;
  now: Date;
}): MatrixReportBody {
  const c = computeCapabilityCoverage(input.questions, input.answers);
  const counts = threeAnswerCounts(input.questions, input.answers);
  const answered = counts.yes + counts.partial + counts.no + counts.na;
  const partnerOf = (a: CapabilityAnswer | undefined) => (a?.partnerCompanyId ? input.partnerNames[a.partnerCompanyId] ?? null : null);
  const rows: MatrixReportRow[] = input.questions.map((q) => {
    const a = input.answers[q.id];
    const three = a ? threeAnswerOf(a.value) : null;
    return {
      id: q.id,
      area: q.area,
      kind: q.kind,
      refs: q.refs,
      text: q.text,
      answer: three?.answer ?? null,
      label: a ? answerLabel(a) : "Not answered",
      percent: a?.value === "partial" ? clampPartialPercent(a.percent ?? PARTIAL_PERCENT.default) : null,
      proven: three?.proven ?? false,
      evidence: a?.evidence ?? "",
      partner: partnerOf(a),
    };
  });
  return {
    kind: "matrix",
    schema: MATRIX_REPORT_SCHEMA,
    generatedAt: input.now.toISOString(),
    opportunity: input.opportunity,
    coverage: c.coverage,
    shallCoverage: c.shallCoverage,
    partnerNeeded: c.partnerNeeded,
    counts: { ...counts, unanswered: input.questions.length - answered },
    total: input.questions.length,
    rows,
    gaps: c.gaps.map((g) => ({ text: g.text, refs: g.refs, partner: partnerOf(input.answers[g.questionId]) })),
  };
}

/** A saved body read back: the Matrix Report shape, or null for anything else. */
export function asMatrixReport(body: unknown): MatrixReportBody | null {
  const b = body as Partial<MatrixReportBody> | null;
  return b && b.kind === "matrix" && Array.isArray(b.rows) && b.opportunity ? (b as MatrixReportBody) : null;
}

export const REPORT_LABELS = { matrix: "Matrix Report", analysis: "Analysis Report" } as const;
