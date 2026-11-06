"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { createInboundAddressAction } from "./inbound-actions";

/**
 * BL-SCOUT-INBOX — the company's bid email address: register it on each
 * portal as the email that receives bid notifications, and the portals
 * mail FORGE directly, with no one forwarding anything.
 */
export function BidEmailPanel({ address, configured, canEdit }: { address: string | null; configured: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function create() {
    setError(null);
    start(async () => {
      const res = await createInboundAddressAction();
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <Panel title="Bid email address" eyebrow="Portals mail FORGE directly">
      <p className="mb-3 max-w-3xl font-body text-[13px] leading-[1.5] text-muted">
        Register this address on each state portal, prime contractor&apos;s supplier portal and bid service as the email that receives your bid notifications. The portals send their alerts straight to FORGE: no one forwards anything. Every email lands in the Bid inbox on the Scout page; bid alerts are read into Scout finds, and portal account emails (registration, verification, password) wait there for an admin.
      </p>
      {!configured ? (
        <p className="font-body text-[13px] text-muted">Receiving email isn&apos;t set up on this FORGE yet. A FORGE platform admin turns it on (ADMIN_MANUAL §3.7).</p>
      ) : address ? (
        <div className="flex flex-wrap items-center gap-3">
          <code className="rounded border border-layer/10 bg-layer/[0.03] px-2 py-1 font-mono text-[13px] text-text">{address}</code>
          <button
            type="button"
            className="aur-btn text-[11px]"
            onClick={() => {
              void navigator.clipboard?.writeText(address).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : canEdit ? (
        <button type="button" className="aur-btn aur-btn-primary text-[12px]" disabled={pending} onClick={create}>
          {pending ? "Creating…" : "Create your bid email address"}
        </button>
      ) : (
        <p className="font-body text-[13px] text-muted">No address yet. An org admin creates it here.</p>
      )}
      {error ? <p className="mt-2 font-mono text-[11px] text-rose">{error}</p> : null}
    </Panel>
  );
}
