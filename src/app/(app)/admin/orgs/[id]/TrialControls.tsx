"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TRIAL_DAYS, TRIAL_EXTEND_LIMITS } from "@/lib/trial-logic";
import { trialAction } from "./actions";

/**
 * BL-AUTH-ABUSE Slice 2a — the trial on /admin/orgs/[id]: start a
 * 14-day trial, extend it, or convert it to full access. When a trial
 * ends without a plan, editing carries on and AI pauses.
 */
export function TrialControls({
  organizationId,
  state,
}: {
  organizationId: string;
  state: { kind: "none" } | { kind: "active"; endsAt: string | null; daysLeft: number | null } | { kind: "expired"; endedAt: string };
}) {
  const router = useRouter();
  const [days, setDays] = useState("7");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(op: "start" | "extend" | "convert") {
    setError(null);
    const confirmText =
      op === "start"
        ? `Put this workspace on a ${TRIAL_DAYS}-day trial? When it ends without a plan, editing carries on and AI pauses.`
        : op === "convert"
          ? "End the trial and give this workspace full access on its current tier? Do this for a plan arranged outside Stripe."
          : `Extend the trial by ${days} day(s)?`;
    if (!window.confirm(confirmText)) return;
    startTransition(async () => {
      const res = await trialAction({ organizationId, op, days: op === "extend" ? Math.round(Number(days)) : undefined });
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md border border-layer/10 bg-layer/[0.02] p-3">
      <div className="aur-label">Trial</div>
      <div className="font-mono text-[11px] text-text">
        {state.kind === "none"
          ? "Not on a trial."
          : state.kind === "expired"
            ? `Ended ${date(state.endedAt)} — editing carries on, AI paused.`
            : state.endsAt
              ? `${state.daysLeft} day(s) left — ends ${date(state.endsAt)}.`
              : "On a trial with no end date."}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {state.kind === "none" ? (
          <button type="button" className="aur-btn aur-btn-ghost text-[11px]" disabled={pending} onClick={() => run("start")}>
            Start {TRIAL_DAYS}-day trial
          </button>
        ) : (
          <>
            <input
              className="aur-input w-20"
              type="number"
              min={TRIAL_EXTEND_LIMITS.min}
              max={TRIAL_EXTEND_LIMITS.max}
              step={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              disabled={pending}
              aria-label="Days to add"
            />
            <button type="button" className="aur-btn aur-btn-ghost text-[11px]" disabled={pending} onClick={() => run("extend")}>
              Extend
            </button>
            <button type="button" className="aur-btn aur-btn-primary text-[11px]" disabled={pending} onClick={() => run("convert")}>
              Convert to full access
            </button>
          </>
        )}
      </div>
      {error ? <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div> : null}
      <p className="font-mono text-[10px] leading-relaxed text-muted/80">
        Audited as <code>tenant.trial_start</code> / <code>tenant.trial_extend</code> / <code>tenant.trial_convert</code> in the tenant&apos;s log. Stripe-paying workspaces can&apos;t be put on a trial; a Stripe checkout ends a trial by itself.
      </p>
    </div>
  );
}
