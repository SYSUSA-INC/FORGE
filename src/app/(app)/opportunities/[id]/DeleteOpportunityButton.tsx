"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteOpportunityAction } from "../actions";

export function DeleteOpportunityButton({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteOpportunityAction(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/opportunities");
    });
  }

  return (
    <>
      <button
        type="button"
        className="aur-btn aur-btn-danger"
        disabled={pending}
        onClick={onClick}
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
      {error ? (
        <span className="ml-2 font-mono text-[11px] text-rose">{error}</span>
      ) : null}
    </>
  );
}
