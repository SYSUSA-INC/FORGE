"use client";

/**
 * BL-ITAR-TAG — superadmin toggle for `organization.itar_restricted`.
 *
 * When true, future invites in this tenant require an admin-attested
 * "this user is a US person" checkbox. Existing memberships are
 * grandfathered.
 */

import { useState, useTransition } from "react";
import { setItarRestrictedAction } from "./actions";

type Props = {
  organizationId: string;
  initialValue: boolean;
};

export function ItarRestrictedToggle({ organizationId, initialValue }: Props) {
  const [current, setCurrent] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !current;
    const verb = next ? "turn ON" : "turn OFF";
    const confirmed = window.confirm(
      `${verb.toUpperCase()} ITAR restriction for this tenant? ` +
        (next
          ? "New invites will require an admin attestation that the invitee is a US person."
          : "New invites will no longer require US-person attestation. Existing attestations remain on file."),
    );
    if (!confirmed) return;
    setError(null);
    startTransition(async () => {
      const res = await setItarRestrictedAction({
        organizationId,
        itarRestricted: next,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCurrent(next);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
            ITAR restriction
          </span>
          <p className="font-mono text-[10px] text-subtle">
            When on, every new invite requires an admin-attested US-person check.
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-40"
          aria-pressed={current}
        >
          {pending
            ? "Saving…"
            : current
              ? "ITAR: ON — click to disable"
              : "ITAR: off — click to enable"}
        </button>
      </div>
      {current && (
        <span
          className="self-start rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider"
          style={{
            background: "rgba(248, 113, 113, 0.10)",
            border: "1px solid rgba(248, 113, 113, 0.35)",
            color: "#F87171",
          }}
        >
          ITAR-restricted
        </span>
      )}
      {error && (
        <p className="font-mono text-[10px] text-rose">{error}</p>
      )}
    </div>
  );
}
