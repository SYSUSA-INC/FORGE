"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteCompanyAction,
  refreshCompanyFromSamGovAction,
} from "../actions";

export function CompanyDetailActions({
  id,
  name,
  hasUei,
}: {
  id: string;
  name: string;
  hasUei: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function sync() {
    setError(null);
    startTransition(async () => {
      const res = await refreshCompanyFromSamGovAction(id);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteCompanyAction(id);
      if (!res.ok) return setError(res.error);
      router.push("/companies");
    });
  }

  return (
    <>
      {hasUei ? (
        <button
          type="button"
          className="aur-btn aur-btn-ghost"
          disabled={pending}
          onClick={sync}
        >
          {pending ? "Syncing…" : "Sync from SAM.gov"}
        </button>
      ) : null}
      <button
        type="button"
        className="aur-btn aur-btn-danger"
        disabled={pending}
        onClick={remove}
      >
        Delete
      </button>
      {error ? (
        <span className="ml-2 font-mono text-[11px] text-rose">{error}</span>
      ) : null}
    </>
  );
}
