"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { daysBetween } from "@/lib/milestone-logic";
import type { PlanMember } from "@/lib/plan-store";
import type { PartsView } from "@/lib/section-plan-store";
import { setPartDueDateAction, setPartOwnerAction } from "./actions";

type Result = { ok: true; id?: string } | { ok: false; error: string };

const STATUS_LABELS: Record<PartsView["parts"][number]["status"], string> = {
  not_started: "Not started",
  in_progress: "In progress",
  draft_complete: "Draft complete",
  in_review: "In review",
  approved: "Approved",
};

/**
 * BL-NAV-LIFECYCLE 4b-2 (P-4) — the parts on the Plan tab: the sections
 * of the opportunity's proposals, each with an owner (the section author,
 * as Develop sees it) and a due date. Naming an owner tells them, with
 * the date; a part past its date with no draft reads red and its owner
 * is told by the daily cron.
 */
export function PartsPanel({ opportunityId, parts, members }: { opportunityId: string; parts: PartsView; members: PlanMember[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { todayIso, count } = parts;
  const several = parts.proposals.length > 1;

  function run(fn: () => Promise<Result>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  const eyebrow = count.total === 0 ? "No outline yet" : [`${count.total} ${count.total === 1 ? "part" : "parts"}`, `${count.owned} owned`, `${count.dated} dated`, parts.parts.some((p) => p.overdue) ? `${parts.parts.filter((p) => p.overdue).length} overdue` : null].filter(Boolean).join(" · ");

  return (
    <Panel
      title="The parts and their owners"
      eyebrow={eyebrow}
      actions={
        parts.proposals.length > 0 ? (
          <Link className="aur-link font-mono text-[10px] uppercase tracking-widest" href={`/proposals/${parts.proposals[0].id}/sections`}>
            Open the sections
          </Link>
        ) : null
      }
    >
      {error ? <p className="mb-2 font-body text-[12px] text-red">{error}</p> : null}
      <p className="mb-3 font-body text-[13px] leading-[1.5] text-muted">
        Each section of the outline gets an owner and a day it is due. The owner is the section&apos;s author, so Develop sees the same people; naming one tells them, with the date. A part past its day with nothing written is overdue: its owner is told the next morning.
      </p>
      {parts.parts.length === 0 ? (
        <p className="font-body text-[13px] leading-[1.5] text-muted">
          {parts.proposals.length === 0 ? "No proposal yet. Start one from the opportunity, and its outline's sections appear here." : "The proposal has no sections yet. Build the outline on the proposal first."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="aur-table w-full">
            <thead>
              <tr>
                <th>Part</th>
                <th>Owner</th>
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {parts.parts.map((p) => {
                const tone = p.overdue ? "text-red" : p.status === "approved" ? "text-green" : p.hasDraft ? "text-cobalt" : "text-muted";
                const when = p.dueDate ? (daysBetween(todayIso, p.dueDate) === 0 ? "today" : daysBetween(todayIso, p.dueDate) > 0 ? `in ${daysBetween(todayIso, p.dueDate)} days` : `${-daysBetween(todayIso, p.dueDate)} days ago`) : null;
                return (
                  <tr key={p.id}>
                    <td className="font-body text-[13px] text-text">
                      {p.title}
                      {several ? <span className="block font-mono text-[11px] text-muted">{p.proposalTitle}</span> : null}
                    </td>
                    <td>
                      <select className="aur-input" aria-label={`Owner of ${p.title}`} value={p.authorUserId ?? ""} disabled={pending} onChange={(e) => run(() => setPartOwnerAction({ opportunityId, proposalId: p.proposalId, sectionId: p.id, authorUserId: e.target.value || null }))}>
                        <option value="">Nobody</option>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name || m.email}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input type="date" className="aur-input w-40" aria-label={`Due date of ${p.title}`} value={p.dueDate ?? ""} disabled={pending} onChange={(e) => run(() => setPartDueDateAction({ opportunityId, proposalId: p.proposalId, sectionId: p.id, dueDate: e.target.value || null }))} />
                      {when ? <span className={`block font-mono text-[11px] ${p.overdue ? "text-red" : "text-muted"}`}>{p.overdue ? `overdue · ${when}` : when}</span> : null}
                    </td>
                    <td className={`font-mono text-[11px] ${tone}`}>{p.overdue ? "Overdue, no draft" : STATUS_LABELS[p.status]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
