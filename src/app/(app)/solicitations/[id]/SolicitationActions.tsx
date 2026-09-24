"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  convertToOpportunityAction,
  deleteSolicitationAction,
  reparseSolicitationAction,
} from "../actions";

/** A parse still "running" after this long has died with its request. */
const PARSE_STUCK_AFTER_MS = 5 * 60_000;

export function SolicitationActions({
  id,
  parseStatus,
  parseUpdatedAt,
  opportunityId,
  hasStorage,
}: {
  id: string;
  parseStatus: string;
  /** ISO timestamp of the row's last update; drives stuck-parse recovery. */
  parseUpdatedAt?: string | null;
  opportunityId: string | null;
  hasStorage: boolean;
}) {
  const router = useRouter();
  // BL-AIP-2 — the parse runs fire-and-forget after the upload response;
  // on serverless hosting it can be suspended and the row stays at
  // "parsing" forever. Re-parse used to be hidden exactly then. Offer it
  // once a parse has been "running" implausibly long.
  const parseStuck =
    parseStatus === "parsing" &&
    !!parseUpdatedAt &&
    Date.now() - new Date(parseUpdatedAt).getTime() > PARSE_STUCK_AFTER_MS;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function reparse() {
    setError(null);
    startTransition(async () => {
      const res = await reparseSolicitationAction(id);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  function convert() {
    setError(null);
    startTransition(async () => {
      const res = await convertToOpportunityAction(id);
      if (!res.ok) return setError(res.error);
      router.push(`/opportunities/${res.opportunityId}`);
    });
  }

  function remove() {
    if (!window.confirm("Delete this solicitation? This cannot be undone."))
      return;
    setError(null);
    startTransition(async () => {
      const res = await deleteSolicitationAction(id);
      if (!res.ok) return setError(res.error);
      router.push("/solicitations");
    });
  }

  return (
    <>
      {hasStorage && (parseStatus !== "parsing" || parseStuck) ? (
        <button
          type="button"
          onClick={reparse}
          disabled={pending}
          className="aur-btn aur-btn-ghost"
          title={
            parseStuck
              ? "This parse has been running for over five minutes and has probably stalled. Run it again."
              : undefined
          }
        >
          {parseStuck ? "Retry parse" : "Re-parse"}
        </button>
      ) : null}
      {opportunityId ? (
        <a
          href={`/opportunities/${opportunityId}`}
          className="aur-btn aur-btn-ghost"
        >
          Open opportunity
        </a>
      ) : (
        <button
          type="button"
          onClick={convert}
          disabled={pending}
          className="aur-btn aur-btn-primary"
        >
          {pending ? "Converting…" : "Convert to opportunity"}
        </button>
      )}
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="aur-btn aur-btn-danger"
      >
        Delete
      </button>
      {error ? (
        <div className="ml-auto rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
    </>
  );
}
