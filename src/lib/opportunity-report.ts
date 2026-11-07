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

// ── BL-NAV-LIFECYCLE 2c — the Analysis Report ─────────────────────────

export const ANALYSIS_REPORT_SCHEMA = 1;

export type AnalysisCall = "pursue" | "watch" | "no_bid";
export const ANALYSIS_CALL_LABELS: Record<AnalysisCall, string> = { pursue: "Pursue", watch: "Watch", no_bid: "Consider no-bid" };

/**
 * The Analysis Report (E-3, E-4): the call and why, the win probability
 * with its factors, fit, competition, risks, what would raise PWin, and
 * what FORGE read. The PWin and its factors come from the model, never
 * the AI; the AI writes the call and the lines.
 */
export type AnalysisReportBody = {
  kind: "analysis";
  schema: number;
  generatedAt: string;
  opportunity: MatrixReportBody["opportunity"];
  call: AnalysisCall;
  summary: string;
  pwin: { pwin: number; confidence: string; factors: { label: string; logOdds: number; detail: string }[] } | null;
  fit: string[];
  competition: string[];
  risks: string[];
  raisePwin: string[];
  sources: string[];
  /** The AI wasn't available (no provider configured): the lines are FORGE's own, from the facts. */
  stubbed: boolean;
  model: string;
};

export function buildAnalysisReport(input: {
  opportunity: MatrixReportBody["opportunity"];
  pwin: AnalysisReportBody["pwin"];
  ai: { call: AnalysisCall; summary: string; fit: string[]; competition: string[]; risks: string[]; raisePwin: string[] };
  sources: string[];
  stubbed: boolean;
  model: string;
  now: Date;
}): AnalysisReportBody {
  const clean = (xs: string[], n: number) => xs.map((x) => x.trim()).filter(Boolean).slice(0, n);
  return {
    kind: "analysis",
    schema: ANALYSIS_REPORT_SCHEMA,
    generatedAt: input.now.toISOString(),
    opportunity: input.opportunity,
    call: input.ai.call,
    summary: input.ai.summary.trim(),
    pwin: input.pwin,
    fit: clean(input.ai.fit, 5),
    competition: clean(input.ai.competition, 5),
    risks: clean(input.ai.risks, 6),
    raisePwin: clean(input.ai.raisePwin, 5),
    sources: input.sources,
    stubbed: input.stubbed,
    model: input.model,
  };
}

/**
 * With no AI provider: a report from the facts alone, so the page still
 * works on a deployment without AI (marked as such).
 */
export function factsOnlyAnalysis(input: {
  pwin: AnalysisReportBody["pwin"];
  briefCall: AnalysisCall | null;
  coverage: number | null;
  partnerNeeded: boolean;
  gaps: string[];
  competitors: { name: string; incumbent: boolean }[];
  incumbent: string;
}): { call: AnalysisCall; summary: string; fit: string[]; competition: string[]; risks: string[]; raisePwin: string[] } {
  const p = input.pwin?.pwin ?? null;
  const call: AnalysisCall = input.briefCall ?? (p === null ? "watch" : p >= 40 ? "pursue" : p >= 20 ? "watch" : "no_bid");
  const factors = input.pwin?.factors ?? [];
  const helps = factors.filter((f) => f.logOdds > 0).sort((a, b) => b.logOdds - a.logOdds);
  const hurts = factors.filter((f) => f.logOdds < 0).sort((a, b) => a.logOdds - b.logOdds);
  const incumbent = input.competitors.find((c) => c.incumbent)?.name || input.incumbent;
  return {
    call,
    summary: `${ANALYSIS_CALL_LABELS[call]}: PWin ${p === null ? "is not known yet" : `${p}%`}${input.coverage === null ? ", with no capability matrix yet" : `, capability coverage ${Math.round(input.coverage * 100)}%`}.`,
    fit: helps.slice(0, 5).map((f) => `${f.label}: ${f.detail}`),
    competition: incumbent ? [`Incumbent: ${incumbent}`, ...input.competitors.filter((c) => !c.incumbent).slice(0, 4).map((c) => `Competitor: ${c.name}`)] : ["No incumbent or competitors logged yet."],
    risks: [...hurts.slice(0, 4).map((f) => `${f.label}: ${f.detail}`), ...input.gaps.slice(0, 2).map((g) => `Capability gap: ${g}`)],
    raisePwin: [
      ...(input.coverage === null ? ["Build and answer the capability matrix."] : []),
      ...(input.partnerNeeded ? ["Name a partner for the open gaps."] : []),
      ...(incumbent ? [] : ["Identify the incumbent and the likely competitors."]),
    ],
  };
}

/** A saved body read back as an Analysis Report, or null. */
export function asAnalysisReport(body: unknown): AnalysisReportBody | null {
  const b = body as Partial<AnalysisReportBody> | null;
  return b && b.kind === "analysis" && typeof b.summary === "string" && b.opportunity ? (b as AnalysisReportBody) : null;
}
