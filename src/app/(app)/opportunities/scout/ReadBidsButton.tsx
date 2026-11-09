"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { readInboundEmailAction } from "./inbox-actions";

/** BL-SCOUT-INBOX — "Read the bids" on a held, account or failed email in the Bid inbox. */
export function ReadBidsButton({ emailId, label }: { emailId: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="aur-btn"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await readInboundEmailAction(emailId);
            setNote(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
            if (r.ok) router.refresh();
          })
        }
      >
        {pending ? "Reading…" : label}
      </button>
      {note ? <span className={`font-mono text-[11px] ${note.ok ? "text-text" : "text-rose"}`}>{note.text}</span> : null}
    </span>
  );
}
