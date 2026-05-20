"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { StubModeBanner } from "@/components/ui/StubModeBanner";
import {
  runCapabilityMatrixAction,
  runQuestionGeneratorAction,
  runSolicitationReviewAction,
} from "./review-actions";
import type {
  CapabilityMatrixCell,
  SolicitationQuestion,
  SolicitationReviewResult,
  SolicitationReviewStatus,
} from "@/db/schema";

const STATUS_LABEL: Record<SolicitationReviewStatus | "none", string> = {
  none: "Not started",
  pending: "Pending",
  running: "Running",
  complete: "Complete",
  failed: "Failed",
};

const STATUS_TONE: Record<SolicitationReviewStatus | "none", string> = {
  none: "border-white/15 bg-white/5 text-muted",
  pending: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  running: "border-cobalt-400/40 bg-cobalt-400/10 text-cobalt",
  complete: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  failed: "border-rose/40 bg-rose/10 text-rose",
};

const CELL_TONE: Record<CapabilityMatrixCell["status"], string> = {
  strong: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  partial: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  gap: "border-rose/40 bg-rose/10 text-rose",
  not_addressed: "border-white/15 bg-white/[0.04] text-muted",
};

const CELL_LABEL: Record<CapabilityMatrixCell["status"], string> = {
  strong: "Strong",
  partial: "Partial",
  gap: "Gap",
  not_addressed: "Not addressed",
};

const CATEGORY_LABEL: Record<SolicitationQuestion["category"], string> = {
  scope_ambiguity: "Scope ambiguity",
  evaluation_criteria: "Evaluation criteria",
  submission_logistics: "Submission logistics",
  technical_constraints: "Technical constraints",
  security_clearance: "Security / clearance",
  subcontracting: "Subcontracting / set-aside",
};

type ReviewState = {
  status: SolicitationReviewStatus | "none";
  result: SolicitationReviewResult | null;
  error: string;
  stubbed: boolean;
  model: string;
  completedAt: string | null;
};

type MatrixState = {
  cells: CapabilityMatrixCell[];
  pwinLow: number;
  pwinHigh: number;
  stubbed: boolean;
  createdAt: string | null;
} | null;

type QuestionState = {
  questions: SolicitationQuestion[];
  stubbed: boolean;
  createdAt: string | null;
} | null;

type KnowledgeIndexEntry = { id: string; title: string; kind: string };

/**
 * BL-23 orchestrator panel — surfaces the three-button workflow on
 * a solicitation detail page (Initiate Review / Create Capability
 * Matrix / Generate Questions) plus collapsible result sections for
 * each. Buttons 2 and 3 are disabled until review completes; tooltip
 * explains why. All three call dedicated server actions.
 */
