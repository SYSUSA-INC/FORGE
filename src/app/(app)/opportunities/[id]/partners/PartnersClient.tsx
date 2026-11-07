"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { PARTNER_STATUS_LABELS } from "@/lib/capture-logic";
import type { OpportunityPartnerStatus } from "@/db/schema";
import { addPartnerAction, moveToPlanAction, removePartnerAction, setPartnerStatusAction } from "./actions";

export type PartnerView = { id: string; companyId: string; name: string; relationship: string; status: OpportunityPartnerStatus; reason: string; chosenAt: string | null; chosenBy: string | null };

const STATUS_TONE: Record<OpportunityPartnerStatus, string> = {
  candidate: "border-layer/15 text-muted",
  invited: "border-cobalt/40 text-cobalt",
  answered: "border-indigo/40 text-indigo",
  chosen: "border-green/50 bg-green/10 text-green",
  declined: "border-layer/10 text-subtle line-through",
};

/**
 * BL-NAV-LIFECYCLE phase 3a — the partners considered for this
 * opportunity: add one from your Companies (FORGE's suggestions first),
 * choose, decline or remove, and Move to Plan when nothing stands in the
 * way.
 */
export function PartnersClient(props: {
  opportunityId: string;
  decision: "go" | "no_go" | "partner" | null;
  partners: PartnerView[];
  suggestions: { id: string; name: string; why: string }[];
  companies: { id: string; name: string; relationship: string }[];
  blocker: string | null;
  naics: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  const [reason, setReason] = useState("");

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error);
      after?.();
      router.refresh();
    });
  }

  const chosen = props.partners.filter((p) => p.status === "chosen");

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="flex flex-col gap-4 xl:col-span-2">
        <Panel title="Partners" eyebrow={`${props.partners.length} considered · ${chosen.length} chosen`}>
          {error ? <p className="mb-2 font-body text-[12px] text-red">{error}</p> : null}
          {props.partners.length === 0 ? (
            <p className="font-body text-[13px] leading-[1.5] text-muted">
              {props.decision === "partner" ? "No partner considered yet. Add one from FORGE's suggestions or your Companies." : "No partner needed for a GO, but you can still add one."}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-layer/10">
              {props.partners.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <div className="min-w-[14rem] flex-1">
                    <Link href={`/companies/${p.companyId}`} className="font-body text-[14px] text-text hover:underline">
                      {p.name}
                    </Link>
                    <p className="font-mono text-[11px] text-muted">
                      {p.relationship.replace("_", " ")}
                      {p.reason ? ` · ${p.reason}` : ""}
                      {p.status === "chosen" && p.chosenAt ? ` · chosen ${p.chosenAt.slice(0, 10)}${p.chosenBy ? ` by ${p.chosenBy}` : ""}` : ""}
                    </p>
                  </div>
                  <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest ${STATUS_TONE[p.status]}`}>{PARTNER_STATUS_LABELS[p.status]}</span>
                  {p.status !== "chosen" ? (
                    <button type="button" className="aur-btn aur-btn-primary" disabled={pending} onClick={() => run(() => setPartnerStatusAction({ opportunityId: props.opportunityId, partnerId: p.id, status: "chosen" }))}>
                      Choose
                    </button>
                  ) : (
                    <button type="button" className="aur-btn" disabled={pending} onClick={() => run(() => setPartnerStatusAction({ opportunityId: props.opportunityId, partnerId: p.id, status: "candidate" }))}>
                      Unchoose
                    </button>
                  )}
                  {p.status !== "declined" && p.status !== "chosen" ? (
                    <button type="button" className="aur-link font-mono text-[10px] uppercase tracking-widest" disabled={pending} onClick={() => run(() => setPartnerStatusAction({ opportunityId: props.opportunityId, partnerId: p.id, status: "declined" }))}>
                      Decline
                    </button>
                  ) : null}
                  {p.status === "declined" ? (
                    <button type="button" className="aur-link font-mono text-[10px] uppercase tracking-widest" disabled={pending} onClick={() => run(() => setPartnerStatusAction({ opportunityId: props.opportunityId, partnerId: p.id, status: "candidate" }))}>
                      Reconsider
                    </button>
                  ) : null}
                  <button type="button" className="aur-link font-mono text-[10px] uppercase tracking-widest" disabled={pending} onClick={() => run(() => removePartnerAction({ opportunityId: props.opportunityId, partnerId: p.id }))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Add a partner" eyebrow="From your Companies">
          {props.suggestions.length > 0 ? (
            <div className="mb-3">
              <p className="mb-1 font-mono text-[10px] uppercase tracking-label text-muted">Suggested</p>
              <ul className="flex flex-col gap-1">
                {props.suggestions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-3 font-body text-[13px]">
                    <span className="text-text">{s.name}</span>
                    <span className="font-mono text-[11px] text-muted">{s.why}</span>
                    <button type="button" className="aur-link font-mono text-[10px] uppercase tracking-widest" disabled={pending} onClick={() => run(() => addPartnerAction({ opportunityId: props.opportunityId, companyId: s.id, reason: s.why }))}>
                      Add
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[14rem] flex-1">
              <span className="aur-label">Company</span>
              <select className="aur-input mt-1" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose…</option>
                {props.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.relationship.replace("_", " ")})
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-[14rem] flex-1">
              <span className="aur-label">Why (optional)</span>
              <input className="aur-input mt-1" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. covers the cleared SOC" />
            </label>
            <button
              type="button"
              className="aur-btn"
              disabled={pending || !pick}
              onClick={() =>
                run(
                  () => addPartnerAction({ opportunityId: props.opportunityId, companyId: pick, reason }),
                  () => {
                    setPick("");
                    setReason("");
                  },
                )
              }
            >
              Add
            </button>
          </div>
          <p className="mt-2 font-body text-[12px] text-muted">
            Not in your Companies? Use <strong className="font-medium text-text">Find partners</strong> below, or{" "}
            <Link href={`/companies/search${props.naics ? `?naics=${encodeURIComponent(props.naics)}` : ""}`} className="aur-link">
              search SAM.gov by name
            </Link>
            .
          </p>
        </Panel>
      </div>
      <Panel title="Move to Plan" eyebrow={props.decision === "partner" ? "PARTNER" : props.decision === "go" ? "GO" : "No decision yet"}>
        {chosen.length > 0 ? (
          <p className="mb-2 font-body text-[13px] text-text">
            Partner{chosen.length === 1 ? "" : "s"}: {chosen.map((c) => c.name).join(", ")}. <span className="text-brass">Teaming agreement: to do.</span>
          </p>
        ) : null}
        {props.blocker ? (
          <p className="font-body text-[13px] leading-[1.5] text-muted">{props.blocker}</p>
        ) : (
          <>
            <p className="mb-3 font-body text-[13px] leading-[1.5] text-muted">The pursuit moves to Plan (stage Captured): the team, the RACI and the schedule.{props.decision === "partner" ? " The teaming agreement stays to do until agreements arrive in FORGE." : ""}</p>
            <button type="button" className="aur-btn aur-btn-primary" disabled={pending} onClick={() => run(() => moveToPlanAction({ opportunityId: props.opportunityId }))}>
              {pending ? "Moving…" : "Move to Plan"}
            </button>
          </>
        )}
      </Panel>
    </div>
  );
}
