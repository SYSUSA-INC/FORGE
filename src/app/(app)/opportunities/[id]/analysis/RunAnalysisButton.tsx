"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { runAnalysisAction } from "./actions";

/** BL-NAV-LIFECYCLE 2c — runs Analyze; the page shows the new report. */
export function RunAnalysisButton({ opportunityId, again }: { opportunityId: string; again: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="aur-btn aur-btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await runAnalysisAction({ opportunityId });
            if (!res.ok) return setError(res.error);
            router.refresh();
          })
        }
      >
        {pending ? "Analyzing… (up to a minute)" : again ? "Run the analysis again" : "Run the analysis"}
      </button>
      {error ? <p className="max-w-sm text-right font-body text-[12px] text-red">{error}</p> : null}
    </div>
  );
}
