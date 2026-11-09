"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import {
  COUNT_BACK_DAYS,
  daysBetween,
  MILESTONE_KIND_LABELS,
  MILESTONE_KINDS,
  MILESTONE_STATUS_LABELS,
  MILESTONE_STATUSES,
  PROPOSED_KINDS,
  RESPONSE_DUE_ANCHOR,
} from "@/lib/milestone-logic";
import type { ScheduleView } from "@/lib/milestone-store";
import type { PlanMember } from "@/lib/plan-store";
import { addMilestoneAction, buildScheduleAction, removeMilestoneAction, updateMilestoneAction } from "./actions";

type Result = { ok: true; id?: string; added?: number } | { ok: false; error: string };

/** "today", "in 12 days", "3 days ago": the day read against today. */
function relative(todayIso: string, iso: string): string {
  const d = daysBetween(todayIso, iso);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

/**
 * BL-NAV-LIFECYCLE 4b-1 (P-5) — the schedule on the Plan tab: Build the
 * schedule proposes the kick-off today and counts back from the due date;
 * the manager moves, re-owns, marks and removes milestones, and adds
 * others by hand. Status reads the same as everywhere: green done, red
 * missed or overdue, muted planned.
 */
export function SchedulePanel({ opportunityId, schedule, members }: { opportunityId: string; schedule: ScheduleView; members: PlanMember[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<string>("other");
  const [date, setDate] = useState("");
  const [owner, setOwner] = useState("");

  const { todayIso, anchor, keyDates, milestones, state } = schedule;
  const proposedLeft = PROPOSED_KINDS.filter((k) => !milestones.some((m) => m.kind === k));
  const countBack = PROPOSED_KINDS.filter((k) => k !== "kick_off")
    .map((k) => `${MILESTONE_KIND_LABELS[k]} T-${COUNT_BACK_DAYS[k]}`)
    .join(", ");

  function run(fn: () => Promise<Result>, after?: () => void) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      after?.();
      router.refresh();
    });
  }

  const eyebrow =
    state.total === 0
      ? "No schedule yet"
      : [`${state.total} ${state.total === 1 ? "milestone" : "milestones"}`, `${state.done} done`, state.overdue > 0 ? `${state.overdue} overdue` : null, state.nextDate ? `next ${state.nextDate}` : null].filter(Boolean).join(" · ");

  return (
    <Panel
      title="The schedule"
      eyebrow={eyebrow}
      actions={
        proposedLeft.length > 0 ? (
          <button type="button" className={`aur-btn ${state.total === 0 ? "aur-btn-primary" : ""}`} disabled={pending} onClick={() => run(() => buildScheduleAction({ opportunityId }))}>
            {pending ? "Building…" : "Build the schedule"}
          </button>
        ) : null
      }
    >
      {error ? <p className="mb-2 font-body text-[12px] text-red">{error}</p> : null}
      <p className="mb-3 font-body text-[13px] leading-[1.5] text-muted">
        {anchor ? (
          <>
            <strong className="text-text">Build the schedule</strong> puts the kick-off today and counts back from {anchor.key === RESPONSE_DUE_ANCHOR ? "the response due date" : "the proposal due key date"} ({anchor.iso}): {countBack}. Move any milestone, give it an owner, and mark it done; the owner is reminded seven, three and one days before. A colour team&apos;s round has no owner: its reviewers are named above.
          </>
        ) : (
          <>Set the response due date on the Overview first: the schedule counts back from it. You can still add milestones by hand.</>
        )}
      </p>
      {keyDates.length > 0 || anchor ? (
        <p className="mb-3 font-mono text-[11px] text-muted">
          Key dates: {[anchor?.key === RESPONSE_DUE_ANCHOR ? `Response due ${anchor.iso}` : null, ...keyDates.map((k) => `${k.label} ${k.isoDate}`)].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      {milestones.length === 0 ? (
        <p className="font-body text-[13px] leading-[1.5] text-muted">No milestones yet. Build the schedule, or add one below.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="aur-table w-full">
            <thead>
              <tr>
                <th>Milestone</th>
                <th>Date</th>
                <th>Owner</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {milestones.map((m) => {
                const overdue = m.status === "planned" && daysBetween(todayIso, m.date) < 0;
                const tone = m.status === "done" ? "text-green" : m.status === "missed" || overdue ? "text-red" : "text-muted";
                return (
                  <tr key={m.id}>
                    <td className="font-body text-[13px] text-text">
                      {m.title}
                      <span className="block font-mono text-[11px] text-muted">
                        {MILESTONE_KIND_LABELS[m.kind]}
                        {m.anchorKey ? " · proposed" : ""}
                        {m.notes ? ` · ${m.notes}` : ""}
                      </span>
                    </td>
                    <td>
                      <input
                        type="date"
                        className="aur-input w-40"
                        aria-label={`Date of ${m.title}`}
                        value={m.date}
                        disabled={pending}
                        onChange={(e) => e.target.value && run(() => updateMilestoneAction({ opportunityId, milestoneId: m.id, date: e.target.value }))}
                      />
                      <span className={`block font-mono text-[11px] ${tone}`}>{overdue ? `overdue · ${relative(todayIso, m.date)}` : relative(todayIso, m.date)}</span>
                    </td>
                    <td>
                      <select className="aur-input" aria-label={`Owner of ${m.title}`} value={m.ownerUserId ?? ""} disabled={pending} onChange={(e) => run(() => updateMilestoneAction({ opportunityId, milestoneId: m.id, ownerUserId: e.target.value || null }))}>
                        <option value="">Nobody</option>
                        {members.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name || p.email}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select className={`aur-input ${tone}`} aria-label={`Status of ${m.title}`} value={m.status} disabled={pending} onChange={(e) => run(() => updateMilestoneAction({ opportunityId, milestoneId: m.id, status: e.target.value }))}>
                        {MILESTONE_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {MILESTONE_STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-right">
                      <button type="button" className="aur-link font-mono text-[10px] uppercase tracking-widest" disabled={pending} onClick={() => run(() => removeMilestoneAction({ opportunityId, milestoneId: m.id }))}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-layer/10 pt-3">
        <label className="min-w-[14rem] flex-1">
          <span className="aur-label">Milestone</span>
          <input className="aur-input mt-1" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Pricing review with the partner" />
        </label>
        <label className="min-w-[10rem]">
          <span className="aur-label">Marks</span>
          <select className="aur-input mt-1" value={kind} onChange={(e) => setKind(e.target.value)}>
            {MILESTONE_KINDS.map((k) => (
              <option key={k} value={k}>
                {MILESTONE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[10rem]">
          <span className="aur-label">Date</span>
          <input type="date" className="aur-input mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="min-w-[12rem]">
          <span className="aur-label">Owner</span>
          <select className="aur-input mt-1" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Nobody</option>
            {members.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.email}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="aur-btn"
          disabled={pending || !title.trim() || !date}
          onClick={() =>
            run(
              () => addMilestoneAction({ opportunityId, title, kind, date, ownerUserId: owner || null }),
              () => {
                setTitle("");
                setDate("");
                setOwner("");
              },
            )
          }
        >
          Add a milestone
        </button>
      </div>
    </Panel>
  );
}
