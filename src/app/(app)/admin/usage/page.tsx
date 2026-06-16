import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { db } from "@/db";
import {
  organizations,
  subscriptionTiers,
  tenantSubscriptions,
  tenantUsageCounters,
  type TierQuotas,
} from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

/**
 * BL-PACKAGES Slice 3 — per-tenant AI usage & cost dashboard.
 *
 * Superadmin sees one row per active tenant with current-month token
 * + request usage against the tier's `aiTokensPerMonth` /
 * `aiRequestsPerMonth` caps. Used to:
 *   - Spot heavy users before they upgrade
 *   - Set realistic caps when configuring new tiers
 *   - Estimate platform-wide AI cost
 *
 * Read-only. No tenant data — only counter aggregates + tier metadata.
 *
 * Cost estimation uses a per-tier average $/1M tokens. Anthropic
 * Sonnet pricing as of 2026-06: $3/MTok input, $15/MTok output.
 * We assume a 50/50 input/output mix → ~$9/MTok blended. Adjust
 * by setting AI_COST_PER_MTOK env var.
 */
function blendedCostPerMTok(): number {
  const env = Number(process.env.AI_COST_PER_MTOK || "");
  if (Number.isFinite(env) && env > 0) return env;
  return 9; // dollars
}

function currentMonthStart(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
}

type Row = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  tierName: string;
  tierSlug: string;
  effectiveTokenCap: number;
  effectiveRequestCap: number;
  tokensUsed: number;
  requestsUsed: number;
  // Percent of cap; null when cap = 0 (unlimited).
  tokenPercent: number | null;
  requestPercent: number | null;
};

