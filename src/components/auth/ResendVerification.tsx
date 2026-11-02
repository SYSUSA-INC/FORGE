"use client";

import { useState } from "react";

/**
 * BL-STAB-8b-1 — ask for the verification email again. The answer is
 * the same whether or not the address has an unverified account.
 */
export function ResendVerification({ email: initial }: { email: string }) {
  const [email, setEmail] = useState(initial);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/resend-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not send. Try again later.");
        setState("error");
        return;
      }
      setState("sent");
    } catch {
      setError("Network error. Try again.");
      setState("error");
    }
  }

  if (state === "sent") {
    return <p className="mt-3 font-mono text-[11px] text-emerald">If that address has an account waiting to be verified, a new link is on its way. It expires in 24 hours.</p>;
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input className="aur-input min-w-0 flex-1" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" disabled={state === "sending"} />
      <button type="button" className="aur-btn" disabled={state === "sending" || !email.includes("@")} onClick={send}>
        {state === "sending" ? "Sending…" : "Resend verification"}
      </button>
      {error ? <p className="w-full font-mono text-[11px] text-rose">{error}</p> : null}
    </div>
  );
}
