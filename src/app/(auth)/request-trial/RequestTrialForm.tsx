"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { TRIAL_REQUEST_LIMITS } from "@/lib/trial-request-logic";

/**
 * BL-AUTH-ABUSE Slice 2b — the Request-a-trial form. Like the sign-up
 * form it sends how long it was open and a hidden field people never see.
 */
export function RequestTrialForm() {
  const openedAt = useRef(0);
  useEffect(() => {
    openedAt.current = Date.now();
  }, []);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [message, setMessage] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/trial-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          company,
          jobTitle,
          message,
          companyUrl,
          elapsedMs: openedAt.current ? Date.now() - openedAt.current : null,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        return;
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="mt-6 rounded-md border border-emerald/40 bg-emerald/10 px-4 py-3 text-sm text-text">
        Thanks — we&apos;ve got your request. Someone from FORGE will review it, usually within a business day. If it&apos;s approved you&apos;ll get an email
        inviting you to your own workspace with a 14-day trial.
      </div>
    );
  }

  return (
    <form className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}>
      <div>
        <label className="aur-label">Name</label>
        <input className="aur-input" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} />
      </div>
      <div>
        <label className="aur-label">Company email</label>
        <input className="aur-input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <div className="mt-1 font-mono text-[10px] text-muted">Your work address — personal mailboxes (Gmail, Outlook, Yahoo) can&apos;t start a trial.</div>
      </div>
      <div>
        <label className="aur-label">Company</label>
        <input
          className="aur-input"
          type="text"
          autoComplete="organization"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          required
          minLength={TRIAL_REQUEST_LIMITS.companyMin}
          maxLength={TRIAL_REQUEST_LIMITS.companyMax}
        />
      </div>
      <div>
        <label className="aur-label">Job title (optional)</label>
        <input className="aur-input" type="text" autoComplete="organization-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={TRIAL_REQUEST_LIMITS.titleMax} />
      </div>
      <div>
        <label className="aur-label">What would you like to try? (optional)</label>
        <textarea className="aur-input min-h-[90px]" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={TRIAL_REQUEST_LIMITS.messageMax} />
      </div>

      {/* Hidden from people (and screen readers); scripts fill it in. */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
        <label>
          Company website
          <input type="text" name="companyUrl" tabIndex={-1} autoComplete="off" value={companyUrl} onChange={(e) => setCompanyUrl(e.target.value)} />
        </label>
      </div>

      {error ? <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div> : null}

      <button type="submit" disabled={loading} className="aur-btn aur-btn-primary mt-2 flex items-center justify-center py-3 text-sm disabled:opacity-60">
        {loading ? "Sending…" : "Request a trial"}
      </button>
    </form>
  );
}
