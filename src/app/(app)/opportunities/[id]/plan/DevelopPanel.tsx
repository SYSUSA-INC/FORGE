"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import type { DevelopView } from "@/lib/plan-freeze-store";
import { freezePlanAction, moveToDevelopAction, unfreezePlanAction } from "./develop-actions";

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/** BL-NAV-LIFECYCLE 4c-2 (P-7, P-8) — the freeze, and Move to Develop with what still stands in its way. */
export function DevelopPanel({ opportunityId, view }: { opportunityId: string; view: DevelopView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const frozen = view.frozen.matrix && view.frozen.outline;
  const inPlan = view.stage === "capture";

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <Panel title="Freeze and Move to Develop" eyebrow={inPlan ? (view.blockers.length === 0 ? "Ready" : `${view.blockers.length} to do`) : "Moved to Develop"}>
      {error ? <p className="mb-2 font-body text-[12px] text-red">{error}</p> : null}
      <p className="mb-3 font-body text-[13px] leading-[1.5] text-muted">
        Freezing stamps the compliance matrix and the outline. Both stay editable in Develop, but each change after the freeze is written to this opportunity&apos;s timeline so the Red team sees what moved.
      </p>
      <div className="flex flex-wrap items-center gap-3 border-t border-layer/10 pt-3">
        <span className="font-mono text-[11px] text-muted">
          {frozen ? `Matrix frozen ${day(view.matrixFrozenAt)} · outline frozen ${day(view.outlineFrozenAt)}` : "Not frozen"}
        </span>
        {frozen ? (
          <button type="button" className="aur-link font-mono text-[10px] uppercase tracking-widest" disabled={pending} onClick={() => run(() => unfreezePlanAction({ opportunityId }))}>
            Unfreeze
          </button>
        ) : (
          <button type="button" className="aur-btn" disabled={pending || !inPlan} onClick={() => run(() => freezePlanAction({ opportunityId }))}>
            {pending ? "Freezing…" : "Freeze matrix and outline"}
          </button>
        )}
      </div>
      {inPlan ? (
        <div className="mt-3 border-t border-layer/10 pt-3">
          {view.blockers.length > 0 ? (
            <ul className="mb-3 flex flex-col gap-1">
              {view.blockers.map((b) => (
                <li key={b} className="font-body text-[13px] text-muted">
                  {b}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 font-body text-[13px] text-muted">Everything Develop needs from the plan is in place.</p>
          )}
          <button type="button" className="aur-btn aur-btn-primary" disabled={pending || view.blockers.length > 0} onClick={() => run(() => moveToDevelopAction({ opportunityId }))}>
            {pending ? "Moving…" : "Move to Develop"}
          </button>
        </div>
      ) : null}
    </Panel>
  );
}
