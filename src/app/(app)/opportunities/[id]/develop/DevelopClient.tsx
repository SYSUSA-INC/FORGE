"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { startReviewAction } from "@/app/(app)/proposals/[id]/reviews/actions";
import { DEVELOP_NEXT_STEP_LABELS } from "@/lib/develop-logic";
import type { DevelopView } from "@/lib/develop-store";
import { createDraftAction } from "./actions";

export function DevelopClient({ view }: { view: DevelopView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const proposal = view.proposal;
  const r = view.readiness;

  function create() {
    setError(null);
    start(async () => {
      const res = await createDraftAction({ opportunityId: view.opportunityId });
      if (!res.ok) return setError(res.error);
      if (res.note) setNote(res.note);
      router.refresh();
    });
  }

  function startPink() {
    if (!proposal) return;
    setError(null);
    start(async () => {
      const res = await startReviewAction({ proposalId: proposal.id, color: "pink", reviewerUserIds: [] });
      if (!res.ok) return setError(res.error);
      router.push(`/proposals/${proposal.id}/reviews`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <p role="alert" className="font-body text-[13px] text-red">{error}</p> : null}
      {note ? <p className="font-body text-[13px] text-muted">{note}</p> : null}
      {!proposal ? (
        <Panel title="Create a Draft" eyebrow="Develop">
          <p className="font-body text-[13px] leading-[1.5] text-muted">
            One click makes the proposal from the plan: the proposal manager, capture manager and pricing lead from the team, the outline from the solicitation&apos;s Section L, and the win themes from the signed charter.
          </p>
          {view.plan ? (
            <ul className="mt-3 flex flex-col gap-1 font-mono text-[11px] text-muted">
              <li>Proposal manager: {view.plan.leads.proposalManagerUserId ? "from the team" : "you (none named in the plan)"}</li>
              <li>Capture manager: {view.plan.leads.captureManagerUserId ? "from the team" : "not named"}</li>
              <li>Pricing lead: {view.plan.leads.pricingLeadUserId ? "from the team" : "not named"}</li>
              <li>Win themes: {view.plan.signed ? `${view.plan.winThemes} from the signed charter` : "none until the charter is signed"}</li>
            </ul>
          ) : null}
          <button type="button" className="aur-btn aur-btn-primary mt-4" disabled={pending} onClick={create}>
            {pending ? "Creating…" : DEVELOP_NEXT_STEP_LABELS.create_draft}
          </button>
        </Panel>
      ) : (
        <>
          <Panel title={proposal.title} eyebrow="The draft">
            <Link href={`/proposals/${proposal.id}`} className="aur-btn aur-btn-primary">Open the proposal</Link>
          </Panel>
          <Panel title="Ready for Pink" eyebrow={r.ready ? "Ready" : "Not yet"}>
            <p className="font-mono text-[11px] text-muted">
              {r.sectionsDrafted} of {r.sectionsTotal} sections drafted · {r.requirementsMapped} of {r.requirementsTotal} requirements mapped
            </p>
            {r.missing.length > 0 ? (
              <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 font-body text-[13px] text-text">
                {r.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 font-body text-[13px] text-green">Every section is drafted and every requirement is mapped.</p>
            )}
            <p className="mt-3 font-body text-[13px] text-muted">This advises; it never blocks. A round can start at any time.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={`aur-btn ${r.ready ? "aur-btn-primary" : "aur-btn-ghost"}`} disabled={pending} onClick={startPink}>
                {DEVELOP_NEXT_STEP_LABELS.start_pink}
              </button>
              <Link href={`/proposals/${proposal.id}/reviews`} className="aur-btn aur-btn-ghost">Reviews</Link>
              <Link href={`/proposals/${proposal.id}/compliance`} className="aur-btn aur-btn-ghost">Compliance</Link>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
