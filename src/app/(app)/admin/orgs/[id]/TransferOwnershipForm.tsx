"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transferOwnershipAction } from "./actions";

type AdminOption = {
  userId: string;
  name: string | null;
  email: string;
};

export function TransferOwnershipForm({
  organizationId,
  currentPrimaryUserId,
  admins,
}: {
  organizationId: string;
  currentPrimaryUserId: string | null;
  admins: AdminOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string>(
    currentPrimaryUserId ?? "",
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!selected) {
      setError("Pick a user.");
      return;
    }
    if (selected === currentPrimaryUserId) {
      setError("That user is already the primary admin.");
      return;
    }

    const target = admins.find((a) => a.userId === selected);
    if (!target) {
      setError("Pick a valid admin.");
      return;
    }
    if (
      !window.confirm(
        `Transfer primary admin to ${target.name ?? target.email}? This action is recorded in the tenant's audit log.`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      const res = await transferOwnershipAction({
        organizationId,
        newPrimaryUserId: selected,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(
        `Primary admin is now ${target.name ?? target.email}. Refresh to see updated panel.`,
      );
      router.refresh();
    });
  }

  return (
    <form className="mt-3 flex flex-col gap-2" onSubmit={onSubmit}>
      <label className="aur-label">Change primary admin</label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="aur-input flex-1 min-w-[240px]"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={pending || admins.length === 0}
        >
          {admins.length === 0 ? (
            <option value="">No active admins available</option>
          ) : (
            <>
              {currentPrimaryUserId ? null : (
                <option value="">Select an admin…</option>
              )}
              {admins.map((a) => (
                <option key={a.userId} value={a.userId}>
                  {a.name ? `${a.name} — ${a.email}` : a.email}
                  {a.userId === currentPrimaryUserId ? " (current)" : ""}
                </option>
              ))}
            </>
          )}
        </select>
        <button
          type="submit"
          className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
          disabled={
            pending ||
            admins.length === 0 ||
            !selected ||
            selected === currentPrimaryUserId
          }
        >
          {pending ? "Transferring…" : "Transfer"}
        </button>
      </div>

      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">
          {notice}
        </div>
      ) : null}

      <p className="font-mono text-[10px] leading-relaxed text-muted/80">
        The new primary must already be an active admin of this org. To
        add someone, ask the tenant&apos;s existing admin to invite them
        with the Admin role first. Audited as{" "}
        <code>tenant.transfer_ownership</code>.
      </p>
    </form>
  );
}
