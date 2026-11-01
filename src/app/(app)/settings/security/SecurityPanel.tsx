"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { MFA_LIMITS } from "@/lib/mfa-constants";
import { beginEnrolmentAction, confirmEnrolmentAction, regenerateRecoveryCodesAction, removeFactorAction } from "./actions";

export type FactorRow = { id: string; kind: string; label: string; createdAt: string; lastUsedAt: string | null };

type Enrolment = { factorId: string; secret: string; uri: string; qrSvg: string };

/**
 * BL-STAB-8a-1 — add an authenticator (QR or key, then a first code),
 * remove one (a current code), and the recovery codes shown once.
 */
export function SecurityPanel({ email, factors, recoveryCodesLeft, available }: { email: string; factors: FactorRow[]; recoveryCodesLeft: number; available: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [askCodeFor, setAskCodeFor] = useState<{ kind: "remove"; factorId: string } | { kind: "regenerate" } | null>(null);
  const [askCode, setAskCode] = useState("");

  function begin() {
    setError(null);
    startTransition(async () => {
      const res = await beginEnrolmentAction({ label });
      if (!res.ok) return setError(res.error);
      setEnrolment(res);
      setCode("");
    });
  }

  function confirm() {
    if (!enrolment) return;
    setError(null);
    startTransition(async () => {
      const res = await confirmEnrolmentAction({ factorId: enrolment.factorId, code });
      if (!res.ok) return setError(res.error);
      setEnrolment(null);
      setLabel("");
      setCode("");
      if (res.recoveryCodes) setCodes(res.recoveryCodes);
      router.refresh();
    });
  }

  function runAskCode() {
    if (!askCodeFor) return;
    setError(null);
    startTransition(async () => {
      if (askCodeFor.kind === "remove") {
        const res = await removeFactorAction({ factorId: askCodeFor.factorId, code: askCode });
        if (!res.ok) return setError(res.error);
      } else {
        const res = await regenerateRecoveryCodesAction({ code: askCode });
        if (!res.ok) return setError(res.error);
        setCodes(res.recoveryCodes);
      }
      setAskCodeFor(null);
      setAskCode("");
      router.refresh();
    });
  }

  const codesText = codes ? codes.join("\n") : "";
  const codesHref = codes ? `data:text/plain;charset=utf-8,${encodeURIComponent(`FORGE recovery codes for ${email}\nEach code works once.\n\n${codesText}\n`)}` : "";

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-4">
        <Panel
          title="Authenticator apps"
          eyebrow={`${factors.length} of ${MFA_LIMITS.factors}`}
          actions={
            !enrolment && available && factors.length < MFA_LIMITS.factors ? (
              <button type="button" className="aur-btn aur-btn-primary" disabled={pending} onClick={begin}>
                Add an authenticator
              </button>
            ) : null
          }
        >
          {!available ? (
            <p className="font-body text-[13px] leading-[1.5] text-muted">Two-step sign-in is not available on this deployment yet. An administrator sets FORGE_SECRET_KEYS first.</p>
          ) : null}
          {factors.length === 0 && !enrolment ? (
            <p className="font-body text-[13px] leading-[1.5] text-muted">
              No authenticator yet. Add one from any authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy and the like): scan the code, then type the six digits it shows. Once FORGE requires two-step sign-in, this is what the second step asks for.
            </p>
          ) : null}
          {factors.length > 0 ? (
            <ul className="flex flex-col divide-y divide-layer/10">
              {factors.map((f) => (
                <li key={f.id} className="flex flex-wrap items-baseline gap-2 py-2 font-body text-[13px]">
                  <span className="font-mono text-[10px] uppercase tracking-label text-muted">{f.kind === "passkey" ? "Passkey" : "App"}</span>
                  <span className="min-w-0 flex-1 text-text">{f.label}</span>
                  <span className="font-mono text-[11px] text-muted">
                    added {f.createdAt}
                    {f.lastUsedAt ? ` · last used ${f.lastUsedAt}` : ""}
                  </span>
                  <button type="button" className="aur-link font-mono text-[10px] uppercase tracking-widest" disabled={pending} onClick={() => { setAskCodeFor({ kind: "remove", factorId: f.id }); setAskCode(""); setError(null); }}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {!enrolment && available && factors.length < MFA_LIMITS.factors ? (
            <label className="mt-3 block">
              <span className="aur-label">Name for the next one (optional)</span>
              <input className="aur-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Phone, 1Password" maxLength={MFA_LIMITS.labelMax} />
            </label>
          ) : null}
          {enrolment ? (
            <div className="mt-2 flex flex-col gap-3">
              <p className="font-body text-[13px] leading-[1.5] text-text">1. In your authenticator app, add an account by scanning this code, or by typing the key below it.</p>
              <div className="flex flex-wrap items-start gap-4">
                <div className="h-48 w-48 shrink-0 rounded-md border border-layer/10 bg-white p-1" dangerouslySetInnerHTML={{ __html: enrolment.qrSvg }} />
                <div className="min-w-0 flex-1">
                  <div className="aur-label">Key (if you cannot scan)</div>
                  <code className="block break-all font-mono text-[12px] text-text">{enrolment.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
                  <div className="mt-2 font-mono text-[10px] uppercase tracking-label text-muted">Time-based · 6 digits · 30 seconds</div>
                </div>
              </div>
              <p className="font-body text-[13px] leading-[1.5] text-text">2. Type the six-digit code the app shows now.</p>
              <div className="flex flex-wrap items-center gap-2">
                <input className="aur-input w-40 font-mono" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" />
                <button type="button" className="aur-btn aur-btn-primary" disabled={pending || code.replace(/\D/g, "").length !== 6} onClick={confirm}>
                  Confirm
                </button>
                <button type="button" className="aur-btn aur-btn-ghost" disabled={pending} onClick={() => { setEnrolment(null); setError(null); }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {askCodeFor ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-layer/10 pt-3">
              <span className="font-body text-[13px] text-text">{askCodeFor.kind === "remove" ? "To remove it, enter a current code:" : "To replace your recovery codes, enter a current code:"}</span>
              <input className="aur-input w-44 font-mono" autoComplete="one-time-code" value={askCode} onChange={(e) => setAskCode(e.target.value)} placeholder="123 456 or a recovery code" />
              <button type="button" className="aur-btn aur-btn-primary" disabled={pending || askCode.trim().length < 6} onClick={runAskCode}>
                {askCodeFor.kind === "remove" ? "Remove" : "Replace codes"}
              </button>
              <button type="button" className="aur-btn aur-btn-ghost" disabled={pending} onClick={() => setAskCodeFor(null)}>
                Cancel
              </button>
            </div>
          ) : null}
          {error ? <p className="mt-2 font-body text-[12px] text-rose">{error}</p> : null}
        </Panel>
      </div>
      <div className="flex flex-col gap-4">
        <Panel
          title="Recovery codes"
          eyebrow={factors.length === 0 ? "After the first authenticator" : `${recoveryCodesLeft} of ${MFA_LIMITS.recoveryCodes} unused`}
          actions={
            factors.length > 0 && !askCodeFor ? (
              <button type="button" className="aur-link font-mono text-[10px] uppercase tracking-widest" disabled={pending} onClick={() => { setAskCodeFor({ kind: "regenerate" }); setAskCode(""); setError(null); }}>
                Replace
              </button>
            ) : null
          }
        >
          {codes ? (
            <div className="flex flex-col gap-2">
              <p className="font-body text-[13px] leading-[1.5] text-text">Save these now. Each works once, and they are shown only this once.</p>
              <pre className="rounded-md border border-layer/10 bg-layer/[0.03] p-3 font-mono text-[13px] leading-[1.7] text-text">{codesText}</pre>
              <div className="flex flex-wrap gap-2">
                <a className="aur-btn" href={codesHref} download="forge-recovery-codes.txt">
                  Download
                </a>
                <button type="button" className="aur-btn aur-btn-ghost" onClick={() => setCodes(null)}>
                  I saved them
                </button>
              </div>
            </div>
          ) : (
            <p className="font-body text-[13px] leading-[1.5] text-muted">
              {factors.length === 0
                ? "Ten single-use codes arrive with your first authenticator. Keep them somewhere safe: one gets you in if you lose your phone."
                : `A recovery code works once in place of an authenticator code. ${recoveryCodesLeft === 0 ? "You have none left: replace them now." : "Replace them when you run low or if they may have been seen."}`}
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
