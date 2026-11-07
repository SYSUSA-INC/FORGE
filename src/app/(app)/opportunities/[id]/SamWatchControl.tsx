"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { checkSamNowAction } from "./sam-watch-actions";

/**
 * BL-SCOUT-AMEND — under the opportunity's documents: that SAM.gov is
 * watched for amendments, when it was last checked, and Check now.
 * BL-SCOUT-FILES — and, for an opportunity just added from a notice, that
 * its attachments are being downloaded (the page refreshes until they
 * are), or why they couldn't be.
 */
export type NoticeFilesFetch = { status: "queued" | "running" | "failed" | "done"; error: string } | null;

export function SamWatchControl({ opportunityId, checkedAt, fetch = null }: { opportunityId: string; checkedAt: string | null; fetch?: NoticeFilesFetch }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // A queued job with an error is waiting to retry: say why, not "downloading".
  const retrying = fetch?.status === "queued" && !!fetch.error;
  const fetching = !retrying && (fetch?.status === "queued" || fetch?.status === "running");
  useEffect(() => {
    if (!fetching) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [fetching, router]);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const when = checkedAt ? new Date(checkedAt).toLocaleString() : null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-layer/10 pt-3">
      <p className="max-w-2xl font-body text-[12px] leading-[1.5] text-muted">
        FORGE checks SAM.gov every day for amendments and new documents of this solicitation, files them here and tells the team.{" "}
        {fetching ? <span className="text-text">Downloading this notice&apos;s attachments from SAM.gov… they appear above as they arrive.</span> : when ? `Last checked ${when}.` : "Not checked yet."}
        {fetch?.status === "failed" || retrying ? (
          <span className="ml-1 text-red">
            The attachments couldn&apos;t be downloaded{fetch?.error ? `: ${fetch.error}` : ""}. {retrying ? "FORGE tries again shortly; " : ""}Check SAM.gov now tries again.
          </span>
        ) : null}
        {result ? <span className={`ml-1 ${result.ok ? "text-text" : "text-red"}`}>{result.text}</span> : null}
      </p>
      <button
        type="button"
        className="aur-btn"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await checkSamNowAction(opportunityId);
            setResult(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
            // The files it filed show above.
            if (r.ok) router.refresh();
          })
        }
      >
        {pending ? "Checking SAM.gov…" : "Check SAM.gov now"}
      </button>
    </div>
  );
}
