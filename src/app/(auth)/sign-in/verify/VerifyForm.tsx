"use client";

import { FormEvent, useEffect, useState } from "react";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/types";
import { safeRedirectTarget } from "@/lib/safe-redirect";
import { beginPasskeySignInAction, finishPasskeySignInAction, verifyMfaCodeAction } from "./actions";

/**
 * BL-STAB-8a-2 — the code box of the second step.
 * BL-STAB-8a-3 — and, with a passkey on the account, the passkey button.
 */
export function VerifyForm({ callbackUrl, hasPasskey }: { callbackUrl?: string; hasPasskey: boolean }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [webauthn, setWebauthn] = useState(false);
  useEffect(() => setWebauthn(browserSupportsWebAuthn()), []);

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

  async function usePasskey() {
    setError(null);
    setLoading(true);
    const begun = await beginPasskeySignInAction();
    if (!begun.ok) {
      setError(begun.error);
      setLoading(false);
      return;
    }
    let response;
    try {
      response = await startAuthentication(begun.options as PublicKeyCredentialRequestOptionsJSON);
    } catch (err) {
      setError(err instanceof Error && err.name === "NotAllowedError" ? "The passkey prompt was closed. Try again, or enter a code." : "Your browser could not use a passkey here. Enter a code instead.");
      setLoading(false);
      return;
    }
    const res = await finishPasskeySignInAction({ response });
    if (!res.ok) {
      setError(res.error);
      setLoading(false);
      return;
    }
    window.location.href = safeRedirectTarget(callbackUrl);
  }

  return (
    <form className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}>
      {hasPasskey && webauthn ? (
        <>
          <button type="button" className="aur-btn aur-btn-primary" disabled={loading || locked} onClick={usePasskey}>
            {loading ? "Checking…" : "Use a passkey"}
          </button>
          <div className="font-mono text-[10px] uppercase tracking-label text-muted">Or enter a code</div>
        </>
      ) : null}
      <div>
        <label className="aur-label">Code</label>
        <input
          className="aur-input font-mono"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus={!(hasPasskey && webauthn)}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123 456 or a recovery code"
          disabled={locked}
        />
      </div>
      {error ? <p className="font-body text-[12px] text-rose">{error}</p> : null}
      <button type="submit" className={`aur-btn ${hasPasskey && webauthn ? "" : "aur-btn-primary"}`} disabled={loading || locked || code.trim().length < 6}>
        {loading ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
