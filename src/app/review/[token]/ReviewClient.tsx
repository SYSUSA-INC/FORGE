"use client";

import { useState, useTransition } from "react";
import {
  submitOpportunityReviewAction,
  type ReviewByTokenResult,
} from "@/app/(app)/opportunities/[id]/review/actions";

type OkState = Extract<ReviewByTokenResult, { ok: true }>;

export function ReviewClient({
  token,
  state,
}: {
  token: string;
  state: OkState;
}) {
  const [recommendation, setRecommendation] = useState<
    "bid" | "no_bid" | "more_info" | null
  >(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(state.completedAt !== null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!recommendation) {
      setError("Pick a recommendation first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await submitOpportunityReviewAction({
        token,
        recommendation,
        comment: comment.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSubmitted(true);
    });
  }

  if (state.expired && !submitted) {
    return (
      <div className="mt-8 rounded-xl border border-amber-500/30 bg-amber-500/5 p-6">
        <div className="font-display text-xl font-semibold text-amber-200">
          Link expired
        </div>
        <p className="mt-2 font-mono text-[12px] text-muted">
          This review link is older than 14 days. Ask the sender to resend.
        </p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="mt-8 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6">
        <div className="font-display text-xl font-semibold text-emerald-300">
          Thanks — recommendation submitted.
        </div>
        <p className="mt-2 font-mono text-[12px] text-muted">
          {state.sender.name} has been notified. You can close this tab.
        </p>
        {state.recommendation !== "pending" ? (
          <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
              Your recommendation
            </div>
            <div className="mt-1 font-display text-lg font-semibold text-text">
              {labelFor(state.recommendation)}
            </div>
            {state.comment ? (
              <div className="mt-2 font-mono text-[12px] text-muted">
                &ldquo;{state.comment}&rdquo;
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const due = state.opportunity.dueDate
    ? new Date(state.opportunity.dueDate).toLocaleDateString()
    : "—";
  const valueRange =
    state.opportunity.valueLow || state.opportunity.valueHigh
      ? `${state.opportunity.valueLow || "—"} – ${state.opportunity.valueHigh || "—"}`
      : "—";

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          Review requested by {state.sender.name}
          {state.sender.email ? ` · ${state.sender.email}` : ""} —{" "}
          {state.organizationName}
        </div>
        <div className="mt-2 font-display text-2xl font-semibold text-text">
          {state.opportunity.title}
        </div>
        <div className="mt-1 font-mono text-[11px] text-muted">
          {[
            state.opportunity.agency,
            state.opportunity.office,
            state.opportunity.solicitationNumber,
          ]
            .filter(Boolean)
            .join(" · ") || "—"}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="NAICS" value={state.opportunity.naicsCode || "—"} />
          <Stat
            label="Set-aside"
            value={state.opportunity.setAside || "—"}
          />
          <Stat label="Due" value={due} />
          <Stat label="Value" value={valueRange} />
        </dl>

        {state.opportunity.description ? (
          <div className="mt-4 max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.015] p-3 font-body text-[13px] leading-relaxed text-muted">
            {state.opportunity.description}
          </div>
        ) : null}

        {state.note ? (
          <div className="mt-4 rounded-lg border-l-2 border-teal-400 bg-teal-400/5 p-3">
            <div className="font-mono text-[10px] uppercase tracking-widest text-teal">
              Note from {state.sender.name}
            </div>
            <div className="mt-1 font-body text-[13px] text-text">
              {state.note}
            </div>
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <div className="font-display text-base font-semibold text-text">
          Your recommendation
        </div>
        <p className="mt-1 font-mono text-[11px] text-muted">
          Picking <strong className="text-emerald-300">Bid</strong> moves this
          opportunity from Identified to Qualification automatically.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-3">
          <RecButton
            label="Recommend Bid"
            tone="emerald"
            active={recommendation === "bid"}
            onClick={() => setRecommendation("bid")}
          />
          <RecButton
            label="Recommend No-bid"
            tone="rose"
            active={recommendation === "no_bid"}
            onClick={() => setRecommendation("no_bid")}
          />
          <RecButton
            label="Need more info"
            tone="amber"
            active={recommendation === "more_info"}
            onClick={() => setRecommendation("more_info")}
          />
        </div>

        <div className="mt-4">
          <label className="aur-label">Comment (optional)</label>
          <textarea
            className="aur-input min-h-[100px]"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Why? Any concerns? What would change your call?"
          />
        </div>

        {error ? (
          <div className="mt-3 rounded border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-end">
          <button
            type="button"
            onClick={submit}
            disabled={pending || !recommendation}
            className="aur-btn aur-btn-primary text-[12px] disabled:opacity-60"
          >
            {pending ? "Submitting…" : "Submit recommendation"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[12px] text-text">{value}</div>
    </div>
  );
}

function RecButton({
  label,
  tone,
  active,
  onClick,
}: {
  label: string;
  tone: "emerald" | "rose" | "amber";
  active: boolean;
  onClick: () => void;
}) {
  const colors =
    tone === "emerald"
      ? active
        ? "border-emerald-400 bg-emerald-400/15 text-emerald-300"
        : "border-emerald-400/30 bg-emerald-400/5 text-emerald-300/70 hover:bg-emerald-400/10"
      : tone === "rose"
        ? active
          ? "border-rose-400 bg-rose-400/15 text-rose-300"
          : "border-rose-400/30 bg-rose-400/5 text-rose-300/70 hover:bg-rose-400/10"
        : active
          ? "border-amber-400 bg-amber-400/15 text-amber-200"
          : "border-amber-400/30 bg-amber-400/5 text-amber-200/70 hover:bg-amber-400/10";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-4 py-3 font-display text-[13px] font-semibold transition-colors ${colors}`}
    >
      {label}
    </button>
  );
}

function labelFor(rec: "pending" | "bid" | "no_bid" | "more_info"): string {
  if (rec === "bid") return "Recommended Bid";
  if (rec === "no_bid") return "Recommended No-bid";
  if (rec === "more_info") return "Asked for more info";
  return "Pending";
}
