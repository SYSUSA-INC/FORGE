"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import type { BurnDown, FeatureRoutingRow } from "@/lib/ai-control";
import { AI_MODEL_CLASS_LABELS, AI_MODEL_CLASSES, type AiModelClass } from "@/lib/ai-routing";
import { setAiBudgetAction, setAiFeatureRoutingAction } from "./actions";

export type FeatureUsageRow = { feature: string; calls: number; tokens: number; errors: number; refused: number };
export type DailyUsageRow = { day: string; tokens: number; calls: number };

export type AiControlPanelProps = {
  tierName: string | null;
  hasSubscription: boolean;
  monthLabel: string;
  tokens: BurnDown;
  requests: BurnDown;
  platformTokenCap: number;
  platformRequestCap: number;
  budget: { tokensPerMonth?: number; requestsPerMonth?: number };
  daily: DailyUsageRow[];
  usageByFeature: FeatureUsageRow[];
  routing: FeatureRoutingRow[];
  provider: string;
  routingOn: boolean;
  isAdmin: boolean;
};

function n(v: number): string {
  return v.toLocaleString("en-US");
}

function capLabel(cap: number): string {
  return cap === 0 ? "unlimited" : n(cap);
}

const STATUS_CLASS: Record<BurnDown["status"], string> = {
  unlimited: "border-cobalt/40 bg-cobalt/10 text-text",
  healthy: "border-emerald/40 bg-emerald/10 text-emerald-300",
  approaching: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  at_cap: "border-rose/40 bg-rose/10 text-rose-300",
};

const STATUS_LABEL: Record<BurnDown["status"], string> = {
  unlimited: "Unlimited",
  healthy: "On track",
  approaching: "Approaching cap",
  at_cap: "At cap",
};

/**
 * BL-AIP-7c — the control panel: this month's budget and burn-down,
 * tokens per day, and per-feature routing with the tenant's overrides.
 */
export function AiControlPanel(p: AiControlPanelProps) {
  return (
    <>
      <BudgetPanel {...p} />
      <RoutingPanel {...p} />
    </>
  );
}

