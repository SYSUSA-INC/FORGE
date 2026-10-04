"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import {
  REMINDER_CADENCE_LIMITS,
  describeCadence,
  dueReminderSubject,
  nextReminderAt,
  roundCadence,
  type ReminderCadence,
} from "@/lib/review-workflow-logic";
import { setRoundReminderCadenceAction } from "../actions";

/**
 * BL-FB-X-COLOR-TEAM Slice 4 — when this round's reviewers will be
 * reminded, who gets it and what it says, with the round's own cadence
 * when the team default doesn't suit it. The preview recomputes as the
 * numbers change, before anything is saved.
 */
export function ReminderPanel({
  reviewId,
  dueDate,
  sentAt,
  team,
  round,
  pendingNames,
  colorLabel,
  proposalTitle,
  canEdit,
}: {
  reviewId: string;
  dueDate: string | null;
  sentAt: string | null;
  team: ReminderCadence;
  round: { daysBefore: number | null; repeatDays: number | null };
  pendingNames: string[];
  colorLabel: string;
  proposalTitle: string;
  canEdit: boolean;
}) {
  const initial = roundCadence(round, team);
  const [own, setOwn] = useState(initial.own);
  const [daysBefore, setDaysBefore] = useState(initial.cadence.daysBefore);
  const [repeatDays, setRepeatDays] = useState(initial.cadence.repeatDays);
  const [status, setStatus] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const cadence: ReminderCadence = own ? { daysBefore, repeatDays } : team;
  const now = new Date();
  const due = dueDate ? new Date(dueDate) : null;
  const next = nextReminderAt(now, due, sentAt ? new Date(sentAt) : null, cadence);
  const dirty = own !== initial.own || (own && (daysBefore !== initial.cadence.daysBefore || repeatDays !== initial.cadence.repeatDays));

  function save() {
    setStatus(null);
    startTransition(async () => {
      const res = await setRoundReminderCadenceAction({ reviewId, cadence: own ? { daysBefore, repeatDays } : null });
      setStatus(res.ok ? { tone: "ok", text: own ? "This round now has its own reminders." : "This round follows the team's reminders again." } : { tone: "err", text: res.error });
    });
  }

  const number = (value: number, set: (n: number) => void, lim: { min: number; max: number }, label: string) => (
    <input
      className="aur-input w-20"
      type="number"
      min={lim.min}
      max={lim.max}
      step={1}
      value={value}
      aria-label={label}
      onChange={(e) => {
        const n = Math.round(Number(e.target.value));
        set(Number.isFinite(n) ? Math.min(lim.max, Math.max(lim.min, n)) : value);
      }}
      disabled={!canEdit || !own || pending}
    />
  );

  return (
    <Panel title="Reminders" eyebrow={own ? "This round's own cadence" : "Team default"}>
      {!due ? (
        <p className="font-body text-[12px] text-muted">This round has no due date, so no reminders go out.</p>
      ) : (
        <>
          <p className="font-body text-[12px] leading-relaxed text-muted">Reviewers who haven&apos;t submitted are reminded {describeCadence(cadence)}.</p>
          {canEdit ? (
            <div className="mt-3 flex flex-col gap-2">
              <label className="flex items-center gap-2 font-mono text-[11px] text-text">
                <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} disabled={pending} />
                Give this round its own cadence (team default: {describeCadence(team)})
              </label>
              {own ? (
                <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted">
                  First {number(daysBefore, setDaysBefore, REMINDER_CADENCE_LIMITS.daysBefore, "Days before the due date")} days before · then every{" "}
                  {number(repeatDays, setRepeatDays, REMINDER_CADENCE_LIMITS.repeatDays, "Repeat every days")} days while overdue (0 = once)
                </div>
              ) : null}
              <div>
                <button type="button" onClick={save} disabled={pending || !dirty} className="aur-btn aur-btn-primary text-[11px] disabled:opacity-50">
                  {pending ? "Saving…" : "Save reminders"}
                </button>
              </div>
            </div>
          ) : null}
          <div className="mt-3 rounded-md border border-layer/10 bg-layer/[0.02] p-3">
            <div className="font-mono text-[9px] uppercase tracking-widest text-subtle">Next reminder</div>
            {next ? (
              <>
                <div className="mt-1 font-mono text-[12px] text-text">{next.toISOString().slice(0, 10)} · 08:00 UTC</div>
                <div className="mt-1 font-body text-[12px] text-muted">
                  To: {pendingNames.length > 0 ? pendingNames.join(", ") : "nobody yet — everyone assigned has submitted"}
                </div>
                <div className="mt-1 font-body text-[12px] text-text">&ldquo;{dueReminderSubject(colorLabel, proposalTitle, due, next)}&rdquo;</div>
              </>
            ) : (
              <div className="mt-1 font-body text-[12px] text-muted">None scheduled — the reminder has gone and this cadence doesn&apos;t repeat.</div>
            )}
          </div>
        </>
      )}
      {status ? <div className={`mt-2 font-mono text-[11px] ${status.tone === "ok" ? "text-emerald" : "text-rose"}`}>{status.text}</div> : null}
    </Panel>
  );
}
