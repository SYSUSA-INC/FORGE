"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { uploadFile } from "@/lib/upload-client";
import { AGREEMENT_LABELS, AGREEMENT_STATUSES, RISK_LEVELS, byExposure, type RiskLevel } from "@/lib/plan-charter-logic";
import type { CharterPanelView } from "@/lib/plan-charter-store";
import type { PlanMember } from "@/lib/plan-store";
import { attachAgreementFileAction, saveBudgetAction, saveRisksAction, setAgreementAction } from "./charter-actions";

type Result = { ok: true; note?: string } | { ok: false; error: string };
type RiskDraft = { id: string; title: string; likelihood: RiskLevel; impact: RiskLevel; ownerUserId: string | null; mitigation: string };

/** BL-NAV-LIFECYCLE 4c-1 (P-6, P-7) — the agreement kept by hand, the bid budget estimate, the cut-off dates and the risk list. */
export function PlanRecordPanel({ opportunityId, view, members }: { opportunityId: string; view: CharterPanelView; members: PlanMember[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>(view.agreement.status);
  const [date, setDate] = useState(view.agreement.date ?? "");
  const [hours, setHours] = useState(view.budget.hours === null ? "" : String(view.budget.hours));
  const [dollars, setDollars] = useState(view.budget.dollars === null ? "" : String(view.budget.dollars));
  const [qa, setQa] = useState(view.cutoffs.qa.own ?? "");
  const [amend, setAmend] = useState(view.cutoffs.amendment.own ?? "");
  const [risks, setRisks] = useState<RiskDraft[]>(byExposure(view.risks));
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

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

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const up = await uploadFile(file, { purpose: "document" });
      if (!up.ok) {
        setError(up.error);
        return;
      }
      const res = await attachAgreementFileAction({ opportunityId, uploadId: up.uploadId });
      if (!res.ok) setError(res.error);
      else router.refresh();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const patchRisk = (i: number, p: Partial<RiskDraft>) => setRisks(risks.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const busy = pending || uploading;

  return (
    <Panel title="Agreement, budget and risks" eyebrow={view.isPartner ? `Agreement ${AGREEMENT_LABELS[view.agreement.status].toLowerCase()}` : "No partner on this bid"}>
      {error ? <p className="mb-2 font-body text-[12px] text-red">{error}</p> : null}
      <div className="grid gap-5">
        <section className="grid gap-2">
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted">Teaming agreement{view.isPartner ? " · a signed agreement is needed to move to Develop" : ""}</h3>
          <div className="flex flex-wrap items-center gap-3">
            <select className="aur-input w-44" aria-label="Agreement status" value={status} disabled={busy} onChange={(e) => setStatus(e.target.value)}>
              {AGREEMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {AGREEMENT_LABELS[s]}
                </option>
              ))}
            </select>
            <input type="date" className="aur-input w-40" aria-label="Agreement date" value={date} disabled={busy} onChange={(e) => setDate(e.target.value)} />
            <button type="button" className="aur-btn aur-btn-primary" disabled={busy} onClick={() => run(() => setAgreementAction({ opportunityId, status, date: date || null }))}>
              Record
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 font-body text-[13px]">
            {view.agreement.hasFile ? (
              <a className="aur-link" href={`/api/opportunities/${opportunityId}/plan-agreement`}>
                {view.agreement.fileName}
              </a>
            ) : (
              <span className="text-muted">No file attached.</span>
            )}
            <input ref={fileRef} type="file" className="hidden" aria-label="Agreement file" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <button type="button" className="aur-link font-mono text-[10px] uppercase tracking-widest" disabled={busy} onClick={() => fileRef.current?.click()}>
              {uploading ? "Uploading…" : view.agreement.hasFile ? "Replace the file" : "Attach the file"}
            </button>
          </div>
        </section>

        <section className="grid gap-2 border-t border-layer/10 pt-4">
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted">Bid budget · an estimate only, FORGE does not log time</h3>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-muted">
              Hours
              <input className="aur-input w-32" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
            </label>
            <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-muted">
              Dollars
              <input className="aur-input w-40" inputMode="numeric" value={dollars} onChange={(e) => setDollars(e.target.value)} />
            </label>
            <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-muted">
              Q&amp;A cut-off{view.cutoffs.qa.fromKeyDate ? " (key date)" : ""}
              <input type="date" className="aur-input w-40" value={qa || (view.cutoffs.qa.fromKeyDate ? view.cutoffs.qa.date ?? "" : "")} onChange={(e) => setQa(e.target.value)} />
            </label>
            <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-muted">
              Amendment cut-off{view.cutoffs.amendment.fromKeyDate ? " (final RFP)" : ""}
              <input type="date" className="aur-input w-40" value={amend || (view.cutoffs.amendment.fromKeyDate ? view.cutoffs.amendment.date ?? "" : "")} onChange={(e) => setAmend(e.target.value)} />
            </label>
            <button type="button" className="aur-btn aur-btn-primary" disabled={busy} onClick={() => run(() => saveBudgetAction({ opportunityId, hours, dollars, qaCutoff: qa || null, amendmentCutoff: amend || null }))}>
              Save
            </button>
          </div>
        </section>

        <section className="grid gap-2 border-t border-layer/10 pt-4">
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted">Risks · highest exposure first on reload</h3>
          {risks.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="aur-table w-full">
                <thead>
                  <tr>
                    <th>Risk</th>
                    <th>Likelihood</th>
                    <th>Impact</th>
                    <th>Owner</th>
                    <th>Mitigation</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {risks.map((r, i) => (
                    <tr key={r.id || i}>
                      <td><input className="aur-input" aria-label="Risk title" value={r.title} maxLength={300} onChange={(e) => patchRisk(i, { title: e.target.value })} /></td>
                      {(["likelihood", "impact"] as const).map((k) => (
                        <td key={k}>
                          <select className="aur-input w-28" aria-label={`Risk ${k}`} value={r[k]} onChange={(e) => patchRisk(i, { [k]: e.target.value as RiskLevel })}>
                            {RISK_LEVELS.map((l) => (
                              <option key={l} value={l}>{l}</option>
                            ))}
                          </select>
                        </td>
                      ))}
                      <td>
                        <select className="aur-input" aria-label="Risk owner" value={r.ownerUserId ?? ""} onChange={(e) => patchRisk(i, { ownerUserId: e.target.value || null })}>
                          <option value="">Nobody</option>
                          {members.map((m) => (
                            <option key={m.id} value={m.id}>{m.name || m.email}</option>
                          ))}
                        </select>
                      </td>
                      <td><input className="aur-input" aria-label="Mitigation" value={r.mitigation} maxLength={1000} onChange={(e) => patchRisk(i, { mitigation: e.target.value })} /></td>
                      <td>
                        <button type="button" className="aur-link font-mono text-[10px] uppercase tracking-widest" onClick={() => setRisks(risks.filter((_, j) => j !== i))}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="font-body text-[13px] text-muted">No risks listed yet.</p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="aur-link font-mono text-[10px] uppercase tracking-widest" onClick={() => setRisks([...risks, { id: "", title: "", likelihood: "medium", impact: "medium", ownerUserId: null, mitigation: "" }])}>
              Add a risk
            </button>
            <button type="button" className="aur-btn aur-btn-primary" disabled={busy} onClick={() => run(() => saveRisksAction({ opportunityId, risks }))}>
              Save the risks
            </button>
          </div>
        </section>
      </div>
    </Panel>
  );
}
