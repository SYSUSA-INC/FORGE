"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { DATABASE_PENDING_MESSAGE, KEYRING_UNAVAILABLE_MESSAGE, maskLast4 } from "@/lib/samgov-key-logic";
import { removeCompanySamKeyAction, setCompanySamKeyAction } from "./samgov-key-actions";

/** What the page sends: details of the company key only to admins who can edit it. */
export type SamKeyPanelView = {
  inUse: "company" | "platform" | "none";
  platformConfigured: boolean;
  canSave: boolean;
  dbReady: boolean;
  company: null | { last4: string; status: string; statusAt: string; verifiedAt: string | null; setAt: string; setByName: string | null; readable: boolean };
};

const day = (iso: string) => iso.slice(0, 10);

/**
 * BL-STAB-7b — the company's own SAM.gov API key. Admins paste it; FORGE
 * tests it with SAM.gov before saving, stores it encrypted and never shows
 * it again. Members see only whether SAM.gov is connected.
 */
export function SamGovKeyPanel({ view, canEdit, isImpersonating }: { view: SamKeyPanelView; canEdit: boolean; isImpersonating: boolean }) {
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "ok" | "err"; message: string }>({ kind: "idle" });
  const [pending, startTransition] = useTransition();
  const company = view.company;

  function run(action: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) {
    setStatus({ kind: "idle" });
    startTransition(async () => {
      try {
        const res = await action();
        setStatus(res.ok ? { kind: "ok", message: res.message } : { kind: "err", message: res.error });
      } catch {
        setStatus({ kind: "err", message: "FORGE didn't answer. Check your connection and try again." });
      } finally {
        setKey("");
      }
    });
  }

  function remove() {
    if (!company) return;
    const after = view.platformConfigured ? "FORGE will use its shared key for your company until a new key is added." : "SAM.gov features will stop until a new key is added.";
    if (!window.confirm(`Remove your company's SAM.gov key (${maskLast4(company.last4)})? ${after}`)) return;
    run(() => removeCompanySamKeyAction());
  }

  const eyebrow = view.inUse === "company" ? `Your company's key${company ? ` ${maskLast4(company.last4)}` : ""}` : view.inUse === "platform" ? "FORGE's shared key" : "Not connected";

  if (!canEdit) {
    return (
      <Panel title="SAM.gov API key" eyebrow={eyebrow} accent="cobalt" className="mb-4">
        <p className="font-body text-[13px] text-muted">
          {view.inUse === "company"
            ? "SAM.gov: connected with your company's key."
            : view.inUse === "platform"
              ? "SAM.gov: connected with FORGE's shared key."
              : "SAM.gov: not connected."}{" "}
          {isImpersonating ? "Read-only while impersonating." : "Company admins manage this key."}
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="SAM.gov API key" eyebrow={eyebrow} accent="cobalt" className="mb-4">
      <p className="font-body text-[12px] leading-relaxed text-muted">
        FORGE uses this key for Import from SAM.gov, company search and sync, Getting started, the scout and Check SAM.gov now. Without it, FORGE&apos;s shared key is used when available. Get a free key on SAM.gov: sign in, open Account Details and request a Public API Key.
      </p>

      <p className="mt-3 font-mono text-[11px] text-text">
        {company && company.readable
          ? `${maskLast4(company.last4)} · added${company.setByName ? ` by ${company.setByName}` : ""} on ${day(company.setAt)}${company.verifiedAt ? ` · SAM.gov accepted it on ${day(company.verifiedAt)}` : ""}`
          : company
            ? `This key (${maskLast4(company.last4)}) can't be read on this FORGE server, so ${view.platformConfigured ? "FORGE's shared key is used" : "SAM.gov features are off"}. Re-enter it to use it here.`
            : view.platformConfigured
              ? "Using FORGE's shared SAM.gov key. Add your company's own key so your searches don't share a daily limit with other companies."
              : "No SAM.gov key. Import, company search, the scout and Q&A checks are off until a company admin adds one."}
      </p>
      {company?.status === "rate_limited" ? (
        <p className="mt-1 font-mono text-[11px] text-gold">SAM.gov&apos;s request limit for this key was reached on {day(company.statusAt)}; it resets daily.</p>
      ) : null}

      {view.canSave ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-subtle">New SAM.gov API key</span>
            <input
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={pending}
              placeholder="Paste the key — SAM.gov checks it before it is saved"
              className="aur-input font-mono text-[12px]"
            />
          </label>
          <button type="button" disabled={pending || !key.trim()} onClick={() => run(() => setCompanySamKeyAction({ key }))} className="aur-btn aur-btn-primary text-[11px] disabled:opacity-50">
            {pending ? "Testing with SAM.gov…" : "Test and save"}
          </button>
        </div>
      ) : (
        <p className="mt-3 font-mono text-[11px] text-gold">{view.dbReady ? KEYRING_UNAVAILABLE_MESSAGE : DATABASE_PENDING_MESSAGE}</p>
      )}
      <p className="mt-2 font-mono text-[10px] text-subtle">
        FORGE encrypts the key and only ever sends it to SAM.gov. It can&apos;t be shown again — not to you, your team or FORGE support.
      </p>
      {company ? (
        <button type="button" disabled={pending} onClick={remove} className="mt-2 font-mono text-[10px] text-rose underline disabled:opacity-40">
          Remove company key
        </button>
      ) : null}

      {status.kind === "err" ? <div className="mt-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{status.message}</div> : null}
      {status.kind === "ok" ? <div className="mt-2 rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">{status.message}</div> : null}
    </Panel>
  );
}
