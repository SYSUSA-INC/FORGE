"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { VERDICT_COLORS, VERDICT_LABELS } from "@/lib/review-types";
import {
  assignReviewerAction,
  unassignReviewerAction,
} from "../actions";

type Assignment = {
  userId: string;
  name: string | null;
  email: string;
  verdict: string | null;
  summary: string;
  submittedAt: string | null;
};

type Candidate = {
  id: string;
  name: string | null;
  email: string;
  role: string;
};

export function ReviewerList({
  reviewId,
  assignments,
  candidates,
  canEdit,
}: {
  reviewId: string;
  assignments: Assignment[];
  candidates: Candidate[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [addUser, setAddUser] = useState("");

  const assignedIds = new Set(assignments.map((a) => a.userId));
  const available = candidates.filter((c) => !assignedIds.has(c.id));

  function add() {
    if (!addUser) return;
    setError(null);
    startTransition(async () => {
      const res = await assignReviewerAction({ reviewId, userId: addUser });
      if (!res.ok) return setError(res.error);
      setAddUser("");
      router.refresh();
    });
  }

  function unassign(userId: string) {
    setError(null);
    startTransition(async () => {
      const res = await unassignReviewerAction({ reviewId, userId });
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <Panel title="Reviewers" eyebrow={`${assignments.length} assigned`}>
      {assignments.length === 0 ? (
        <div className="font-mono text-[11px] text-muted">
          No reviewers yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {assignments.map((a) => {
            const verdictColor = a.verdict
              ? VERDICT_COLORS[a.verdict as "pass" | "conditional" | "fail"]
              : null;
            return (
              <li
                key={a.userId}
                className="rounded-md border border-white/10 bg-white/[0.02] p-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 truncate font-mono text-[12px] text-text">
                    {a.name ?? a.email}
                  </div>
                  <div className="flex items-center gap-2">
                    {a.submittedAt && a.verdict && verdictColor ? (
                      <span
                        className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
                        style={{
                          color: verdictColor,
                          backgroundColor: `${verdictColor}1A`,
                          border: `1px solid ${verdictColor}40`,
                        }}
                      >
                        {VERDICT_LABELS[a.verdict as "pass" | "conditional" | "fail"]}
                      </span>
                    ) : (
                      <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
                        Pending
                      </span>
                    )}
                    {canEdit ? (
                      <button
                        type="button"
                        className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-rose"
                        disabled={pending}
                        onClick={() => unassign(a.userId)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
                {a.submittedAt && a.summary ? (
                  <div className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-muted">
                    {a.summary}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && available.length > 0 ? (
        <div className="mt-3 flex gap-2">
          <select
            className="aur-input flex-1 text-[12px]"
            value={addUser}
            onChange={(e) => setAddUser(e.target.value)}
          >
            <option value="">Add reviewer…</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? c.email}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="aur-btn aur-btn-ghost text-[12px]"
            disabled={!addUser || pending}
            onClick={add}
          >
            Add
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="mt-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
    </Panel>
  );
}
