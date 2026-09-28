"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runJobsNowAction } from "./actions";

/** BL-AIP-4c — drain the job queue on demand (one cron tick). */
export function RunJobsNowButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string>("");

  return (
    <span className="inline-flex items-center gap-2">
      {note ? <span className="font-mono text-[10px] text-muted">{note}</span> : null}
      <button
        type="button"
        className="aur-btn aur-btn-ghost text-[11px]"
        disabled={pending}
        title="Recover stuck rows and run due jobs now, as the cron would"
        onClick={() =>
          startTransition(async () => {
            const res = await runJobsNowAction();
            if (!res.ok) {
              setNote(res.error);
              return;
            }
            const s = res.summary;
            setNote(
              `recovered ${s.recovered} · ran ${s.ran} (ok ${s.succeeded}, retry ${s.retried}, failed ${s.failed})` +
                (s.deferred ? ` · ${s.deferred} left` : ""),
            );
            router.refresh();
          })
        }
      >
        {pending ? "Running…" : "Run due jobs now"}
      </button>
    </span>
  );
}
