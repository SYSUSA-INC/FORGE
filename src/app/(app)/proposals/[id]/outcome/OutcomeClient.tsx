"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import type {
  ProposalDebriefFormat,
  ProposalDebriefStatus,
  ProposalOutcomeReason,
  ProposalOutcomeType,
  ProposalStage,
} from "@/db/schema";
import {
  DEBRIEF_FORMAT_LABELS,
  DEBRIEF_STATUS_LABELS,
  OUTCOME_REASONS,
  OUTCOME_REASON_LABELS,
  OUTCOME_TYPE_COLORS,
  OUTCOME_TYPE_LABELS,
} from "@/lib/proposal-outcome-types";
import { saveDebriefAction, saveOutcomeAction } from "./actions";

type OutcomeForm = {
  outcomeType: ProposalOutcomeType;
  awardValue: string;
  decisionDate: string;
  reasons: ProposalOutcomeReason[];
  summary: string;
  lessonsLearned: string;
  followUpActions: string;
  awardedToCompetitor: string;
  authorLabel: string | null;
  updatedAt: string;
};

type DebriefForm = {
  status: ProposalDebriefStatus;
  format: ProposalDebriefFormat;
  requestedAt: string;
  scheduledFor: string;
  heldOn: string;
  governmentAttendees: string;
  ourAttendees: string;
  strengths: string;
  weaknesses: string;
  improvements: string;
  pastPerformanceCitation: string;
  notes: string;
  authorLabel: string | null;
  updatedAt: string;
};

const OUTCOME_TYPES: ProposalOutcomeType[] = [
  "won",
  "lost",
  "no_bid",
  "withdrawn",
];
const DEBRIEF_STATUSES: ProposalDebriefStatus[] = [
  "not_requested",
  "requested",
  "scheduled",
  "held",
  "declined_by_govt",
  "not_offered",
  "waived",
];
const DEBRIEF_FORMATS: ProposalDebriefFormat[] = [
  "written",
  "oral",
  "both",
  "unknown",
];

function defaultOutcomeFromStage(stage: ProposalStage): ProposalOutcomeType {
  if (stage === "awarded") return "won";
  if (stage === "lost") return "lost";
  if (stage === "no_bid") return "no_bid";
  return "won";
}

export function OutcomeClient({
  proposalId,
  currentStage,
  submittedAt,
  outcome,
  debrief,
}: {
  proposalId: string;
  currentStage: ProposalStage;
  submittedAt: string | null;
  outcome: OutcomeForm | null;
  debrief: DebriefForm | null;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-4">
        <OutcomePanel
          proposalId={proposalId}
          currentStage={currentStage}
          outcome={outcome}
        />
        <DebriefPanel
          proposalId={proposalId}
          hasOutcome={Boolean(outcome)}
          debrief={debrief}
        />
      </div>
      <SidebarPanel
        currentStage={currentStage}
        submittedAt={submittedAt}
        outcome={outcome}
        debrief={debrief}
      />
    </div>
  );
}

