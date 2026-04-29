"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  convertToOpportunityAction,
  deleteSolicitationAction,
  reparseSolicitationAction,
} from "../actions";

export function SolicitationActions({
  id,
  parseStatus,
  opportunityId,
  hasStorage,
}: {
  id: string;
  parseStatus: string;
  opportunityId: string | null;
  hasStorage: boolean;
}) {
  const router = useRouter();
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
      {hasStorage && parseStatus !== "parsing" ? (
        <button
          type="button"
          onClick={reparse}
          disabled={pending}
          className="aur-btn aur-btn-ghost"
        >
          Re-parse
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
