"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { setResearchSettingsAction } from "./actions";

export type ResearchPanelProps = {
  isAdmin: boolean;
  hasSubscription: boolean;
  enabled: boolean;
  allowedDomains: string[];
  blockedDomains: string[];
  /** The tenant's own cap; null = the plan's allowance. */
  monthlyCap: number | null;
  planAllowance: number;
  /** After the tenant's own cap. */
  cap: number;
  used: number;
  remaining: number;
  /** Prepaid pack searches held; used only after the plan's. */
  packBalance: number;
  trialEnded: boolean;
  providerReady: boolean;
  monthLabel: string;
};

function n(v: number): string {
  return v.toLocaleString("en-US");
}

/**
 * BL-NAV-LIFECYCLE 5b — "AI and Search": the switch for web research before
 * a proposal's first draft, the domains it may and may not use, the
 * organization's own monthly search cap and what is left of the plan's
 * allowance. Off by default; org admins only.
 */
export function ResearchPanel(p: ResearchPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [on, setOn] = useState(p.enabled);
  const [allowed, setAllowed] = useState(p.allowedDomains.join("\n"));
  const [blocked, setBlocked] = useState(p.blockedDomains.join("\n"));
  const [cap, setCap] = useState(p.monthlyCap === null ? "" : String(p.monthlyCap));
  const [note, setNote] = useState<string | null>(null);
  const locked = !p.isAdmin || !p.hasSubscription || pending;

  function save() {
    setNote(null);
    startTransition(async () => {
      const res = await setResearchSettingsAction({
        enabled: on,
        allowedDomains: allowed,
        blockedDomains: blocked,
        monthlyCap: cap.trim() === "" ? null : Number(cap),
      });
      setNote(res.ok ? "Saved." : res.error);
      if (res.ok) router.refresh();
    });
  }

  const pct = p.cap > 0 ? Math.min(100, Math.round((p.used / p.cap) * 100)) : 0;
  return (
    <Panel
      title="AI and Search"
      eyebrow={`${p.monthLabel} · web research ${on ? "on" : "off"}`}
      actions={
        p.isAdmin && p.hasSubscription ? (
          <button type="button" className="aur-btn aur-btn-primary" disabled={pending} onClick={save}>
            {pending ? "Saving…" : "Save search settings"}
          </button>
        ) : undefined
      }
    >
      <label className="flex items-start gap-3 font-body text-[13px] leading-[1.5] text-text">
        <input type="checkbox" className="mt-1" checked={on} disabled={locked} onChange={(e) => setOn(e.target.checked)} />
        <span>
          Let FORGE research the open web before it drafts a proposal. It searches for public facts about the customer and the requirement (strategy, budget, recent awards), keeps the pages it cites as numbered sources with their web address and the date, and the drafter cites them by address. Your own claims never come from the web, and page text is treated as untrusted. Each search counts against your allowance below. Off until you switch it on.
        </span>
      </label>

      {!p.providerReady ? (
        <p className="mt-2 font-mono text-[11px] text-muted">
          Web research needs the Anthropic provider; AI is in stub mode here, so nothing will search.
        </p>
      ) : null}

      <div className="mt-4 rounded-md border border-layer/10 bg-layer/[0.02] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-[14px] font-semibold text-text">Searches this month</span>
          <span className="ml-auto font-mono text-[11px] tabular-nums text-muted">
            {n(p.used)} of {n(p.cap)} used · {n(p.remaining)} left
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded bg-layer/10">
          <div className={`h-full ${p.cap > 0 && p.used >= p.cap ? "bg-rose/70" : "bg-emerald/70"}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 font-mono text-[10px] text-subtle">
          {p.planAllowance > 0
            ? `Included with your plan: ${n(p.planAllowance)} per month${p.monthlyCap !== null ? ` · your cap ${n(p.monthlyCap)}` : ""}. Resets on the 1st (UTC).`
            : "No web searches are included with your plan; ask your FORGE administrator to add an allowance."}
          {p.trialEnded ? " Your trial has ended, so research is paused." : ""}
          {p.packBalance > 0
            ? ` Pack searches: ${n(p.packBalance)} left. They are used only after this month's included searches, do not expire, and are not limited by your cap.`
            : ""}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="aur-label">Only these sites (optional, one per line)</span>
          <textarea
            className="aur-input mt-1 font-mono text-sm"
            rows={4}
            value={allowed}
            onChange={(e) => setAllowed(e.target.value)}
            disabled={locked}
            placeholder={"agency.gov\nusaspending.gov"}
          />
        </label>
        <label className="block">
          <span className="aur-label">Never use these sites (optional, one per line)</span>
          <textarea
            className="aur-input mt-1 font-mono text-sm"
            rows={4}
            value={blocked}
            onChange={(e) => setBlocked(e.target.value)}
            disabled={locked}
            placeholder={"example.com"}
          />
        </label>
        <label className="block">
          <span className="aur-label">Your own cap, searches per month (blank = your plan&apos;s allowance)</span>
          <input
            className="aur-input mt-1 font-mono text-sm"
            inputMode="numeric"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            disabled={locked}
            placeholder={p.planAllowance > 0 ? String(p.planAllowance) : "0"}
          />
        </label>
      </div>
      <p className="mt-2 font-body text-[12px] leading-relaxed text-muted">
        Sites are bare domains such as agency.gov, with an optional path. With no lists, research uses the open web. When both lists are set, the search is limited to the allowed sites and the blocked ones are removed from what comes back. Your cap can only lower the plan&apos;s allowance. A run reserves its searches before it starts and returns the ones it did not use; when the allowance is spent, research pauses and the drafts use your own records only.
      </p>
      {note ? <p className="mt-2 font-mono text-[11px] text-text">{note}</p> : null}
      {!p.isAdmin ? <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-subtle">An org admin sets this.</p> : null}
    </Panel>
  );
}
