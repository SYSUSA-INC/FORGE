"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteActivityAction } from "../evaluation-actions";

export function DeleteActivityButton({
  opportunityId,
  activityId,
}: {
  opportunityId: string;
  activityId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (!window.confirm("Delete this activity entry?")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteActivityAction(opportunityId, activityId);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-rose"
        disabled={pending}
        onClick={onClick}
      >
        {pending ? "…" : "Delete"}
      </button>
      {error ? (
        <span className="ml-2 font-mono text-[10px] text-rose">{error}</span>
      ) : null}
    </>
  );
}
