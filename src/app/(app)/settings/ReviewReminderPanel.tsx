"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { REMINDER_CADENCE_LIMITS, type ReminderCadence } from "@/lib/review-workflow-logic";
import { setReviewReminderCadenceAction } from "./actions";

/**
 * BL-FB-X-COLOR-TEAM Slice 3 — how the team wants colour-team reviewers
 * nudged: first N days before a round's due date, then every M days
 * while it is overdue. Org admins edit; everyone can read.
 */
export function ReviewReminderPanel({ initial, canEdit, className }: { initial: ReminderCadence; canEdit: boolean; className?: string }) {
  const [daysBefore, setDaysBefore] = useState(initial.daysBefore);
  const [repeatDays, setRepeatDays] = useState(initial.repeatDays);
  const [saved, setSaved] = useState(initial);
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "ok" } | { kind: "err"; message: string }>({ kind: "idle" });
  const [pending, startTransition] = useTransition();
  const dirty = daysBefore !== saved.daysBefore || repeatDays !== saved.repeatDays;

  function save() {
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const res = await setReviewReminderCadenceAction({ daysBefore, repeatDays });
      if (!res.ok) return setStatus({ kind: "err", message: res.error });
      setSaved({ daysBefore, repeatDays });
      setStatus({ kind: "ok" });
    });
  }

  const number = (value: number, set: (n: number) => void, lim: { min: number; max: number }) => (
    <input
      className="aur-input"
      type="number"
      min={lim.min}
      max={lim.max}
      step={1}
      inputMode="numeric"
      value={value}
      onChange={(e) => {
        const n = Number(e.target.value);
        set(Number.isFinite(n) ? Math.round(n) : value);
      }}
      disabled={!canEdit || pending}
    />
  );

  return (
    <Panel title="Review reminders" eyebrow="Colour-team rounds" className={className}>
      <p className="font-body text-[12px] leading-relaxed text-muted">
        Reviewers who have not submitted a verdict are reminded before a round&apos;s due date, and can be reminded again while it is overdue. The reminder goes through the &quot;Color-team review due soon&quot; rule under notification rules, which decides the channels.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="aur-label">Days before the due date</label>
          {number(daysBefore, setDaysBefore, REMINDER_CADENCE_LIMITS.daysBefore)}
          <div className="mt-1 font-mono text-[10px] text-muted">0 = on the day · {REMINDER_CADENCE_LIMITS.daysBefore.max} at most</div>
        </div>
        <div>
          <label className="aur-label">Repeat while overdue, every</label>
          {number(repeatDays, setRepeatDays, REMINDER_CADENCE_LIMITS.repeatDays)}
          <div className="mt-1 font-mono text-[10px] text-muted">days · 0 = remind once only</div>
        </div>
        {canEdit ? (
          <div className="flex items-end">
            <button type="button" onClick={save} disabled={pending || !dirty} className="aur-btn aur-btn-primary">
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        ) : null}
      </div>
      {status.kind === "ok" ? <div className="mt-2 font-mono text-[11px] text-emerald">Saved. The daily 08:00 UTC tick follows the new cadence.</div> : null}
      {status.kind === "err" ? <div className="mt-2 font-mono text-[11px] text-rose">{status.message}</div> : null}
      {!canEdit ? <div className="mt-2 font-mono text-[11px] text-muted">Only org admins can change the cadence.</div> : null}
    </Panel>
  );
}