export default async function AdminUsagePage() {
  await requireSuperadmin();

  const periodStart = currentMonthStart();
  const costPerMTok = blendedCostPerMTok();

  // Pull every tenant + their tier defaults + overrides in one query.
  const tenantRows = await db
    .select({
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      tierName: subscriptionTiers.name,
      tierSlug: subscriptionTiers.slug,
      tierActive: subscriptionTiers.active,
      tierQuotas: subscriptionTiers.quotas,
      overrides: tenantSubscriptions.customOverrides,
      tenantStatus: tenantSubscriptions.status,
    })
    .from(organizations)
    .leftJoin(
      tenantSubscriptions,
      eq(tenantSubscriptions.organizationId, organizations.id),
    )
    .leftJoin(
      subscriptionTiers,
      eq(subscriptionTiers.id, tenantSubscriptions.tierId),
    )
    .orderBy(asc(organizations.name));

  // Pull current-month token + request counters for every tenant in
  // one batch (one query per key — the table's PK is composite so
  // each lookup uses the index).
  const tokenCounters = await db
    .select({
      organizationId: tenantUsageCounters.organizationId,
      value: tenantUsageCounters.value,
    })
    .from(tenantUsageCounters)
    .where(
      and(
        eq(tenantUsageCounters.key, "aiTokensPerMonth"),
        eq(tenantUsageCounters.periodStart, periodStart),
      ),
    );
  const requestCounters = await db
    .select({
      organizationId: tenantUsageCounters.organizationId,
      value: tenantUsageCounters.value,
    })
    .from(tenantUsageCounters)
    .where(
      and(
        eq(tenantUsageCounters.key, "aiRequestsPerMonth"),
        eq(tenantUsageCounters.periodStart, periodStart),
      ),
    );

  const tokensByOrg = new Map(
    tokenCounters.map((r) => [r.organizationId, Number(r.value)]),
  );
  const requestsByOrg = new Map(
    requestCounters.map((r) => [r.organizationId, Number(r.value)]),
  );

  const rows: Row[] = tenantRows.map((t) => {
    const tier = (t.tierQuotas as TierQuotas | null) ?? {
      aiRequestsPerMonth: 0,
      aiTokensPerMonth: 0,
      seatsIncluded: 0,
      storageGb: 0,
      proposalsPerMonth: 0,
    };
    const overrides =
      (t.overrides as { quotas?: Partial<TierQuotas> } | null)?.quotas ?? {};
    const effectiveTokenCap =
      overrides.aiTokensPerMonth ?? tier.aiTokensPerMonth;
    const effectiveRequestCap =
      overrides.aiRequestsPerMonth ?? tier.aiRequestsPerMonth;
    const tokensUsed = tokensByOrg.get(t.organizationId) ?? 0;
    const requestsUsed = requestsByOrg.get(t.organizationId) ?? 0;
    return {
      organizationId: t.organizationId,
      organizationName: t.organizationName,
      organizationSlug: t.organizationSlug,
      tierName: t.tierName ?? "(no tier)",
      tierSlug: t.tierSlug ?? "",
      effectiveTokenCap,
      effectiveRequestCap,
      tokensUsed,
      requestsUsed,
      tokenPercent:
        effectiveTokenCap > 0 ? (tokensUsed / effectiveTokenCap) * 100 : null,
      requestPercent:
        effectiveRequestCap > 0
          ? (requestsUsed / effectiveRequestCap) * 100
          : null,
    };
  });

  // Sort by tokens used (descending) so heaviest tenants surface first.
  rows.sort((a, b) => b.tokensUsed - a.tokensUsed);

  const totalTokens = rows.reduce((sum, r) => sum + r.tokensUsed, 0);
  const totalRequests = rows.reduce((sum, r) => sum + r.requestsUsed, 0);
  const totalCostUsd = (totalTokens / 1_000_000) * costPerMTok;
  const overCapCount = rows.filter(
    (r) => r.tokenPercent !== null && r.tokenPercent >= 100,
  ).length;
  const nearCapCount = rows.filter(
    (r) =>
      r.tokenPercent !== null && r.tokenPercent >= 80 && r.tokenPercent < 100,
  ).length;

  const monthLabel = periodStart.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <>
      <PageHeader
        eyebrow="Platform admin · AI usage"
        title="AI usage & costs"
        subtitle={`Per-tenant token + request consumption for ${monthLabel}. Resets first of next month.`}
        actions={
          <Link href="/admin" className="aur-btn aur-btn-ghost text-[11px]">
            ← SuperAdmin portal
          </Link>
        }
        meta={[
          {
            label: "Total tokens",
            value: totalTokens.toLocaleString(),
          },
          {
            label: "Est. cost",
            value: `$${totalCostUsd.toFixed(2)}`,
            accent: totalCostUsd > 100 ? "hazard" : "emerald",
          },
          {
            label: "Total requests",
            value: totalRequests.toLocaleString(),
          },
          {
            label: "Tenants at-cap",
            value: String(overCapCount),
            accent: overCapCount > 0 ? "rose" : "emerald",
          },
          {
            label: "Tenants ≥80% cap",
            value: String(nearCapCount),
            accent: nearCapCount > 0 ? "hazard" : "emerald",
          },
        ]}
      />

      <div className="mt-4">
        <Panel
          title="Per-tenant AI consumption"
          eyebrow={`${rows.length} tenants · sorted by tokens used`}
        >
          {rows.length === 0 ? (
            <p className="font-body text-[13px] leading-relaxed text-muted">
              No tenants yet. Once organizations are created and AI calls
              run, per-tenant usage will appear here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-[11px]">
                <thead>
                  <tr className="border-b border-white/10 text-muted">
                    <th className="px-2 py-1.5 font-semibold uppercase tracking-widest">
                      Tenant
                    </th>
                    <th className="px-2 py-1.5 font-semibold uppercase tracking-widest">
                      Tier
                    </th>
                    <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-widest">
                      Tokens used
                    </th>
                    <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-widest">
                      Token cap
                    </th>
                    <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-widest">
                      Used
                    </th>
                    <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-widest">
                      Requests
                    </th>
                    <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-widest">
                      Est. cost
                    </th>
                    <th className="px-2 py-1.5 font-semibold uppercase tracking-widest">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const rowCost = (r.tokensUsed / 1_000_000) * costPerMTok;
                    const verdict = verdictFor(r.tokenPercent);
                    return (
                      <tr
                        key={r.organizationId}
                        className="border-b border-white/[0.04] text-text/90 hover:bg-white/[0.03]"
                      >
                        <td className="px-2 py-1.5">
                          <Link
                            href={`/admin/orgs/${r.organizationId}`}
                            className="hover:underline"
                          >
                            {r.organizationName}
                          </Link>
                          <div className="font-mono text-[10px] text-muted">
                            {r.organizationSlug}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">{r.tierName}</td>
                        <td className="px-2 py-1.5 text-right">
                          {r.tokensUsed.toLocaleString()}
                        </td>
                        <td className="px-2 py-1.5 text-right text-muted">
                          {r.effectiveTokenCap === 0
                            ? "∞"
                            : r.effectiveTokenCap.toLocaleString()}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {r.tokenPercent === null
                            ? "—"
                            : `${r.tokenPercent.toFixed(0)}%`}
                        </td>
                        <td className="px-2 py-1.5 text-right text-muted">
                          {r.requestsUsed.toLocaleString()}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          ${rowCost.toFixed(2)}
                        </td>
                        <td className="px-2 py-1.5">
                          <span
                            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest ${verdict.toneClass}`}
                          >
                            {verdict.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 font-mono text-[10px] text-muted">
            Cost estimate: ${costPerMTok}/M tokens (blended Anthropic Sonnet
            input + output). Override via AI_COST_PER_MTOK env var.
          </p>
        </Panel>
      </div>
    </>
  );
}

function verdictFor(percent: number | null): {
  label: string;
  toneClass: string;
} {
  if (percent === null) {
    return {
      label: "Unlimited",
      toneClass: "border-cobalt-400/40 bg-cobalt-400/10 text-cobalt",
    };
  }
  if (percent >= 100) {
    return {
      label: "At cap",
      toneClass: "border-rose/40 bg-rose/10 text-rose",
    };
  }
  if (percent >= 80) {
    return {
      label: "Approaching",
      toneClass: "border-amber-400/40 bg-amber-400/10 text-amber-200",
    };
  }
  return {
    label: "Healthy",
    toneClass: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  };
}
