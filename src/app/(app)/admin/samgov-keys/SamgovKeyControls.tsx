"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminRemoveCompanySamKeyAction, reencryptCompanySamKeysAction } from "./actions";

/** BL-STAB-7e — re-encrypt every company key under the keyring's first entry. */
export function ReencryptButton({ pending, disabled }: { pending: number; disabled: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="aur-btn aur-btn-primary text-[11px] disabled:opacity-50"
        disabled={busy || disabled}
        onClick={() =>
          start(async () => {
            setNote(null);
            try {
              const r = await reencryptCompanySamKeysAction();
              setNote(
                r.ok
                  ? { ok: r.failed === 0, text: `Re-encrypted ${r.moved}; ${r.alreadyCurrent} already current${r.unreadable ? `; ${r.unreadable} not readable here (their keyring entry is missing)` : ""}${r.failed ? `; ${r.failed} failed (see /admin/errors)` : ""}.` }
                  : { ok: false, text: r.error },
              );
            } catch {
              setNote({ ok: false, text: "FORGE didn't answer. Try again in a minute." });
            }
            router.refresh();
          })
        }
      >
        {busy ? "Re-encrypting…" : `Re-encrypt${pending > 0 ? ` ${pending}` : ""}`}
      </button>
      {note ? <span className={`font-mono text-[11px] ${note.ok ? "text-emerald" : "text-rose"}`}>{note.text}</span> : null}
    </div>
  );
}

/** BL-STAB-7e — remove one company's key, with the reason its admins will see. */
export function RemoveKeyButton({ organizationId, organizationName, last4 }: { organizationId: string; organizationName: string; last4: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  if (!open) {
    return (
      <button type="button" className="font-mono text-[10px] text-rose underline" onClick={() => setOpen(true)}>
        Remove
      </button>
    );
  }
  return (
    <form
      className="flex flex-col items-end gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          try {
            const r = await adminRemoveCompanySamKeyAction({ organizationId, reason });
            if (!r.ok) return setError(r.error);
            setOpen(false);
            router.refresh();
          } catch {
            setError("FORGE didn't answer. Try again in a minute.");
          }
        });
      }}
    >
      <label className="font-body text-[11px] text-muted" htmlFor={`reason-${organizationId}`}>
        Remove {organizationName}&apos;s key ••••{last4}? It falls back to FORGE&apos;s shared key. Reason (the company sees it):
      </label>
      <input id={`reason-${organizationId}`} className="aur-input w-64 text-[11px]" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} disabled={busy} />
      <span className="flex gap-2">
        <button type="button" className="font-mono text-[10px] text-muted underline" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="aur-btn aur-btn-ghost text-[10px] text-rose disabled:opacity-50" disabled={busy || reason.trim().length < 3}>
          {busy ? "Removing…" : "Remove key"}
        </button>
      </span>
      {error ? <span className="font-mono text-[10px] text-rose">{error}</span> : null}
    </form>
  );
}
