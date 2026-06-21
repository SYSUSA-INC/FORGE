"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startImpersonationAction } from "./impersonation-actions";

/**
 * BL-15 Phase B-3b — start-impersonation form.
 *
 * Inline form rather than a modal: a single textarea for the
 * justification and a confirm button. The reason is required (server-
 * side validation enforces a minimum length too). After a successful
 * start the page refreshes; the new banner on the layout makes the
 * active session visible everywhere.
 */
export function StartImpersonationForm({
  organizationId,
  organizationName,
  disabled,
}: {
  organizationId: string;
  organizationName: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await startImpersonationAction({
        organizationId,
        reason,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Refresh so the layout banner picks up the new session, then
      // route to "/" to start browsing as the tenant.
      router.refresh();
      router.push("/");
    });
  }

  if (disabled) {
    return (
      <p className="font-mono text-[11px] text-muted">
        Cannot impersonate a disabled organization.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="aur-btn aur-btn-ghost text-[11px] text-amber-300 hover:text-amber-200"
        title={`Browse the app as ${organizationName} (read-only)`}
      >
        🪪 Assume identity
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-400/30 bg-amber-400/[0.04] p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300">
        Assume identity of {organizationName}
      </div>
      <p className="font-mono text-[11px] text-muted">
        You&rsquo;ll browse the app read-only as this tenant. Every mutation is
        blocked; ending the session is a single click in the banner. The
        session expires in 1 hour. Reason is permanent in this tenant&rsquo;s
        audit log.
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        autoFocus
        placeholder="e.g. SUP-1284 — investigating user report that section save returns 500"
        className="aur-input text-[11px]"
        disabled={pending}
      />
      {error ? (
        <div className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1 font-mono text-[11px] text-rose-300">
          {error}
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setReason("");
            setError(null);
          }}
          disabled={pending}
          className="aur-btn aur-btn-ghost text-[10px]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || reason.trim().length < 8}
          className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
          style={{ background: "linear-gradient(180deg,#FBBF24,#B45309)" }}
        >
          {pending ? "Starting…" : "Start session"}
        </button>
      </div>
    </div>
  );
}
