"use client";

import { useState, useTransition } from "react";
import { checkSamNowAction } from "./sam-watch-actions";

/**
 * BL-SCOUT-AMEND — under the opportunity's documents: that SAM.gov is
 * watched for amendments, when it was last checked, and Check now.
 */
export function SamWatchControl({ opportunityId, checkedAt }: { opportunityId: string; checkedAt: string | null }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const when = checkedAt ? new Date(checkedAt).toLocaleString() : null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-layer/10 pt-3">
      <p className="max-w-2xl font-body text-[12px] leading-[1.5] text-muted">
        FORGE checks SAM.gov every day for amendments and new documents of this solicitation, files them here and tells the team.{" "}
        {when ? `Last checked ${when}.` : "Not checked yet."}
        {result ? <span className={`ml-1 ${result.ok ? "text-text" : "text-rose"}`}>{result.text}</span> : null}
      </p>
      <button
        type="button"
        className="aur-btn"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await checkSamNowAction(opportunityId);
            setResult(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
          })
        }
      >
        {pending ? "Checking SAM.gov…" : "Check SAM.gov now"}
      </button>
    </div>
  );
}
