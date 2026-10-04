"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import type { ApiTokenListRow } from "@/lib/api-tokens";
import { DEFAULT_TOKEN_EXPIRY_DAYS, TOKEN_EXPIRY_DAYS, TOKEN_NAME_MAX } from "@/lib/api-tokens-logic";
import { createApiTokenAction, revokeApiTokenAction } from "./actions";

const LIFETIME_LABEL: Record<(typeof TOKEN_EXPIRY_DAYS)[number], string> = {
  30: "30 days",
  90: "90 days",
  365: "1 year",
  0: "Never expires",
};

const STATE_CLASS = {
  active: "border-emerald/40 bg-emerald/10 text-emerald",
  expired: "border-gold/40 bg-gold/10 text-gold",
  revoked: "border-rose/40 bg-rose/10 text-rose",
} as const;

const day = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

/**
 * BL-16 apiAccess — create a token (shown once, with a copy button),
 * see every token's prefix, creator, last use and expiry, and revoke.
 */
export function ApiTokensClient({ tokens, canCreate }: { tokens: ApiTokenListRow[]; canCreate: boolean }) {
  const [name, setName] = useState("");
  const [days, setDays] = useState<number>(DEFAULT_TOKEN_EXPIRY_DAYS);
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create() {
    setError(null);
    startTransition(async () => {
      const res = await createApiTokenAction({ name, expiresInDays: days });
      if (!res.ok) return setError(res.error);
      setFresh({ name: name.trim(), token: res.token });
      setCopied(false);
      setName("");
    });
  }

  function revoke(t: ApiTokenListRow) {
    if (!window.confirm(`Revoke "${t.name}" (${t.tokenPrefix}…)? Anything using it stops working at once.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await revokeApiTokenAction(t.id);
      if (!res.ok) setError(res.error);
    });
  }

  async function copy() {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.token);
      setCopied(true);
    } catch {
      setError("Copy failed — select the token and copy it by hand.");
    }
  }

  return (
    <Panel title="Tokens" eyebrow="Workspace API tokens">
      {canCreate ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px_auto]">
          <div>
            <label className="aur-label" htmlFor="api-token-name">Name</label>
            <input
              id="api-token-name"
              className="aur-input"
              value={name}
              maxLength={TOKEN_NAME_MAX}
              placeholder="e.g. Salesforce sync"
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
            />
          </div>
          <div>
            <label className="aur-label" htmlFor="api-token-days">Lifetime</label>
            <select id="api-token-days" className="aur-input" value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={pending}>
              {TOKEN_EXPIRY_DAYS.map((d) => (
                <option key={d} value={d}>
                  {LIFETIME_LABEL[d]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button type="button" className="aur-btn aur-btn-primary" onClick={create} disabled={pending || name.trim().length < 2}>
              {pending ? "Working…" : "Create token"}
            </button>
          </div>
        </div>
      ) : null}

      {fresh ? (
        <div className="mt-3 rounded-md border border-emerald/40 bg-emerald/10 px-3 py-3">
          <div className="font-mono text-[11px] text-emerald">
            &quot;{fresh.name}&quot; created. Copy it now — FORGE stores only a fingerprint and can&apos;t show it again.
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-layer/[0.05] px-2 py-1 font-mono text-[12px] text-text">{fresh.token}</code>
            <button type="button" className="aur-btn aur-btn-ghost" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className="aur-btn aur-btn-ghost" onClick={() => setFresh(null)}>
              Done
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="mt-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div> : null}

      {tokens.length === 0 ? (
        <p className="mt-4 font-body text-[13px] text-muted">No tokens yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left font-body text-[13px]">
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-wider text-muted">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Token</th>
                <th className="py-2 pr-3">Created by</th>
                <th className="py-2 pr-3">Created</th>
                <th className="py-2 pr-3">Last used</th>
                <th className="py-2 pr-3">Expires</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} className="border-t border-layer/10">
                  <td className="py-2 pr-3 text-text">{t.name}</td>
                  <td className="py-2 pr-3 font-mono text-[12px] text-muted">{t.tokenPrefix}…</td>
                  <td className="py-2 pr-3 text-muted">{t.createdBy}</td>
                  <td className="py-2 pr-3 font-mono text-[12px] text-muted">{day(t.createdAt)}</td>
                  <td className="py-2 pr-3 font-mono text-[12px] text-muted">{t.lastUsedAt ? day(t.lastUsedAt) : "Never"}</td>
                  <td className="py-2 pr-3 font-mono text-[12px] text-muted">{t.expiresAt ? day(t.expiresAt) : "Never"}</td>
                  <td className="py-2 pr-3">
                    <span className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase ${STATE_CLASS[t.state]}`}>{t.state}</span>
                    {t.revokedBy ? <span className="ml-1 font-mono text-[11px] text-muted">by {t.revokedBy}</span> : null}
                  </td>
                  <td className="py-2 text-right">
                    {t.state === "active" ? (
                      <button type="button" className="aur-btn aur-btn-ghost text-rose" onClick={() => revoke(t)} disabled={pending}>
                        Revoke
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