export function SolicitationReviewPanel({
  solicitationId,
  initialReview,
  initialMatrix,
  initialQuestions,
  knowledgeIndex,
  hasRawText,
}: {
  solicitationId: string;
  initialReview: ReviewState;
  initialMatrix: MatrixState;
  initialQuestions: QuestionState;
  /** Lookup table for resolving capabilityRef → entry title. */
  knowledgeIndex: KnowledgeIndexEntry[];
  /** Whether the underlying solicitation has parsed text yet. */
  hasRawText: boolean;
}) {
  const router = useRouter();
  const [review, _setReview] = useState<ReviewState>(initialReview);
  const [matrix, _setMatrix] = useState<MatrixState>(initialMatrix);
  const [questions, _setQuestions] = useState<QuestionState>(initialQuestions);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, startReview] = useTransition();
  const [matrixing, startMatrix] = useTransition();
  const [questioning, startQuestion] = useTransition();
  const [openSection, setOpenSection] = useState<
    "review" | "matrix" | "questions" | null
  >(initialMatrix ? "matrix" : initialReview.status === "complete" ? "review" : null);

  const reviewComplete = review.status === "complete";
  const downstreamDisabled = !reviewComplete;

  const knowledgeIndexById = useMemo(() => {
    const m = new Map<string, KnowledgeIndexEntry>();
    for (const k of knowledgeIndex) m.set(k.id, k);
    return m;
  }, [knowledgeIndex]);

  function runReview() {
    setError(null);
    startReview(async () => {
      const res = await runSolicitationReviewAction(solicitationId);
      if (!res.ok) {
        setError(res.error);
        // Refresh status anyway so failed state is reflected.
        router.refresh();
        return;
      }
      // The server action already revalidated the page; ask Next to
      // re-fetch so we get the persisted review state cleanly.
      router.refresh();
    });
  }

  function runMatrix() {
    setError(null);
    startMatrix(async () => {
      const res = await runCapabilityMatrixAction(solicitationId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      setOpenSection("matrix");
    });
  }

  function runQuestions() {
    setError(null);
    startQuestion(async () => {
      const res = await runQuestionGeneratorAction(solicitationId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      setOpenSection("questions");
    });
  }

  const canReview = hasRawText && !reviewing;

  return (
    <Panel
      title="AI document review"
      eyebrow="BL-23"
      actions={
        <span
          className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${STATUS_TONE[review.status]}`}
        >
          {STATUS_LABEL[review.status]}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="font-body text-[13px] leading-relaxed text-muted">
          Run a deep AI read of this solicitation. Once the review is
          complete you can build a capability matrix scoring the company
          against the requirements, and generate clarification questions
          for the contracting officer.
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={runReview}
            disabled={!canReview}
            className="aur-btn aur-btn-primary text-[12px] disabled:opacity-60"
            title={
              !hasRawText
                ? "Solicitation hasn't been parsed yet. Wait for the upload pipeline to finish, or re-upload the file."
                : reviewing
                  ? "Running…"
                  : reviewComplete
                    ? "Re-run the review with the latest doc text"
                    : "Run the review"
            }
          >
            {reviewing
              ? "Running review…"
              : reviewComplete
                ? "Re-run review"
                : "Initiate review"}
          </button>
          <button
            type="button"
            onClick={runMatrix}
            disabled={downstreamDisabled || matrixing}
            className="aur-btn aur-btn-ghost text-[12px] disabled:opacity-50"
            title={
              downstreamDisabled
                ? "Run the document review first."
                : matrixing
                  ? "Running…"
                  : "Score the company's knowledge corpus against each requirement."
            }
          >
            {matrixing
              ? "Building matrix…"
              : matrix
                ? "Re-build capability matrix"
                : "Create capability matrix"}
          </button>
          <button
            type="button"
            onClick={runQuestions}
            disabled={downstreamDisabled || questioning}
            className="aur-btn aur-btn-ghost text-[12px] disabled:opacity-50"
            title={
              downstreamDisabled
                ? "Run the document review first."
                : questioning
                  ? "Running…"
                  : "Generate clarification questions for the contracting officer."
            }
          >
            {questioning
              ? "Generating…"
              : questions
                ? "Re-generate questions"
                : "Generate questions"}
          </button>
        </div>

        {!hasRawText ? (
          <div className="rounded-md border border-amber-400/40 bg-amber-400/[0.06] px-3 py-2 font-mono text-[11px] text-amber-200">
            Waiting on the parse pipeline — once the document text is
            extracted the review buttons become available.
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}

        {review.stubbed && reviewComplete ? (
          <StubModeBanner
            envVar="ANTHROPIC_API_KEY"
            message="Document review ran in stub mode. The result panel below is a deterministic placeholder — set the env var to run a real review against the uploaded document."
          />
        ) : null}

        {review.status === "failed" && review.error ? (
          <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            <strong>Review failed:</strong> {review.error}
          </div>
        ) : null}
      </div>

      {/* Result sections — collapsible. Auto-expand the most-recent
          one so capture managers see fresh output without an extra click. */}
      {reviewComplete && review.result ? (
        <div className="mt-5 flex flex-col gap-2">
          <Section
            title="Review output"
            eyebrow={`${review.result.requirements.length} requirements · model ${review.model || "(unknown)"}`}
            open={openSection === "review"}
            onToggle={() =>
              setOpenSection((cur) => (cur === "review" ? null : "review"))
            }
          >
            <ReviewView result={review.result} />
          </Section>

          {matrix ? (
            <Section
              title="Capability matrix"
              eyebrow={`${matrix.cells.length} cells · PWin recommendation ${matrix.pwinLow}–${matrix.pwinHigh}%${matrix.stubbed ? " · stub mode" : ""}`}
              open={openSection === "matrix"}
              onToggle={() =>
                setOpenSection((cur) =>
                  cur === "matrix" ? null : "matrix",
                )
              }
            >
              <MatrixView
                cells={matrix.cells}
                requirements={review.result.requirements}
                knowledgeIndexById={knowledgeIndexById}
              />
            </Section>
          ) : null}

          {questions ? (
            <Section
              title="Clarification questions"
              eyebrow={`${questions.questions.length} questions${questions.stubbed ? " · stub mode" : ""}`}
              open={openSection === "questions"}
              onToggle={() =>
                setOpenSection((cur) =>
                  cur === "questions" ? null : "questions",
                )
              }
            >
              <QuestionList questions={questions.questions} />
            </Section>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function Section({
  title,
  eyebrow,
  open,
  onToggle,
  children,
}: {
  title: string;
  eyebrow: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
      >
        <div className="min-w-0 flex-1">
          <div className="font-display text-[13px] font-semibold text-text">
            {title}
          </div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-muted">
            {eyebrow}
          </div>
        </div>
        <span
          aria-hidden
          className="grid h-5 w-5 place-items-center rounded-md border border-white/10 bg-white/[0.03] font-mono text-[12px] text-muted"
        >
          {open ? "−" : "+"}
        </span>
      </button>
      {open ? (
        <div className="border-t border-white/10 px-3 py-3">{children}</div>
      ) : null}
    </div>
  );
}

function ReviewView({ result }: { result: SolicitationReviewResult }) {
  return (
    <div className="flex flex-col gap-4">
      {result.summary ? (
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-subtle">
            Summary
          </div>
          <p className="whitespace-pre-wrap font-body text-[13px] leading-relaxed text-text">
            {result.summary}
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {result.sectionL.length > 0 ? (
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-subtle">
              Section L · Instructions
            </div>
            <ul className="flex list-disc flex-col gap-1 pl-4 font-body text-[13px] text-text">
              {result.sectionL.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {result.sectionM.length > 0 ? (
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-subtle">
              Section M · Evaluation
            </div>
            <ul className="flex list-disc flex-col gap-1 pl-4 font-body text-[13px] text-text">
              {result.sectionM.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {result.evaluationFactors.length > 0 ? (
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-subtle">
            Evaluation factors
          </div>
          <ul className="flex flex-col gap-1">
            {result.evaluationFactors.map((f, i) => (
              <li
                key={i}
                className="flex items-start justify-between gap-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5 font-mono text-[11px]"
              >
                <span className="min-w-0 flex-1 truncate text-text">
                  {f.name}
                </span>
                {f.weight ? (
                  <span className="shrink-0 text-cobalt">{f.weight}</span>
                ) : null}
                {f.notes ? (
                  <span className="ml-2 hidden min-w-0 truncate text-muted md:inline">
                    {f.notes}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.requirements.length > 0 ? (
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-subtle">
            Requirements ({result.requirements.length})
          </div>
          <ul className="flex flex-col gap-1.5">
            {result.requirements.map((r) => (
              <li
                key={r.id}
                className="flex items-start gap-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
              >
                <span
                  className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${
                    r.kind === "shall"
                      ? "border border-rose/40 bg-rose/10 text-rose"
                      : r.kind === "should"
                        ? "border border-amber-400/40 bg-amber-400/10 text-amber-200"
                        : "border border-white/15 bg-white/5 text-muted"
                  }`}
                >
                  {r.kind}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-body text-[13px] leading-relaxed text-text">
                    {r.text}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 font-mono text-[10px] uppercase tracking-widest text-subtle">
                    {r.sectionRef ? <span>{r.sectionRef}</span> : null}
                    {r.capabilityArea ? (
                      <span className="text-cobalt">
                        {r.capabilityArea}
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.flaggedQuestions.length > 0 ? (
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-subtle">
            Questions flagged during review
          </div>
          <ul className="flex list-disc flex-col gap-1 pl-4 font-body text-[12px] text-text">
            {result.flaggedQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {(result.periodOfPerformance ||
        result.placeOfPerformance ||
        result.setAside ||
        result.mandatoryCertifications.length > 0) && (
        <div className="grid grid-cols-1 gap-2 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 font-mono text-[11px] md:grid-cols-2">
          {result.periodOfPerformance ? (
            <Row label="PoP" value={result.periodOfPerformance} />
          ) : null}
          {result.placeOfPerformance ? (
            <Row label="Place" value={result.placeOfPerformance} />
          ) : null}
          {result.setAside ? <Row label="Set-aside" value={result.setAside} /> : null}
          {result.mandatoryCertifications.length > 0 ? (
            <Row
              label="Certs"
              value={result.mandatoryCertifications.join(", ")}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function MatrixView({
  cells,
  requirements,
  knowledgeIndexById,
}: {
  cells: CapabilityMatrixCell[];
  requirements: SolicitationReviewResult["requirements"];
  knowledgeIndexById: Map<string, KnowledgeIndexEntry>;
}) {
  const reqsById = useMemo(() => {
    const m = new Map<string, (typeof requirements)[number]>();
    for (const r of requirements) m.set(r.id, r);
    return m;
  }, [requirements]);

  const counts = useMemo(() => {
    const c = { strong: 0, partial: 0, gap: 0, not_addressed: 0 };
    for (const cell of cells) c[cell.status]++;
    return c;
  }, [cells]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-widest">
        <span className={`rounded border px-2 py-0.5 ${CELL_TONE.strong}`}>
          {counts.strong} strong
        </span>
        <span className={`rounded border px-2 py-0.5 ${CELL_TONE.partial}`}>
          {counts.partial} partial
        </span>
        <span className={`rounded border px-2 py-0.5 ${CELL_TONE.gap}`}>
          {counts.gap} gap
        </span>
        <span
          className={`rounded border px-2 py-0.5 ${CELL_TONE.not_addressed}`}
        >
          {counts.not_addressed} not addressed
        </span>
      </div>

      <ul className="flex flex-col gap-1.5">
        {cells.map((cell) => {
          const req = reqsById.get(cell.requirementId);
          const knowledgeId = cell.capabilityRef.startsWith("knowledge:")
            ? cell.capabilityRef.slice("knowledge:".length)
            : "";
          const knowledge = knowledgeId
            ? knowledgeIndexById.get(knowledgeId)
            : null;

          return (
            <li
              key={cell.requirementId}
              className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${CELL_TONE[cell.status]}`}
                >
                  {CELL_LABEL[cell.status]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-body text-[13px] leading-relaxed text-text">
                    {req?.text ?? `(unknown requirement: ${cell.requirementId})`}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 font-mono text-[10px] uppercase tracking-widest text-subtle">
                    {req?.sectionRef ? <span>{req.sectionRef}</span> : null}
                    {req?.capabilityArea ? (
                      <span className="text-cobalt">
                        {req.capabilityArea}
                      </span>
                    ) : null}
                  </div>
                  {cell.narrative ? (
                    <p className="mt-1.5 font-body text-[12px] leading-relaxed text-muted">
                      {cell.narrative}
                    </p>
                  ) : null}
                  {knowledge ? (
                    <div className="mt-1 rounded border border-cobalt-400/30 bg-cobalt-400/5 px-2 py-1 font-mono text-[10px]">
                      <span className="text-cobalt">supporting:</span>{" "}
                      <Link
                        href={`/knowledge-base/${knowledge.id}`}
                        className="text-text underline decoration-dotted underline-offset-2 hover:text-cobalt"
                      >
                        {knowledge.title}
                      </Link>
                      {cell.citation ? (
                        <span className="ml-2 text-muted">
                          &mdash; "{cell.citation}"
                        </span>
                      ) : null}
                    </div>
                  ) : cell.citation ? (
                    <p className="mt-1 font-mono text-[10px] text-muted">
                      cited: "{cell.citation}"
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function QuestionList({ questions }: { questions: SolicitationQuestion[] }) {
  // Group by category for readability.
  const byCategory = useMemo(() => {
    const groups = new Map<string, SolicitationQuestion[]>();
    for (const q of questions) {
      const list = groups.get(q.category) ?? [];
      list.push(q);
      groups.set(q.category, list);
    }
    return groups;
  }, [questions]);

  function copyAll() {
    const text = questions
      .map(
        (q) =>
          `[${CATEGORY_LABEL[q.category]}] ${q.sectionRef ? `(${q.sectionRef}) ` : ""}${q.text}`,
      )
      .join("\n\n");
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={copyAll}
          className="aur-btn aur-btn-ghost text-[11px]"
        >
          Copy all
        </button>
      </div>

      {Array.from(byCategory.entries()).map(([category, list]) => (
        <div key={category}>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-cobalt">
            {CATEGORY_LABEL[category as SolicitationQuestion["category"]] ??
              category}{" "}
            · {list.length}
          </div>
          <ul className="flex flex-col gap-1">
            {list.map((q) => (
              <li
                key={q.id}
                className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
              >
                <div className="font-body text-[13px] leading-relaxed text-text">
                  {q.text}
                </div>
                {q.rationale ? (
                  <div className="mt-1 font-body text-[12px] leading-relaxed text-muted">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-subtle">
                      Why:
                    </span>{" "}
                    {q.rationale}
                  </div>
                ) : null}
                {q.sectionRef ? (
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-subtle">
                    Source: {q.sectionRef}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0 text-muted">{label}:</span>
      <span className="min-w-0 flex-1 truncate text-text">{value || "—"}</span>
    </div>
  );
}
