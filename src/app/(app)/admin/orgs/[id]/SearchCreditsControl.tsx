"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adjustSearchCreditsAction } from "./actions";

/**
 * BL-NAV-LIFECYCLE 5b-2a — a tenant's prepaid web-search pack balance on
 * /admin/orgs/[id], with a correction: add searches, or remove some (never
 * below zero). A note is required and the change is audited.
 */
export function SearchCreditsControl({ organizationId, balance }: { organizationId: string; balance: number }) {
  const router = useRouter();
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function apply() {
    setError(null);
    const n = Math.trunc(Number(delta));
    if (!Number.isFinite(n) || n === 0) return setError("Enter a number of searches: positive to add, negative to remove.");
    if (!note.trim()) return setError("Say why in the note.");
    if (!window.confirm(n > 0 ? `Add ${n} pack search(es) to this workspace?` : `Remove ${-n} pack search(es) from this workspace?`)) return;
    startTransition(async () => {
      const res = await adjustSearchCreditsAction({ organizationId, delta: n, note });
      if (!res.ok) return setError(res.error);
      setDelta("");
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-layer/10 py-3">
      <div className="aur-label">Web search pack</div>
      <div className="font-mono text-[11px] text-text">
        {balance.toLocaleString("en-US")} pack search{balance === 1 ? "" : "es"} held. Used only after the plan&apos;s monthly searches; no expiry.
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="aur-input w-28"
          type="number"
          step={1}
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          disabled={pending}
          placeholder="+500 or -50"
          aria-label="Searches to add or remove"
        />
        <input
          className="aur-input min-w-[14rem] flex-1"
          type="text"
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={pending}
          placeholder="Why (required)"
          aria-label="Note"
        />
        <button type="button" className="aur-btn aur-btn-ghost" disabled={pending} onClick={apply}>
          {pending ? "Saving…" : "Apply correction"}
        </button>
      </div>
      {error ? <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div> : null}
      <p className="font-body text-[13px] leading-[1.5] text-muted">
        Audited as <code>admin.search_credit.adjust</code> in the tenant&apos;s log, with a ledger entry. A removal larger than the balance is refused.
      </p>
    </div>
  );
}
