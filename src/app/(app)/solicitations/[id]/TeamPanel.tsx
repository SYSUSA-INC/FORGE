"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SolicitationRole } from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import {
  SOLICITATION_ROLE_LABELS,
  SOLICITATION_ROLES,
  assignSolicitationRoleAction,
  listAssignableMembersAction,
  unassignSolicitationRoleAction,
  type AssignmentRow,
} from "./team-actions";

type Member = { id: string; name: string; email: string };

export function TeamPanel({
  solicitationId,
  initial,
}: {
  solicitationId: string;
  initial: AssignmentRow[];
}) {
  const router = useRouter();
  const [assignments, setAssignments] = useState<AssignmentRow[]>(initial);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [pickedUserId, setPickedUserId] = useState("");
  const [pickedRole, setPickedRole] = useState<SolicitationRole>("capture_lead");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    listAssignableMembersAction()
      .then((rows) => {
        if (cancelled) return;
        setMembers(rows);
        if (rows.length > 0) setPickedUserId(rows[0].id);
      })
      .catch(() => {
        if (cancelled) return;
        setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function add() {
    setError(null);
    setNotice(null);
    if (!pickedUserId) {
      setError("Pick a teammate.");
      return;
    }
    startTransition(async () => {
      const res = await assignSolicitationRoleAction({
        solicitationId,
        userId: pickedUserId,
        role: pickedRole,
        notes: notes.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice("Assigned. They've been notified.");
      setNotes("");
      router.refresh();
      // Optimistic local update so the list reflects immediately even
      // if router.refresh races.
      const m = members?.find((x) => x.id === pickedUserId);
      if (m) {
        setAssignments((prev) => [
          ...prev.filter(
            (a) => !(a.userId === pickedUserId && a.role === pickedRole),
          ),
          {
            userId: m.id,
            userName: m.name || null,
            userEmail: m.email,
            role: pickedRole,
            notes: notes.trim(),
            assignedAt: new Date().toISOString(),
            assignedByName: null,
          },
        ]);
      }
    });
  }

  function remove(userId: string, role: SolicitationRole) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await unassignSolicitationRoleAction({
        solicitationId,
        userId,
        role,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAssignments((prev) =>
        prev.filter((a) => !(a.userId === userId && a.role === role)),
      );
      router.refresh();
    });
  }

  // Group assignments by role for cleaner display.
  const byRole = new Map<SolicitationRole, AssignmentRow[]>();
  for (const a of assignments) {
    if (!byRole.has(a.role)) byRole.set(a.role, []);
    byRole.get(a.role)!.push(a);
  }

  return (
    <Panel title="Team" eyebrow={`${assignments.length} assigned`}>
      {assignments.length === 0 ? (
        <div className="font-mono text-[11px] text-muted">
          No one assigned yet. Add a capture lead, technical lead, and any
          reviewers below.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {SOLICITATION_ROLES.filter((r) => byRole.has(r)).map((role) => {
            const rows = byRole.get(role)!;
            return (
              <li
                key={role}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-2"
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-200">
                  {SOLICITATION_ROLE_LABELS[role]}
                </div>
                <ul className="mt-1 flex flex-col gap-1">
                  {rows.map((a) => (
                    <li
                      key={`${a.userId}-${a.role}`}
                      className="flex items-start justify-between gap-2 rounded border border-white/5 bg-white/[0.02] px-2 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-display text-[12px] font-semibold text-text">
                          {a.userName || a.userEmail}
                        </div>
                        {a.userName ? (
                          <div className="truncate font-mono text-[10px] text-muted">
                            {a.userEmail}
                          </div>
                        ) : null}
                        {a.notes ? (
                          <div className="mt-1 font-body text-[11px] leading-snug text-muted">
                            {a.notes}
                          </div>
                        ) : null}
                        <div className="mt-1 font-mono text-[9px] uppercase tracking-widest text-subtle">
                          assigned {new Date(a.assignedAt).toLocaleDateString()}
                          {a.assignedByName
                            ? ` by ${a.assignedByName}`
                            : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => remove(a.userId, a.role)}
                        disabled={pending}
                        className="aur-btn aur-btn-ghost text-[10px] text-rose-300 disabled:opacity-60"
                        title="Remove assignment"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.015] p-3">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          Add teammate
        </div>
        <div className="grid grid-cols-1 gap-2">
          <div>
            <label className="aur-label">Teammate</label>
            {members === null ? (
              <div className="font-mono text-[11px] text-muted">Loading…</div>
            ) : members.length === 0 ? (
              <div className="rounded border border-amber-400/30 bg-amber-400/5 px-2 py-1 font-mono text-[11px] text-amber-200">
                No active members. Invite users in Settings first.
              </div>
            ) : (
              <select
                className="aur-input"
                value={pickedUserId}
                onChange={(e) => setPickedUserId(e.target.value)}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name ? `${m.name} · ${m.email}` : m.email}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="aur-label">Role</label>
            <select
              className="aur-input"
              value={pickedRole}
              onChange={(e) =>
                setPickedRole(e.target.value as SolicitationRole)
              }
            >
              {SOLICITATION_ROLES.map((r) => (
                <option key={r} value={r}>
                  {SOLICITATION_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="aur-label">Notes (optional)</label>
            <input
              className="aur-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., owns Section L, capture-only, runs Pink team…"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="font-mono text-[10px] text-muted">
              They'll get an in-app notification on assignment.
            </div>
            <button
              type="button"
              onClick={add}
              disabled={pending || !pickedUserId}
              className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
            >
              {pending ? "Working…" : "Add"}
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mt-3 rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 font-mono text-[11px] text-emerald">
          {notice}
        </div>
      ) : null}
    </Panel>
  );
}
