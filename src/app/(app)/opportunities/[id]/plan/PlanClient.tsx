"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import {
  PLAN_COLOR_TEAM_LABELS,
  PLAN_COLOR_TEAMS,
  PLAN_NEXT_STEP_LABELS,
  PLAN_ROLE_LABELS,
  PLAN_ROLES,
  RACI_AREA_LABELS,
  RACI_AREAS,
  RACI_LETTER_LABELS,
  RACI_LETTERS,
  planNextStep,
  type PlanColorTeam,
} from "@/lib/plan-logic";
import type { ScheduleView } from "@/lib/milestone-store";
import type { PlanMember, PlanView } from "@/lib/plan-store";
import { addPlanRoleAction, removePlanRoleAction, setPlanRaciAction } from "./actions";
import { SchedulePanel } from "./SchedulePanel";

/** Status means the same thing everywhere: plum is the pink team; red, brass and muted follow the review colours. */
const COLOR_TONE: Record<PlanColorTeam, string> = {
  pink: "text-plum",
  red: "text-red",
  gold: "text-brass",
  white_gloves: "text-muted",
};

type Result = { ok: true; id?: string } | { ok: false; error: string };

export function PlanClient({ opportunityId, plan, members, schedule }: { opportunityId: string; plan: PlanView; members: PlanMember[]; schedule: ScheduleView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState(members[0]?.id ?? "");
  const [role, setRole] = useState<string>("proposal_manager");
  const [notes, setNotes] = useState("");
  const [colorPick, setColorPick] = useState<Record<PlanColorTeam, string>>({ pink: members[0]?.id ?? "", red: members[0]?.id ?? "", gold: members[0]?.id ?? "", white_gloves: members[0]?.id ?? "" });

  const who = (m: { userName: string; userEmail: string }) => m.userName || m.userEmail || "Unknown";
  const teamRows = plan.roles.filter((r) => !(r.role === "color_team_reviewer" && r.colorTeam));
  const step = planNextStep(plan.state);

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

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="The team and the RACI"
        eyebrow={`${plan.state.people} ${plan.state.people === 1 ? "person" : "people"} · A for ${plan.state.accountable.length} of ${RACI_AREAS.length} areas`}
        actions={<span className="font-mono text-[11px] uppercase tracking-label text-cobalt">Next: {PLAN_NEXT_STEP_LABELS[step]}</span>}
      >
        {error ? <p className="mb-2 font-body text-[12px] text-red">{error}</p> : null}
        <p className="mb-3 font-body text-[13px] leading-[1.5] text-muted">
          One list with the solicitation&apos;s team: a role named here appears there, and the other way round. Each area needs one <strong className="text-text">A</strong>; whoever is R or A for an area owns its milestones and parts.
          {plan.solicitationId ? "" : " This opportunity has no solicitation yet, so the team lives on the plan alone."}
        </p>
        {teamRows.length === 0 ? (
          <p className="font-body text-[13px] leading-[1.5] text-muted">Nobody is on the plan yet. Name the team below.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="aur-table w-full">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  {RACI_AREAS.map((a) => (
                    <th key={a} className="text-center">{RACI_AREA_LABELS[a]}</th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {teamRows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-body text-[13px] text-text">
                      {who(r)}
                      {r.notes ? <span className="block font-mono text-[11px] text-muted">{r.notes}</span> : null}
                    </td>
                    <td className="font-mono text-[11px] text-muted">
                      {PLAN_ROLE_LABELS[r.role]}
                      {r.source === "seeded" ? <span className="ml-1 text-subtle">· from the solicitation</span> : null}
                    </td>
                    {RACI_AREAS.map((area) => (
                      <td key={area} className="text-center">
                        <select
                          className="aur-input w-14 text-center"
                          aria-label={`${RACI_AREA_LABELS[area]} letter for ${who(r)}`}
                          value={r.raci[area] ?? ""}
                          disabled={pending}
                          onChange={(e) => run(() => setPlanRaciAction({ opportunityId, roleId: r.id, area, letter: e.target.value || null }))}
                        >
                          <option value="">—</option>
                          {RACI_LETTERS.map((l) => (
                            <option key={l} value={l} title={RACI_LETTER_LABELS[l]}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </td>
                    ))}
                    <td className="text-right">
                      <button type="button" className="aur-link font-mono text-[10px] uppercase tracking-widest" disabled={pending} onClick={() => run(() => removePlanRoleAction({ opportunityId, roleId: r.id }))}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 font-mono text-[11px] text-muted">{RACI_LETTERS.map((l) => `${l} ${RACI_LETTER_LABELS[l].toLowerCase()}`).join(" · ")}</p>
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-layer/10 pt-3">
          <label className="min-w-[14rem] flex-1">
            <span className="aur-label">Teammate</span>
            <select className="aur-input mt-1" value={pick} onChange={(e) => setPick(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.email}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[12rem] flex-1">
            <span className="aur-label">Role</span>
            <select className="aur-input mt-1" value={role} onChange={(e) => setRole(e.target.value)}>
              {PLAN_ROLES.map((r) => (
                <option key={r} value={r}>
                  {PLAN_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[14rem] flex-1">
            <span className="aur-label">Notes (optional)</span>
            <input className="aur-input mt-1" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="What they own, or when they join" />
          </label>
          <button type="button" className="aur-btn aur-btn-primary" disabled={pending || !pick} onClick={() => run(() => addPlanRoleAction({ opportunityId, userId: pick, role, notes }), () => setNotes(""))}>
            {pending ? "Naming…" : "Name to the team"}
          </button>
        </div>
      </Panel>

      <Panel title="The colour teams" eyebrow={`${plan.state.colorTeamsNamed} of ${PLAN_COLOR_TEAMS.length} named`}>
        <p className="mb-3 font-body text-[13px] leading-[1.5] text-muted">
          Name the reviewers ahead of their round. Each person named is told now; the schedule below gives each round its date, and when the proposal reaches their colour, the round starts with them on it (4c).
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PLAN_COLOR_TEAMS.map((c) => {
            const team = plan.roles.filter((r) => r.role === "color_team_reviewer" && r.colorTeam === c);
            return (
              <div key={c} className="min-w-0">
                <p className={`font-mono text-[10px] uppercase tracking-label ${COLOR_TONE[c]}`}>{PLAN_COLOR_TEAM_LABELS[c]}</p>
                {team.length === 0 ? (
                  <p className="border-t border-layer/10 py-1.5 font-body text-[13px] text-muted">Nobody named yet.</p>
                ) : (
                  <ul className="flex flex-col">
                    {team.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2 border-t border-layer/10 py-1.5">
                        <span className="truncate font-body text-[13px] text-text">{who(r)}</span>
                        <button type="button" className="aur-link font-mono text-[10px] uppercase tracking-widest" disabled={pending} onClick={() => run(() => removePlanRoleAction({ opportunityId, roleId: r.id }))}>
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex items-end gap-2 border-t border-layer/10 pt-2">
                  <label className="min-w-0 flex-1">
                    <span className="aur-label">Add</span>
                    <select className="aur-input mt-1" aria-label={`Add to ${PLAN_COLOR_TEAM_LABELS[c]}`} value={colorPick[c]} onChange={(e) => setColorPick({ ...colorPick, [c]: e.target.value })}>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name || m.email}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="aur-btn" disabled={pending || !colorPick[c]} onClick={() => run(() => addPlanRoleAction({ opportunityId, userId: colorPick[c], role: "color_team_reviewer", colorTeam: c }))}>
                    Add
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <SchedulePanel opportunityId={opportunityId} schedule={schedule} members={members} />
    </div>
  );
}
