"use client";

/**
 * BL-AUTH-DOMAIN — superadmin editor for a tenant's email domains.
 *
 * Owned domains: people from these join by plain invitation. Approved
 * external domains: a platform admin has allowed this tenant to bring
 * in people from these (e.g. a teaming partner) without per-invite
 * approval. Anyone else is held for approval on the platform portal.
 * Only a superadmin can edit either list.
 */

import { useState, useTransition } from "react";
import { setTenantDomainsAction } from "./actions";

type Props = {
  organizationId: string;
  initialEmailDomains: string[];
  initialApprovedExternalDomains: string[];
};

export function TenantDomainsEditor({
  organizationId,
  initialEmailDomains,
  initialApprovedExternalDomains,
}: Props) {
  const [owned, setOwned] = useState(initialEmailDomains.join("\n"));
  const [external, setExternal] = useState(initialApprovedExternalDomains.join("\n"));
  const [saved, setSaved] = useState<{ owned: string[]; external: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const res = await setTenantDomainsAction({
        organizationId,
        emailDomains: owned,
        approvedExternalDomains: external,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOwned(res.emailDomains.join("\n"));
      setExternal(res.approvedExternalDomains.join("\n"));
      setSaved({ owned: res.emailDomains, external: res.approvedExternalDomains });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[10px] leading-relaxed text-subtle">
        By default a person may only join the tenant that owns their email
        domain. Invitations from any other domain are held until a platform
        admin approves them. Public mailbox providers (gmail.com, outlook.com…)
        are never accepted here; approve those people one invitation at a time.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="aur-label">Owned domains</label>
          <textarea
            className="aur-input min-h-[88px] font-mono text-[11px]"
            value={owned}
            onChange={(e) => setOwned(e.target.value)}
            placeholder={"acme.com\nacme-federal.com"}
            spellCheck={false}
          />
          <div className="mt-1 font-mono text-[10px] text-muted">
            One per line (commas work too). Backfilled from the tenant&apos;s
            active admins.
          </div>
        </div>
        <div>
          <label className="aur-label">Approved external domains</label>
          <textarea
            className="aur-input min-h-[88px] font-mono text-[11px]"
            value={external}
            onChange={(e) => setExternal(e.target.value)}
            placeholder={"partner.com"}
            spellCheck={false}
          />
          <div className="mt-1 font-mono text-[10px] text-muted">
            Domains this tenant may invite from without a per-invite approval.
            &ldquo;Approve + allow domain&rdquo; on the portal adds to this list.
          </div>
        </div>
      </div>
      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {saved ? (
        <div className="rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">
          Saved. Owned: {saved.owned.length > 0 ? saved.owned.join(", ") : "none"} · approved
          external: {saved.external.length > 0 ? saved.external.join(", ") : "none"}.
        </div>
      ) : null}
      <div>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save domains"}
        </button>
      </div>
    </div>
  );
}
