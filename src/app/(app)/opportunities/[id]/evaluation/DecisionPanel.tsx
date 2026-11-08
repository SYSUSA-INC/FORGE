"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import type { OpportunityDecisionKind } from "@/db/schema";
import { DECISION_LABELS, NO_GO_CATEGORIES, NO_GO_REASON_MIN } from "@/lib/opportunity-decision";
import type { DecisionView, PartnerSuggestion } from "@/lib/opportunity-decision-store";
import { decideOpportunityAction } from "../decision-actions";

const TONE: Record<OpportunityDecisionKind, string> = {
  go: "border-green/40 bg-green/10 text-green",
  no_go: "border-red/40 bg-red/10 text-red",
  partner: "border-indigo/40 bg-indigo/10 text-indigo",
};

/**
 * BL-NAV-LIFECYCLE phase 2a — the Evaluate decision (FORGE II footnote 5):
 * GO (to Capture, then Plan), NO-GO (closes it; a category and the team's
 * own reason are required), PARTNER (to Capture, partner needed, with the
 * company's own partners that could cover the gaps). Every decision is
 * kept; the history is below.
 */
export function DecisionPanel({ opportunityId, history, partners, readiness, naics, canDecide }: { opportunityId: string; history: DecisionView[]; partners: PartnerSuggestion[]; readiness: string | null; naics: string; canDecide: boolean }) {
  const router = useRouter();
  const [choice, setChoice] = useState<OpportunityDecisionKind | null>(null);
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const latest = history[0] ?? null;

  function submit() {
    if (!choice) return;
    setError(null);
    start(async () => {
      const res = await decideOpportunityAction({ opportunityId, decision: choice, category, reason });
      if (!res.ok) return setError(res.error);
      setChoice(null);
      setReason("");
      setCategory("");
      router.refresh();
    });
  }

  return (
    <Panel title="Decision" eyebrow={latest ? `${DECISION_LABELS[latest.decision]} · ${new Date(latest.at).toLocaleDateString()}` : "GO, NO-GO or PARTNER"}>
      <div id="decision" className="scroll-mt-24" />
      {readiness ? <p className="mb-3 font-body text-[12px] leading-[1.5] text-brass">{readiness}: the decision is better informed with both reports.</p> : null}
      {canDecide ? null : <p className="font-body text-[12px] leading-[1.5] text-muted">Decided in Evaluate. The stage panel below moves it on from here.</p>}
      <div className={canDecide ? "flex flex-wrap gap-2" : "hidden"}>
        {(["go", "no_go", "partner"] as const).map((d) => (
          <button key={d} type="button" aria-pressed={choice === d} onClick={() => {
            setChoice(d);
            setError(null);
          }} className={`rounded border px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest ${choice === d ? TONE[d] : "border-layer/15 text-muted hover:text-text"}`}>
            {DECISION_LABELS[d]}
          </button>
        ))}
      </div>
      {canDecide && choice ? (
        <div className="mt-3 flex flex-col gap-2">
          <p className="font-body text-[12px] leading-[1.5] text-muted">
            {choice === "go"
              ? "Moves it to Capture (Qualified); with no partner to find, it goes on to Plan."
              : choice === "partner"
                ? "Moves it to Capture (Qualified), marked as needing a partner."
                : "Closes it as No bid and stops the SAM.gov amendment watch. Say why: FORGE learns from it."}
          </p>
          {choice === "no_go" ? (
            <label className="block">
              <span className="aur-label">Why</span>
              <select className="aur-input mt-1" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Choose…</option>
                {NO_GO_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block">
            <span className="aur-label">{choice === "no_go" ? `In your own words (at least ${NO_GO_REASON_MIN} characters)` : "Note (optional)"}</span>
            <textarea className="aur-input mt-1 min-h-[70px]" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {choice === "partner" ? (
            <div className="rounded border border-layer/10 px-3 py-2">
              <div className="aur-label mb-1">Partners you already work with</div>
              {partners.length === 0 ? (
                <p className="font-body text-[12px] text-muted">No teaming partners or subcontractors in your Companies yet.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {partners.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-baseline gap-2 font-body text-[13px]">
                      <Link href={`/companies/${p.id}`} className="text-text hover:underline">
                        {p.name}
                      </Link>
                      <span className="font-mono text-[11px] text-muted">{p.why}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link href={`/companies/search${naics ? `?naics=${encodeURIComponent(naics)}` : ""}`} className="mt-2 inline-block font-mono text-[11px] text-cobalt hover:underline">
                Find more partners →
              </Link>
            </div>
          ) : null}
          {error ? <p className="font-mono text-[11px] text-red">{error}</p> : null}
          <div>
            <button type="button" className="aur-btn aur-btn-primary" disabled={pending} onClick={submit}>
              {pending ? "Saving…" : `Record ${DECISION_LABELS[choice]}`}
            </button>
          </div>
        </div>
      ) : null}
      {history.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-1 border-t border-layer/10 pt-3">
          {history.map((h) => (
            <li key={h.at} className="font-mono text-[11px] text-muted">
              <span className={`mr-2 inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-widest ${TONE[h.decision]}`}>{DECISION_LABELS[h.decision]}</span>
              {new Date(h.at).toLocaleString()} · {h.by ?? "someone"}
              {h.pwin !== null ? ` · PWin ${h.pwin}%` : ""}
              {h.coverage !== null ? ` · coverage ${Math.round(h.coverage * 100)}%` : ""}
              {h.category ? ` · ${NO_GO_CATEGORIES.find((c) => c.key === h.category)?.label ?? h.category}` : ""}
              {h.reason ? <span className="block pl-1 font-body text-[12px] text-text">{h.reason}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