function BudgetPanel(p: AiControlPanelProps) {
  const router = useRouter();
  const [tokens, setTokens] = useState(p.budget.tokensPerMonth ? String(p.budget.tokensPerMonth) : "");
  const [requests, setRequests] = useState(p.budget.requestsPerMonth ? String(p.budget.requestsPerMonth) : "");
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  function save() {
    setNote(null);
    startTransition(async () => {
      const res = await setAiBudgetAction({
        tokensPerMonth: tokens.trim() ? Number(tokens) : null,
        requestsPerMonth: requests.trim() ? Number(requests) : null,
      });
      setNote(res.ok ? "Saved. The gateway refuses calls past the lower of the tier cap and your budget." : res.error);
      if (res.ok) router.refresh();
    });
  }

  const maxDay = Math.max(1, ...p.daily.map((d) => d.tokens));
  const t = p.tokens;
  const r = p.requests;

  return (
    <Panel
      title="Monthly AI budget"
      eyebrow={`${p.monthLabel} · ${p.tierName ? `${p.tierName} tier` : "no tier assigned"} · resets on the 1st (UTC)`}
      actions={
        p.isAdmin && p.hasSubscription ? (
          <button type="button" className="aur-btn aur-btn-primary text-[11px]" disabled={pending} onClick={save}>
            {pending ? "Saving…" : "Save budget"}
          </button>
        ) : undefined
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Meter
          title="Tokens"
          burn={t}
          platformCap={p.platformTokenCap}
          budget={p.budget.tokensPerMonth}
        />
        <Meter
          title="Requests"
          burn={r}
          platformCap={p.platformRequestCap}
          budget={p.budget.requestsPerMonth}
        />
      </div>

      <div className="mt-4">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
          Tokens per day · this month
        </div>
        {p.daily.length === 0 ? (
          <p className="font-body text-[12px] text-muted">No AI calls recorded this month.</p>
        ) : (
          <div className="flex h-16 items-end gap-0.5">
            {p.daily.map((d) => (
              <div
                key={d.day}
                title={`${d.day}: ${n(d.tokens)} tokens · ${n(d.calls)} calls`}
                className="flex-1 rounded-sm bg-cobalt/40"
                style={{ height: `${Math.max(4, Math.round((d.tokens / maxDay) * 100))}%` }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="aur-label">Your token budget per month (blank = tier cap {capLabel(p.platformTokenCap)})</span>
          <input
            className="aur-input mt-1 font-mono text-sm"
            inputMode="numeric"
            value={tokens}
            onChange={(e) => setTokens(e.target.value)}
            disabled={!p.isAdmin || !p.hasSubscription}
            placeholder={p.platformTokenCap === 0 ? "e.g. 2000000" : String(p.platformTokenCap)}
          />
        </label>
        <label className="block">
          <span className="aur-label">Your request budget per month (blank = tier cap {capLabel(p.platformRequestCap)})</span>
          <input
            className="aur-input mt-1 font-mono text-sm"
            inputMode="numeric"
            value={requests}
            onChange={(e) => setRequests(e.target.value)}
            disabled={!p.isAdmin || !p.hasSubscription}
            placeholder={p.platformRequestCap === 0 ? "e.g. 500" : String(p.platformRequestCap)}
          />
        </label>
      </div>
      <p className="mt-2 font-body text-[12px] leading-relaxed text-muted">
        A budget can only lower the tier cap; a value at or above the cap clears it. Once the lower of the two is
        reached, the gateway refuses further calls this month and records them as refused.
      </p>
      {note ? <p className="mt-2 font-mono text-[11px] text-text">{note}</p> : null}
      {!p.isAdmin ? (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-subtle">An org admin sets the budget.</p>
      ) : null}
    </Panel>
  );
}

function Meter({
  title,
  burn,
  platformCap,
  budget,
}: {
  title: string;
  burn: BurnDown;
  platformCap: number;
  budget: number | undefined;
}) {
  const pct = burn.percent === null ? 0 : Math.min(100, burn.percent);
  return (
    <div className="rounded-md border border-layer/10 bg-layer/[0.02] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-[14px] font-semibold text-text">{title}</span>
        <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${STATUS_CLASS[burn.status]}`}>
          {STATUS_LABEL[burn.status]}
        </span>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted">
          {n(burn.used)} / {capLabel(burn.cap)}
          {burn.percent !== null ? ` · ${burn.percent}%` : ""}
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded bg-layer/10">
        <div
          className={`h-full ${burn.status === "at_cap" ? "bg-rose/70" : burn.status === "approaching" ? "bg-amber-400/70" : "bg-emerald/70"}`}
          style={{ width: `${burn.cap === 0 ? 0 : pct}%` }}
        />
      </div>
      <div className="mt-2 font-mono text-[10px] text-muted">
        Day {burn.dayOfMonth} of {burn.daysInMonth} · {n(Math.round(burn.perDay))}/day · projected {n(burn.projected)} by month end
        {burn.capDay !== null ? ` · cap reached around day ${burn.capDay}` : ""}
      </div>
      <div className="mt-1 font-mono text-[10px] text-subtle">
        Tier cap {capLabel(platformCap)}
        {budget ? ` · your budget ${n(budget)}` : ""}
      </div>
    </div>
  );
}

const SOURCE_LABEL: Record<FeatureRoutingRow["source"], string> = {
  tenant_feature: "Pinned by platform",
  tenant_feature_class: "Your override",
  tenant_class: "Your class override",
  provider_table: "Tier default",
  none: "Provider default",
};

function RoutingPanel(p: AiControlPanelProps) {
  const router = useRouter();
  const [pendingFeature, setPendingFeature] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const usage = new Map(p.usageByFeature.map((u) => [u.feature, u]));
  const overridden = p.routing.filter((r) => r.override !== null).length;

  function change(feature: string, value: string) {
    setNote(null);
    setPendingFeature(feature);
    startTransition(async () => {
      const res = await setAiFeatureRoutingAction(feature, value as "default" | AiModelClass);
      setPendingFeature(null);
      if (!res.ok) {
        setNote(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-4">
      <Panel
        title="Model routing by feature"
        eyebrow={`Provider ${p.provider} · routing ${p.routingOn ? "on" : "off (AI_MODEL_ROUTING=off)"} · ${p.routing.length} features · ${overridden} overridden`}
      >
        <p className="mb-3 font-body text-[12px] leading-relaxed text-muted">
          Every AI feature runs in a model class: fast for short structured work, standard for everyday extraction
          and review, strong for drafting and high-stakes analysis. Move a feature to another class here; the
          gateway requests that class&apos;s model on the next call. A model pinned by a platform admin stays as it is.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-[11px]">
            <thead>
              <tr className="border-b border-layer/10 text-muted">
                <th className="px-2 py-1.5 font-semibold uppercase tracking-widest">Feature</th>
                <th className="px-2 py-1.5 font-semibold uppercase tracking-widest">Default</th>
                <th className="px-2 py-1.5 font-semibold uppercase tracking-widest">Model requested</th>
                <th className="px-2 py-1.5 font-semibold uppercase tracking-widest">Source</th>
                <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-widest">Calls</th>
                <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-widest">Tokens</th>
                <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-widest">Errors</th>
                <th className="px-2 py-1.5 font-semibold uppercase tracking-widest">Class</th>
              </tr>
            </thead>
            <tbody>
              {p.routing.map((r) => {
                const u = usage.get(r.feature);
                const pinned = r.override?.kind === "model";
                const value = r.override?.kind === "class" ? r.override.cls : "default";
                return (
                  <tr key={r.feature} className="border-b border-layer/[0.04] text-text/90 hover:bg-layer/[0.03]">
                    <td className="px-2 py-1.5">
                      {r.label}
                      <div className="font-mono text-[10px] text-muted">{r.feature}</div>
                    </td>
                    <td className="px-2 py-1.5 text-muted">{r.defaultClass}</td>
                    <td className="px-2 py-1.5">
                      {p.routingOn ? r.effectiveModel ?? "provider default" : "provider default (routing off)"}
                    </td>
                    <td className="px-2 py-1.5 text-muted">{SOURCE_LABEL[r.source]}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{u ? n(u.calls) : "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{u ? n(u.tokens) : "—"}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${u && u.errors + u.refused > 0 ? "text-rose-300" : "text-muted"}`}>
                      {u ? n(u.errors + u.refused) : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        className="aur-input py-1 font-mono text-[11px]"
                        value={value}
                        disabled={!p.isAdmin || !p.hasSubscription || pinned || pendingFeature === r.feature}
                        title={pinned ? "Pinned by a platform admin" : "Route this feature to a model class"}
                        onChange={(e) => change(r.feature, e.target.value)}
                      >
                        <option value="default">Tier default ({r.defaultClass})</option>
                        {AI_MODEL_CLASSES.map((c) => (
                          <option key={c} value={c}>
                            {AI_MODEL_CLASS_LABELS[c]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 font-mono text-[10px] text-muted">
          Calls, tokens and errors are this month&apos;s, from the AI call ledger (errors include calls refused at the
          cap). Embeddings are routed to the embedding provider, not a completion model.
        </p>
        {note ? <p className="mt-2 font-mono text-[11px] text-rose-300">{note}</p> : null}
        {!p.isAdmin ? (
          <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-subtle">An org admin changes routing.</p>
        ) : null}
      </Panel>
    </div>
  );
}
