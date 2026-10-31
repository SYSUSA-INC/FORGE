"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissNextActionAction, markNextActionDoneAction } from "@/app/(app)/opportunities/[id]/next-action-actions";

/** Done and Not now on one proposed action (BL-NEXT-ACTION 5a). */
export function NextActionButtons({ id, compact = false }: { id: string; compact?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: (input: { id: string }) => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn({ id });
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  const cls = compact ? "aur-link font-mono text-[10px] uppercase tracking-widest" : "aur-btn aur-btn-ghost";
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className={cls} disabled={pending} onClick={() => run(markNextActionDoneAction)} title="Mark this action done">
        Done
      </button>
      <button type="button" className={cls} disabled={pending} onClick={() => run(dismissNextActionAction)} title="Quiet this action for 14 days, or until the stage changes">
        Not now
      </button>
      {error ? <span className="font-body text-[12px] text-rose">{error}</span> : null}
    </span>
  );
}
