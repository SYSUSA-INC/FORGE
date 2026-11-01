"use client";

import { FormEvent, useState } from "react";
import { safeRedirectTarget } from "@/lib/safe-redirect";
import { verifyMfaCodeAction } from "./actions";

/** BL-STAB-8a-2 — the code box of the second step. */
export function VerifyForm({ callbackUrl }: { callbackUrl?: string }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await verifyMfaCodeAction({ code });
    if (!res.ok) {
      setError(res.error);
      setLocked(!!res.locked);
      setLoading(false);
      return;
    }
    const target = safeRedirectTarget(callbackUrl);
    if (res.recoveryCodesLeft !== null && res.recoveryCodesLeft <= 2) {
      window.location.href = `/settings/security?low=1&callbackUrl=${encodeURIComponent(target)}`;
      return;
    }
    window.location.href = target;
  }

  return (
    <form className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}>
      <div>
        <label className="aur-label">Code</label>
        <input
          className="aur-input font-mono"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123 456 or a recovery code"
          disabled={locked}
        />
      </div>
      {error ? <p className="font-body text-[12px] text-rose">{error}</p> : null}
      <button type="submit" className="aur-btn aur-btn-primary" disabled={loading || locked || code.trim().length < 6}>
        {loading ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
