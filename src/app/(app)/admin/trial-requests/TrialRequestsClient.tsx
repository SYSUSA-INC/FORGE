"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { InviteLinkNotice } from "@/components/auth/InviteLinkNotice";
import { Panel } from "@/components/ui/Panel";
import type { TrialRequestRow } from "@/lib/trial-requests";
import { TRIAL_DAYS } from "@/lib/trial-logic";
import { approveTrialRequestAction, declineTrialRequestAction } from "./actions";

/**
 * BL-AUTH-ABUSE Slice 2b — the trial-request queue: pending requests
 * oldest first with Approve / Decline, then the latest decisions.
 */
export function TrialRequestsClient({ pending, decided }: { pending: TrialRequestRow[]; decided: TrialRequestRow[] }) {
  return (
    <>
      <Panel title="Waiting for a decision" eyebrow={`${pending.length} pending`}>
        {pending.length === 0 ? (
          <div className="font-mono text-[11px] text-muted">No trial requests waiting.</div>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((r) => (
              <PendingRow key={r.id} r={r} />
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Recent decisions" className="mt-4">
        {decided.length === 0 ? (
          <div className="font-mono text-[11px] text-muted">None yet.</div>
        ) : (
          <ul className="flex flex-col gap-2 font-mono text-[11px]">
            {decided.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2">
                <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${r.status === "approved" ? "bg-emerald/15 text-emerald" : "bg-layer/10 text-muted"}`}>
                  {r.status}
                </span>
                <span className="text-text">{r.company}</span>
                <span className="text-muted">{r.email}</span>
                <span className="text-muted">
                  {r.decidedAt ? new Date(r.decidedAt).toLocaleDateString("en-US", { dateStyle: "medium" }) : ""}
                  {r.decidedBy ? ` by ${r.decidedBy}` : ""}
                </span>
                {r.status === "declined" && r.declineReason ? <span className="text-muted/80">“{r.declineReason}”</span> : null}
                {r.createdOrganizationId ? (
                  <Link href={`/admin/orgs/${r.createdOrganizationId}`} className="text-indigo-300 underline-offset-2 hover:underline">
                    Workspace →
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function PendingRow({ r }: { r: TrialRequestRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [approved, setApproved] = useState<{ inviteUrl: string | null; emailSent: boolean; warning?: string; organizationId: string } | null>(null);

  function approve() {
    if (!window.confirm(`Create a workspace for ${r.company}, invite ${r.email} as its admin and start a ${TRIAL_DAYS}-day trial?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await approveTrialRequestAction(r.id);
      if (!res.ok) return setError(res.error);
      setApproved({ inviteUrl: res.inviteUrl, emailSent: res.emailSent, warning: res.warning, organizationId: res.organizationId });
    });
  }

  function decline() {
    setError(null);
    startTransition(async () => {
      const res = await declineTrialRequestAction(r.id, reason);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <li className="rounded-lg border border-layer/10 bg-layer/[0.02] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-text">
            {r.company} <span className="font-normal text-muted">· {r.name}{r.jobTitle ? `, ${r.jobTitle}` : ""}</span>
          </div>
          <div className="font-mono text-[11px] text-muted">
            {r.email} · asked {new Date(r.createdAt).toLocaleDateString("en-US", { dateStyle: "medium" })}
          </div>
        </div>
        {approved ? null : (
          <div className="flex gap-2">
            <button type="button" className="aur-btn aur-btn-primary text-[11px]" disabled={pending} onClick={approve}>
              {pending && !declining ? "Approving…" : "Approve"}
            </button>
            <button type="button" className="aur-btn aur-btn-ghost text-[11px]" disabled={pending} onClick={() => setDeclining((v) => !v)}>
              Decline…
            </button>
          </div>
        )}
      </div>
      {r.message ? <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-muted">{r.message}</p> : null}
      {declining && !approved ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            className="aur-input flex-1 min-w-[220px]"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (internal, optional)"
            maxLength={300}
            disabled={pending}
          />
          <button type="button" className="aur-btn aur-btn-danger text-[11px]" disabled={pending} onClick={decline}>
            {pending ? "Declining…" : "Decline request"}
          </button>
        </div>
      ) : null}
      {approved ? (
        <div className="mt-2 flex flex-col gap-2">
          <InviteLinkNotice url={approved.inviteUrl} emailSent={approved.emailSent} warning={approved.warning} sentTo={r.email} />
          <Link href={`/admin/orgs/${approved.organizationId}`} className="font-mono text-[11px] text-indigo-300 underline-offset-2 hover:underline">
            Open the new workspace →
          </Link>
        </div>
      ) : null}
      {error ? <div className="mt-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div> : null}
    </li>
  );
}
