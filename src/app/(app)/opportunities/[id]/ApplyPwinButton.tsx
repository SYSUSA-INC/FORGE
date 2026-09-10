"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyPwinEstimateAction } from "./pwin-actions";

/**
 * BL-FB-X-PWIN-MODEL — apply the model estimate to the opportunity's
 * PWin field. Disabled when the record already matches.
 */
export function ApplyPwinButton({
  opportunityId,
  modelPwin,
  manualPwin,
}: {
  opportunityId: string;
  modelPwin: number;
  manualPwin: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const same = modelPwin === manualPwin;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending || same}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await applyPwinEstimateAction(opportunityId);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            router.refresh();
          });
        }}
        className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60"
      >
        {pending ? "Applying…" : same ? "Record matches model" : `Set PWin to ${modelPwin}%`}
      </button>
      {error ? (
        <span className="font-mono text-[10px] text-rose">{error}</span>
      ) : null}
    </div>
  );
}
