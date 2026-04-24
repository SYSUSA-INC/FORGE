"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OpportunityActivityKind } from "@/db/schema";
import { MANUAL_ACTIVITY_KINDS } from "@/lib/evaluation-types";
import { addActivityAction } from "../evaluation-actions";

export function AddActivityForm({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<OpportunityActivityKind>("note");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await addActivityAction({
        opportunityId,
        kind,
        title,
        body,
      });
      if (!res.ok) return setError(res.error);
      setTitle("");
      setBody("");
      router.refresh();
    });
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={onSubmit}>
      <div>
        <label className="aur-label">Type</label>
        <select
          className="aur-input"
          value={kind}
          onChange={(e) => setKind(e.target.value as OpportunityActivityKind)}
        >
          {MANUAL_ACTIVITY_KINDS.map((k) => (
            <option key={k} value={k}>
              {k[0]!.toUpperCase() + k.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="aur-label">Title</label>
        <input
          className="aur-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={
            kind === "meeting"
              ? "Customer meeting with PMO"
              : kind === "action"
                ? "Submit capability statement"
                : "Summary"
          }
        />
      </div>
      <div>
        <label className="aur-label">Details</label>
        <textarea
          className="aur-input min-h-[100px] resize-y"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What happened, who was there, what's next…"
        />
      </div>
      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending || (!title.trim() && !body.trim())}
        className="aur-btn aur-btn-primary py-2.5 text-sm disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add to timeline"}
      </button>
    </form>
  );
}
