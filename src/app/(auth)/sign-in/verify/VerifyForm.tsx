"use client";

import { FormEvent, useEffect, useState } from "react";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/types";
import { safeRedirectTarget } from "@/lib/safe-redirect";
import { beginPasskeySignInAction, finishPasskeySignInAction, redeemRecoveryLinkAction, sendRecoveryLinkAction, verifyMfaCodeAction } from "./actions";

/**
 * BL-STAB-8a-2 — the code box of the second step.
 * BL-STAB-8a-3 — and, with a passkey on the account, the passkey button.
 * BL-MFA-RECOVERY — only passkeys made for this address are offered (the
 * others are named), "Email me a recovery link" when neither works, and
 * with `recoverToken` (the link, opened here) the button that uses it.
 */
export function VerifyForm({ callbackUrl, hasPasskey, passkeysElsewhere = [], recoverToken = null }: { callbackUrl?: string; hasPasskey: boolean; passkeysElsewhere?: string[]; recoverToken?: string | null }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [webauthn, setWebauthn] = useState(false);
  useEffect(() => setWebauthn(browserSupportsWebAuthn()), []);
  const [linkNote, setLinkNote] = useState<string | null>(null);

  async function emailLink() {
    setError(null);
    setLinkNote(null);
    setLoading(true);
    const res = await sendRecoveryLinkAction();
    setLoading(false);
    if (!res.ok) return setError(res.error);
    setLinkNote(`We sent a recovery link to ${res.sentTo}. Open it in this browser within 15 minutes.`);
  }

  async function useLink() {
    if (!recoverToken) return;
    setError(null);
    setLoading(true);
    const res = await redeemRecoveryLinkAction({ token: recoverToken });
    if (!res.ok) {
      setError(res.error);
      setLoading(false);
      return;
    }
    window.location.href = "/settings/security?recovered=1";
  }

  if (recoverToken) {
    return (
      <div className="mt-6 flex flex-col gap-3">
        <p className="font-body text-[13px] leading-[1.5] text-text">You opened your recovery link. It gets you in once; then replace your passkey or authenticator app.</p>
        {error ? <p className="font-body text-[12px] text-red">{error}</p> : null}
        <button type="button" className="aur-btn aur-btn-primary" disabled={loading} onClick={useLink}>
          {loading ? "Checking…" : "Continue with the recovery link"}
        </button>
        <a href="/sign-in/verify" className="aur-link font-mono text-[10px] uppercase tracking-widest">
          Use a passkey or code instead
        </a>
      </div>
    );
  }

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
    window.location.href = res.next ?? target;
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
    window.location.href = res.next ?? safeRedirectTarget(callbackUrl);
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
      {error ? <p className="font-body text-[12px] text-red">{error}</p> : null}
      <button type="submit" className={`aur-btn ${hasPasskey && webauthn ? "" : "aur-btn-primary"}`} disabled={loading || locked || code.trim().length < 6}>
        {loading ? "Checking…" : "Continue"}
      </button>
      {passkeysElsewhere.length > 0 ? (
        <p className="font-body text-[12px] leading-[1.5] text-muted">
          {hasPasskey ? "Some of your passkeys were" : "Your passkeys were"} made on {passkeysElsewhere.join(", ")} and only work there. Use your authenticator app, a recovery code, or a recovery link.
        </p>
      ) : null}
      <div className="border-t border-layer/10 pt-3">
        <p className="font-body text-[12px] leading-[1.5] text-muted">Can't use your passkey or app, and no recovery code?</p>
        <button type="button" className="aur-link mt-1 font-mono text-[10px] uppercase tracking-widest" disabled={loading || locked} onClick={emailLink}>
          Email me a recovery link
        </button>
        {linkNote ? <p className="mt-1 font-body text-[12px] text-text">{linkNote}</p> : null}
      </div>
    </form>
  );
}