function OutcomePanel({
  proposalId,
  currentStage,
  outcome,
}: {
  proposalId: string;
  currentStage: ProposalStage;
  outcome: OutcomeForm | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const initialType =
    outcome?.outcomeType ?? defaultOutcomeFromStage(currentStage);

  const [outcomeType, setOutcomeType] = useState<ProposalOutcomeType>(initialType);
  const [awardValue, setAwardValue] = useState(outcome?.awardValue ?? "");
  const [decisionDate, setDecisionDate] = useState(outcome?.decisionDate ?? "");
  const [reasons, setReasons] = useState<ProposalOutcomeReason[]>(
    outcome?.reasons ?? [],
  );
  const [summary, setSummary] = useState(outcome?.summary ?? "");
  const [lessons, setLessons] = useState(outcome?.lessonsLearned ?? "");
  const [followUps, setFollowUps] = useState(outcome?.followUpActions ?? "");
  const [awardedToCompetitor, setAwardedToCompetitor] = useState(
    outcome?.awardedToCompetitor ?? "",
  );

  function toggleReason(r: ProposalOutcomeReason) {
    setReasons((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
    );
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const fd = new FormData(e.currentTarget);
    fd.delete("reasons");
    for (const r of reasons) fd.append("reasons", r);
    startTransition(async () => {
      const res = await saveOutcomeAction(proposalId, fd);
      if (!res.ok) return setError(res.error);
      setSuccess(true);
      router.refresh();
    });
  }

  return (
    <Panel
      title="Outcome"
      eyebrow={
        outcome ? "Recorded — edit below" : "Capture the win/loss/no-bid record"
      }
      actions={
        <span
          className="rounded-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest"
          style={{
            color: OUTCOME_TYPE_COLORS[outcomeType],
            backgroundColor: `${OUTCOME_TYPE_COLORS[outcomeType]}1A`,
            border: `1px solid ${OUTCOME_TYPE_COLORS[outcomeType]}60`,
          }}
        >
          {OUTCOME_TYPE_LABELS[outcomeType]}
        </span>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <div>
          <div className="aur-label">Outcome type</div>
          <div className="flex flex-wrap gap-2">
            {OUTCOME_TYPES.map((t) => {
              const selected = t === outcomeType;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setOutcomeType(t)}
                  className="rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest transition-colors"
                  style={{
                    color: selected
                      ? OUTCOME_TYPE_COLORS[t]
                      : "rgba(155, 201, 217, 0.8)",
                    backgroundColor: selected
                      ? `${OUTCOME_TYPE_COLORS[t]}1A`
                      : "rgba(255, 255, 255, 0.04)",
                    border: selected
                      ? `1px solid ${OUTCOME_TYPE_COLORS[t]}80`
                      : "1px solid rgba(255, 255, 255, 0.10)",
                  }}
                >
                  {OUTCOME_TYPE_LABELS[t]}
                </button>
              );
            })}
          </div>
          <input type="hidden" name="outcomeType" value={outcomeType} />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="aur-label" htmlFor="decisionDate">
              Decision date
            </label>
            <input
              id="decisionDate"
              name="decisionDate"
              type="date"
              className="aur-input"
              value={decisionDate}
              onChange={(e) => setDecisionDate(e.target.value)}
            />
          </div>
          <div>
            <label className="aur-label" htmlFor="awardValue">
              {outcomeType === "won" ? "Award value (USD)" : "Estimated value"}
            </label>
            <input
              id="awardValue"
              name="awardValue"
              type="text"
              placeholder="$0"
              className="aur-input"
              value={awardValue}
              onChange={(e) => setAwardValue(e.target.value)}
            />
          </div>
        </div>

        {outcomeType !== "won" ? (
          <div>
            <label className="aur-label" htmlFor="awardedToCompetitor">
              Awarded to (if known)
            </label>
            <input
              id="awardedToCompetitor"
              name="awardedToCompetitor"
              type="text"
              placeholder="Incumbent, named competitor, or unknown"
              className="aur-input"
              value={awardedToCompetitor}
              onChange={(e) => setAwardedToCompetitor(e.target.value)}
            />
          </div>
        ) : (
          <input
            type="hidden"
            name="awardedToCompetitor"
            value={awardedToCompetitor}
          />
        )}

        <div>
          <div className="aur-label">
            Driving reasons{" "}
            <span className="text-subtle">
              (pick all that apply — drives win/loss analytics)
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {OUTCOME_REASONS.map((r) => {
              const selected = reasons.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => toggleReason(r)}
                  className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                    selected
                      ? "border-teal/60 bg-teal/10 text-teal"
                      : "border-white/10 bg-white/[0.03] text-muted hover:border-white/30 hover:text-text"
                  }`}
                >
                  {OUTCOME_REASON_LABELS[r]}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="aur-label" htmlFor="summary">
            Summary{" "}
            <span className="text-subtle">
              ({outcomeType === "won" ? "why we won" : "why this outcome"})
            </span>
          </label>
          <textarea
            id="summary"
            name="summary"
            rows={3}
            className="aur-input min-h-[80px] resize-y"
            placeholder={
              outcomeType === "won"
                ? "What clinched it? Themes, differentiators, customer feedback."
                : "What does the team know about why this went the way it did?"
            }
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </div>

        <div>
          <label className="aur-label" htmlFor="lessonsLearned">
            Lessons learned{" "}
            <span className="text-subtle">(retrospective for next pursuit)</span>
          </label>
          <textarea
            id="lessonsLearned"
            name="lessonsLearned"
            rows={4}
            className="aur-input min-h-[100px] resize-y"
            placeholder="Things to repeat. Things to stop doing. Process gaps. Tooling gaps."
            value={lessons}
            onChange={(e) => setLessons(e.target.value)}
          />
        </div>

        <div>
          <label className="aur-label" htmlFor="followUpActions">
            Follow-up actions
          </label>
          <textarea
            id="followUpActions"
            name="followUpActions"
            rows={2}
            className="aur-input min-h-[60px] resize-y"
            placeholder="Owner — Action — Due date. One per line."
            value={followUps}
            onChange={(e) => setFollowUps(e.target.value)}
          />
        </div>

        {error ? (
          <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">
            Saved.
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          {outcome ? (
            <div className="font-mono text-[11px] text-subtle">
              Last updated{" "}
              {new Date(outcome.updatedAt).toISOString().slice(0, 10)}
              {outcome.authorLabel ? ` by ${outcome.authorLabel}` : ""}
            </div>
          ) : (
            <span />
          )}
          <button
            type="submit"
            className="aur-btn aur-btn-primary"
            disabled={pending}
          >
            {pending ? "Saving…" : outcome ? "Update outcome" : "Record outcome"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function DebriefPanel({
  proposalId,
  hasOutcome,
  debrief,
}: {
  proposalId: string;
  hasOutcome: boolean;
  debrief: DebriefForm | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [status, setStatus] = useState<ProposalDebriefStatus>(
    debrief?.status ?? "not_requested",
  );
  const [format, setFormat] = useState<ProposalDebriefFormat>(
    debrief?.format ?? "unknown",
  );
  const [requestedAt, setRequestedAt] = useState(debrief?.requestedAt ?? "");
  const [scheduledFor, setScheduledFor] = useState(debrief?.scheduledFor ?? "");
  const [heldOn, setHeldOn] = useState(debrief?.heldOn ?? "");
  const [govt, setGovt] = useState(debrief?.governmentAttendees ?? "");
  const [ours, setOurs] = useState(debrief?.ourAttendees ?? "");
  const [strengths, setStrengths] = useState(debrief?.strengths ?? "");
  const [weaknesses, setWeaknesses] = useState(debrief?.weaknesses ?? "");
  const [improvements, setImprovements] = useState(debrief?.improvements ?? "");
  const [ppCite, setPpCite] = useState(debrief?.pastPerformanceCitation ?? "");
  const [notes, setNotes] = useState(debrief?.notes ?? "");

  const showFullForm = status === "scheduled" || status === "held";

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveDebriefAction(proposalId, fd);
      if (!res.ok) return setError(res.error);
      setSuccess(true);
      router.refresh();
    });
  }

  return (
    <Panel
      title="Debrief"
      eyebrow={
        hasOutcome
          ? "Capture government feedback if a debrief is requested or held"
          : "Record the outcome first; debrief sits next to it"
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="aur-label" htmlFor="status">
              Status
            </label>
            <select
              id="status"
              name="status"
              className="aur-input"
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as ProposalDebriefStatus)
              }
            >
              {DEBRIEF_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {DEBRIEF_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="aur-label" htmlFor="format">
              Format
            </label>
            <select
              id="format"
              name="format"
              className="aur-input"
              value={format}
              onChange={(e) =>
                setFormat(e.target.value as ProposalDebriefFormat)
              }
            >
              {DEBRIEF_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {DEBRIEF_FORMAT_LABELS[f]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="aur-label" htmlFor="requestedAt">
              Requested
            </label>
            <input
              id="requestedAt"
              name="requestedAt"
              type="date"
              className="aur-input"
              value={requestedAt}
              onChange={(e) => setRequestedAt(e.target.value)}
            />
          </div>
          <div>
            <label className="aur-label" htmlFor="scheduledFor">
              Scheduled for
            </label>
            <input
              id="scheduledFor"
              name="scheduledFor"
              type="date"
              className="aur-input"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
            />
          </div>
          <div>
            <label className="aur-label" htmlFor="heldOn">
              Held on
            </label>
            <input
              id="heldOn"
              name="heldOn"
              type="date"
              className="aur-input"
              value={heldOn}
              onChange={(e) => setHeldOn(e.target.value)}
            />
          </div>
        </div>

        {showFullForm ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="aur-label" htmlFor="governmentAttendees">
                  Government attendees
                </label>
                <textarea
                  id="governmentAttendees"
                  name="governmentAttendees"
                  rows={2}
                  className="aur-input min-h-[60px] resize-y"
                  value={govt}
                  onChange={(e) => setGovt(e.target.value)}
                />
              </div>
              <div>
                <label className="aur-label" htmlFor="ourAttendees">
                  Our attendees
                </label>
                <textarea
                  id="ourAttendees"
                  name="ourAttendees"
                  rows={2}
                  className="aur-input min-h-[60px] resize-y"
                  value={ours}
                  onChange={(e) => setOurs(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="aur-label" htmlFor="strengths">
                Strengths cited
              </label>
              <textarea
                id="strengths"
                name="strengths"
                rows={3}
                className="aur-input min-h-[80px] resize-y"
                placeholder="Customer-cited strengths in our proposal"
                value={strengths}
                onChange={(e) => setStrengths(e.target.value)}
              />
            </div>
            <div>
              <label className="aur-label" htmlFor="weaknesses">
                Weaknesses cited
              </label>
              <textarea
                id="weaknesses"
                name="weaknesses"
                rows={3}
                className="aur-input min-h-[80px] resize-y"
                placeholder="Customer-cited weaknesses or deficiencies"
                value={weaknesses}
                onChange={(e) => setWeaknesses(e.target.value)}
              />
            </div>
            <div>
              <label className="aur-label" htmlFor="improvements">
                Areas for improvement
              </label>
              <textarea
                id="improvements"
                name="improvements"
                rows={3}
                className="aur-input min-h-[80px] resize-y"
                value={improvements}
                onChange={(e) => setImprovements(e.target.value)}
              />
            </div>
            <div>
              <label className="aur-label" htmlFor="pastPerformanceCitation">
                Past performance citation
              </label>
              <textarea
                id="pastPerformanceCitation"
                name="pastPerformanceCitation"
                rows={2}
                className="aur-input min-h-[60px] resize-y"
                placeholder="Will this proposal be referenceable as past performance?"
                value={ppCite}
                onChange={(e) => setPpCite(e.target.value)}
              />
            </div>
          </>
        ) : null}

        <div>
          <label className="aur-label" htmlFor="notes">
            Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            className="aur-input min-h-[80px] resize-y"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {error ? (
          <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">
            Saved.
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          {debrief ? (
            <div className="font-mono text-[11px] text-subtle">
              Last updated{" "}
              {new Date(debrief.updatedAt).toISOString().slice(0, 10)}
              {debrief.authorLabel ? ` by ${debrief.authorLabel}` : ""}
            </div>
          ) : (
            <span />
          )}
          <button
            type="submit"
            className="aur-btn aur-btn-primary"
            disabled={pending}
          >
            {pending ? "Saving…" : debrief ? "Update debrief" : "Save debrief"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function SidebarPanel({
  currentStage,
  submittedAt,
  outcome,
  debrief,
}: {
  currentStage: ProposalStage;
  submittedAt: string | null;
  outcome: OutcomeForm | null;
  debrief: DebriefForm | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Snapshot" eyebrow="What's recorded so far">
        <div className="flex flex-col gap-2 font-mono text-[11px]">
          <Row label="Stage" value={currentStage} />
          <Row
            label="Submitted"
            value={
              submittedAt ? new Date(submittedAt).toISOString().slice(0, 10) : "—"
            }
          />
          <Row
            label="Outcome"
            value={
              outcome
                ? `${OUTCOME_TYPE_LABELS[outcome.outcomeType]}${
                    outcome.decisionDate ? ` · ${outcome.decisionDate}` : ""
                  }`
                : "Not yet recorded"
            }
          />
          <Row
            label="Reasons"
            value={
              outcome?.reasons.length
                ? outcome.reasons
                    .map((r) => OUTCOME_REASON_LABELS[r])
                    .join(", ")
                : "—"
            }
          />
          <Row
            label="Debrief"
            value={
              debrief ? DEBRIEF_STATUS_LABELS[debrief.status] : "Not recorded"
            }
          />
        </div>
      </Panel>
      <Panel title="Why this exists" eyebrow="FORGE process note">
        <p className="font-body text-[12px] leading-relaxed text-muted">
          The Outcome tab is the closing record on a proposal. The outcome
          summary, lessons learned, and follow-up actions become part of the
          permanent audit trail next to the rest of the proposal — owners,
          reviewers, sections, compliance items. Capture it while the team's
          memory is fresh; revisit it during the next pursuit's pink team.
        </p>
      </Panel>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 pb-1.5 last:border-b-0">
      <span className="text-[10px] uppercase tracking-[0.22em] text-subtle">
        {label}
      </span>
      <span className="text-right text-text">{value}</span>
    </div>
  );
}
