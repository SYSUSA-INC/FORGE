"use client";

import { useState, useTransition } from "react";
import type { ApiTokenListRow } from "@/lib/api-tokens";
import { REVOKE_REASON_MAX } from "@/lib/api-tokens-logic";
import { adminRevokeAllApiTokensAction, adminRevokeApiTokenAction } from "./api-token-actions";

const STATE_CLASS = {
  active: "border-emerald/40 bg-emerald/10 text-emerald",
  expired: "border-gold/40 bg-gold/10 text-gold",
  revoked: "border-rose/40 bg-rose/10 text-rose",
} as const;

const day = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

/**
 * BL-16 API Slice 2a — platform admin's view of one tenant's tokens. A
 * revoke needs a reason, which goes into the tenant's audit log.
 */
export function TenantApiTokensPanel({ organizationId, tokens }: { organizationId: string; tokens: ApiTokenListRow[] }) {
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const active = tokens.filter((t) => t.state === "active");

  function revoke(t: ApiTokenListRow) {
    if (!window.confirm(`Revoke "${t.name}" (${t.tokenPrefix}…) for this tenant? Anything using it stops working at once.`)) return;
    setMessage(null);
    startTransition(async () => {
      const res = await adminRevokeApiTokenAction({ organizationId, tokenId: t.id, reason });
      setMessage(res.ok ? { ok: true, text: `Revoked "${t.name}".` } : { ok: false, text: res.error });
    });
  }

  function revokeAll() {
    if (!window.confirm(`Revoke all ${active.length} active tokens for this tenant? Every integration using them stops at once.`)) return;
    setMessage(null);
    startTransition(async () => {
      const res = await adminRevokeAllApiTokensAction({ organizationId, reason });
      setMessage(res.ok ? { ok: true, text: `Revoked ${res.revoked} token${res.revoked === 1 ? "" : "s"}.` } : { ok: false, text: res.error });
    });
  }

  if (tokens.length === 0) return <p className="font-mono text-[11px] text-muted">This tenant has no API tokens.</p>;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono text-[11px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted">
              <th className="py-1.5 pr-2">Name</th>
              <th className="py-1.5 pr-2">Token</th>
              <th className="py-1.5 pr-2">Created by</th>
              <th className="py-1.5 pr-2">Last used</th>
              <th className="py-1.5 pr-2">Expires</th>
              <th className="py-1.5 pr-2">Status</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id} className="border-t border-layer/10">
                <td className="py-1.5 pr-2 text-text">{t.name}</td>
                <td className="py-1.5 pr-2 text-muted">{t.tokenPrefix}…</td>
                <td className="py-1.5 pr-2 text-muted">
                  {t.createdBy} · {day(t.createdAt)}
                </td>
                <td className="py-1.5 pr-2 text-muted">{t.lastUsedAt ? day(t.lastUsedAt) : "Never"}</td>
                <td className="py-1.5 pr-2 text-muted">{t.expiresAt ? day(t.expiresAt) : "Never"}</td>
                <td className="py-1.5 pr-2">
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${STATE_CLASS[t.state]}`}>{t.state}</span>
                  {t.revokedBy ? <span className="ml-1 text-muted">by {t.revokedBy}</span> : null}
                </td>
                <td className="py-1.5 text-right">
                  {t.state === "active" ? (
                    <button type="button" className="aur-btn aur-btn-ghost text-[11px] text-rose" onClick={() => revoke(t)} disabled={pending}>
                      Revoke
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {active.length > 0 ? (
        <div className="mt-3 border-t border-layer/10 pt-3">
          <label className="aur-label" htmlFor="api-revoke-reason">
            Reason (shown in the tenant&apos;s audit log)
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="api-revoke-reason"
              className="aur-input min-w-0 flex-1"
              value={reason}
              maxLength={REVOKE_REASON_MAX}
              placeholder="e.g. Token reported leaked in a support ticket"
              onChange={(e) => setReason(e.target.value)}
              disabled={pending}
            />
            <button type="button" className="aur-btn aur-btn-ghost text-[11px] text-rose" onClick={revokeAll} disabled={pending || reason.trim().length < 3}>
              Revoke all active
            </button>
          </div>
          <p className="mt-1 font-mono text-[10px] text-muted">Fill in the reason first; it applies to a single revoke too.</p>
        </div>
      ) : null}

      {message ? (
        <div
          className={`mt-3 rounded-md border px-3 py-2 font-mono text-[11px] ${message.ok ? "border-emerald/40 bg-emerald/10 text-emerald" : "border-rose/40 bg-rose/10 text-rose"}`}
        >
          {message.text}
        </div>
      ) : null}
    </div>
  );
}
