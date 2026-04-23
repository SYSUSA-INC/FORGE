"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteProposalAction } from "../actions";

export function DeleteProposalButton({
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
    if (
      !window.confirm(
        `Delete proposal "${title}"? This deletes all sections and cannot be undone.`,
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const res = await deleteProposalAction(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/proposals");
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
