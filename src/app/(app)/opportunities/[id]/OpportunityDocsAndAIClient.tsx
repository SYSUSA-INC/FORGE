"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  runCapabilityMatrixAction,
  runQuestionGeneratorAction,
  runSolicitationReviewAction,
} from "../../solicitations/[id]/review-actions";

type ReviewStatus = "none" | "pending" | "running" | "complete" | "failed";

type SolicitationRow = {
  id: string;
  title: string;
  solicitationNumber: string;
  hasRawText: boolean;
  parseStatus: string;
  reviewStatus: ReviewStatus;
  reviewComplete: boolean;
  reviewStubbed: boolean;
  matrixCount: number;
  matrixStubbed: boolean;
  questionCount: number;
  questionStubbed: boolean;
};

const STATUS_TONE: Record<ReviewStatus, string> = {
  none: "border-white/15 bg-white/5 text-muted",
  pending: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  running: "border-cobalt-400/40 bg-cobalt-400/10 text-cobalt",
  complete: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  failed: "border-rose/40 bg-rose/10 text-rose",
};

const STATUS_LABEL: Record<ReviewStatus, string> = {
  none: "Not started",
  pending: "Pending",
  running: "Running",
  complete: "Reviewed",
  failed: "Failed",
};

/**
 * BL-23b — opportunity-mirror client surface. Renders each linked
 * solicitation as a row with status pills + compact action buttons.
 * Calls the same review-actions used by the primary solicitation
 * surface — single source of truth, no duplicated business logic.
 */
export function OpportunityDocsAndAIClient({
  solicitations,
}: {
  solicitations: SolicitationRow[];
}) {
  const router = useRouter();
  const [pendingById, setPendingById] = useState<Record<string, string | null>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function markPending(id: string, action: string | null) {
    setPendingById((prev) => ({ ...prev, [id]: action }));
  }

  function run(
    solicitationId: string,
    actionName: "review" | "matrix" | "questions",
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>,
  ) {
    setError(null);
    markPending(solicitationId, actionName);
    startTransition(async () => {
      try {
        const res = await fn();
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.refresh();
      } finally {
        markPending(solicitationId, null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}

      <ul className="flex flex-col gap-2">
        {solicitations.map((s) => {
          const pendingAction = pendingById[s.id] ?? null;
          const reviewing = pendingAction === "review";
          const matrixing = pendingAction === "matrix";
          const questioning = pendingAction === "questions";
          const anyPending = pendingAction !== null;
          const downstreamDisabled = !s.reviewComplete || anyPending;

          return (
            <li
              key={s.id}
              className="rounded-lg border border-white/10 bg-white/[0.02] p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/solicitations/${s.id}`}
                    className="font-display text-[13px] font-semibold text-text hover:underline"
                  >
                    {s.title}
                  </Link>
                  <div className="font-mono text-[10px] text-muted">
                    {s.solicitationNumber || "(no solicitation number)"}
                    {s.reviewStubbed || s.matrixStubbed || s.questionStubbed ? (
                      <span className="ml-2 text-amber-300">stub mode</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest ${STATUS_TONE[s.reviewStatus]}`}
                  >
                    {STATUS_LABEL[s.reviewStatus]}
                  </span>
                  {s.matrixCount > 0 ? (
                    <span className="rounded border border-cobalt-400/40 bg-cobalt-400/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-cobalt">
                      {s.matrixCount} matrix cell
                      {s.matrixCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  {s.questionCount > 0 ? (
                    <span className="rounded border border-violet/40 bg-violet/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-violet">
                      {s.questionCount} question
                      {s.questionCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    run(s.id, "review", () =>
                      runSolicitationReviewAction(s.id),
                    )
                  }
                  disabled={!s.hasRawText || anyPending}
                  className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-50"
                  title={
                    !s.hasRawText
                      ? "Solicitation hasn't been parsed yet"
                      : s.reviewComplete
                        ? "Re-run the review with the latest doc text"
                        : "Run the document review"
                  }
                >
                  {reviewing
                    ? "Reviewing…"
                    : s.reviewComplete
                      ? "Re-review"
                      : "Initiate review"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    run(s.id, "matrix", () =>
                      runCapabilityMatrixAction(s.id),
                    )
                  }
                  disabled={downstreamDisabled}
                  className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-50"
                  title={
                    !s.reviewComplete
                      ? "Run the document review first"
                      : s.matrixCount > 0
                        ? "Re-build the capability matrix"
                        : "Score the company against each requirement"
                  }
                >
                  {matrixing
                    ? "Building…"
                    : s.matrixCount > 0
                      ? "Re-build matrix"
                      : "Build matrix"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    run(s.id, "questions", () =>
                      runQuestionGeneratorAction(s.id),
                    )
                  }
                  disabled={downstreamDisabled}
                  className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-50"
                  title={
                    !s.reviewComplete
                      ? "Run the document review first"
                      : s.questionCount > 0
                        ? "Re-generate clarification questions"
                        : "Generate clarification questions for the CO"
                  }
                >
                  {questioning
                    ? "Generating…"
                    : s.questionCount > 0
                      ? "Re-generate questions"
                      : "Generate questions"}
                </button>
                <Link
                  href={`/solicitations/${s.id}`}
                  className="ml-auto font-mono text-[11px] text-cobalt underline-offset-2 hover:underline"
                >
                  Full results →
                </Link>
              </div>

              {!s.hasRawText ? (
                <div className="mt-2 rounded-md border border-amber-400/40 bg-amber-400/[0.06] px-3 py-1.5 font-mono text-[11px] text-amber-200">
                  Waiting on parse pipeline ({s.parseStatus}) — buttons
                  enable once doc text is extracted.
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
