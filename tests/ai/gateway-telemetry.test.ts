/**
 * BL-AI-TELEMETRY — runtime tests for the per-call AI ledger.
 *
 * `completeForTenant` must leave exactly one ai_call_log row per
 * invocation, whatever the outcome, and the row must carry the fields
 * that make per-feature cost and quality measurable. A regression here
 * silently blinds the admin usage page and every later substrate item
 * (model routing, prompt regression) that reads this table.
 *
 * Covered:
 *   - ok row: feature, variant, tokens, model/provider, output size,
 *     request shape (maxTokens / cacheSystem / documents), latency
 *   - error row when the provider throws (call still rethrows)
 *   - quota_refused row when the pre-check blocks (no provider call)
 *   - rows are tenant-isolated
 *   - getAiFeatureBreakdown aggregates per feature for one tenant
 *   - pruneAiCallLogs removes only rows past the retention window
 *
 * Approach mirrors gateway-tokens.test.ts: swap the provider through
 * the production test seam, leave the DB and gates un-mocked.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  aiCallLogs,
  subscriptionTiers,
  tenantSubscriptions,
  type TierFeatureFlags,
  type TierQuotas,
} from "@/db/schema";
import {
  createTwoTenants,
  type TwoTenantFixture,
} from "../helpers/fixtures";
import { QuotaExceededError } from "@/lib/subscription-gates";
import { completeForTenant, __setCompleteImplForTest } from "@/lib/ai";
import {
  getAiFeatureBreakdown,
  pruneAiCallLogs,
} from "@/lib/ai-telemetry";

async function createTierAndSubscribe(opts: {
  organizationId: string;
  slug: string;
  quotas?: Partial<TierQuotas>;
}): Promise<() => Promise<void>> {
  const flags: TierFeatureFlags = {
    aiAutoDraft: false,
    winnerAnalysis: false,
    complianceMatrix: false,
    bulkExport: false,
    apiAccess: false,
    customTemplates: false,
  };
  const quotas: TierQuotas = {
    aiRequestsPerMonth: 0,
    aiTokensPerMonth: 0,
    proposalsPerMonth: 0,
    seatsIncluded: 0,
    storageGb: 0,
    ...(opts.quotas ?? {}),
  };
  const [tier] = await db
    .insert(subscriptionTiers)
    .values({
      slug: opts.slug,
      name: "Telemetry test tier",
      featureFlags: flags,
      quotas,
      active: true,
    })
    .returning({ id: subscriptionTiers.id });
  if (!tier) throw new Error("tier insert failed");
  await db
    .insert(tenantSubscriptions)
    .values({ organizationId: opts.organizationId, tierId: tier.id, status: "active" })
    .onConflictDoUpdate({
      target: tenantSubscriptions.organizationId,
      set: { tierId: tier.id, status: "active" },
    });
  return async () => {
    await db
      .delete(tenantSubscriptions)
      .where(eq(tenantSubscriptions.organizationId, opts.organizationId));
    await db.delete(subscriptionTiers).where(eq(subscriptionTiers.id, tier.id));
  };
}

function logsFor(organizationId: string) {
  return db
    .select()
    .from(aiCallLogs)
    .where(eq(aiCallLogs.organizationId, organizationId))
    .orderBy(asc(aiCallLogs.createdAt));
}

let providerCallCount = 0;
let providerShouldThrow: Error | null = null;
let nextText = "hello world";
let nextTokens = { inputTokens: 30, outputTokens: 70 };

describe("BL-AI-TELEMETRY — completeForTenant writes ai_call_log (runtime)", () => {
  let fx: TwoTenantFixture;
  let cleanupTier: () => Promise<void> = async () => {};

  beforeEach(async () => {
    fx = await createTwoTenants("ai-telemetry");
    providerCallCount = 0;
    providerShouldThrow = null;
    nextText = "hello world";
    nextTokens = { inputTokens: 30, outputTokens: 70 };
    __setCompleteImplForTest(async () => {
      providerCallCount += 1;
      if (providerShouldThrow) throw providerShouldThrow;
      return {
        text: nextText,
        provider: "stub" as const,
        model: "test-mock",
        inputTokens: nextTokens.inputTokens,
        outputTokens: nextTokens.outputTokens,
        stubbed: false,
      };
    });
  });

  afterEach(async () => {
    __setCompleteImplForTest(null);
    await cleanupTier();
    await fx.cleanup();
  });

  it("records one ok row carrying feature, variant, tokens, model and request shape", async () => {
    await completeForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "section_draft",
      variant: "draft",
      promptVersion: "v1",
      system: "x",
      messages: [{ role: "user", content: "y" }],
      maxTokens: 2200,
      cacheSystem: true,
    });

    const rows = await logsFor(fx.orgA.organizationId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe("ok");
    expect(row.feature).toBe("section_draft");
    expect(row.variant).toBe("draft");
    expect(row.promptVersion).toBe("v1");
    expect(row.provider).toBe("stub");
    expect(row.model).toBe("test-mock");
    expect(row.inputTokens).toBe(30);
    expect(row.outputTokens).toBe(70);
    expect(row.outputChars).toBe("hello world".length);
    expect(row.maxTokens).toBe(2200);
    expect(row.cacheSystem).toBe(true);
    expect(row.hasDocuments).toBe(false);
    expect(row.stubbed).toBe(false);
    expect(row.error).toBeNull();
    expect(row.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("records an error row (and still rethrows) when the provider fails", async () => {
    providerShouldThrow = new Error("simulated provider 503");
    await expect(
      completeForTenant({
        organizationId: fx.orgA.organizationId,
        feature: "proposal_scan",
        system: "x",
        messages: [{ role: "user", content: "y" }],
      }),
    ).rejects.toThrow("simulated provider 503");

    const rows = await logsFor(fx.orgA.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("error");
    expect(rows[0]!.feature).toBe("proposal_scan");
    expect(rows[0]!.error).toContain("simulated provider 503");
    expect(rows[0]!.inputTokens).toBe(0);
    expect(rows[0]!.outputTokens).toBe(0);
  });

  it("records a quota_refused row without calling the provider", async () => {
    cleanupTier = await createTierAndSubscribe({
      organizationId: fx.orgA.organizationId,
      slug: `tel-tight-${fx.orgA.organizationId.slice(0, 8)}`,
      quotas: { aiTokensPerMonth: 100 },
    });

    // First call lands exactly on the cap (50 + 50) and succeeds.
    nextTokens = { inputTokens: 50, outputTokens: 50 };
    await completeForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "section_chat",
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    const callsAfterFirst = providerCallCount;

    // Second call is refused at pre-check.
    await expect(
      completeForTenant({
        organizationId: fx.orgA.organizationId,
        feature: "section_chat",
        system: "x",
        messages: [{ role: "user", content: "y" }],
      }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    expect(providerCallCount).toBe(callsAfterFirst);

    const rows = await logsFor(fx.orgA.organizationId);
    expect(rows.map((r) => r.status)).toEqual(["ok", "quota_refused"]);
    const refused = rows[1]!;
    expect(refused.feature).toBe("section_chat");
    expect(refused.error).toContain("aiTokensPerMonth");
    expect(refused.latencyMs).toBe(0);
    expect(refused.inputTokens).toBe(0);
  });

  it("rows are isolated per tenant", async () => {
    await completeForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "winner_analysis",
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    expect(await logsFor(fx.orgA.organizationId)).toHaveLength(1);
    expect(await logsFor(fx.orgB.organizationId)).toHaveLength(0);
  });

  it("getAiFeatureBreakdown aggregates per feature for one tenant", async () => {
    const since = new Date(Date.now() - 60_000);

    nextTokens = { inputTokens: 100, outputTokens: 200 };
    await completeForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "section_draft",
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    await completeForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "section_draft",
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    nextTokens = { inputTokens: 10, outputTokens: 20 };
    await completeForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "section_chat",
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    providerShouldThrow = new Error("boom");
    await completeForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "section_chat",
      system: "x",
      messages: [{ role: "user", content: "y" }],
    }).catch(() => {});
    // Tenant B noise must not leak into A's breakdown.
    providerShouldThrow = null;
    await completeForTenant({
      organizationId: fx.orgB.organizationId,
      feature: "section_draft",
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });

    const rows = await getAiFeatureBreakdown(since, fx.orgA.organizationId);
    const byFeature = new Map(rows.map((r) => [r.feature, r]));

    const draft = byFeature.get("section_draft");
    expect(draft).toBeDefined();
    expect(draft!.calls).toBe(2);
    expect(draft!.ok).toBe(2);
    expect(draft!.errors).toBe(0);
    expect(draft!.inputTokens).toBe(200);
    expect(draft!.outputTokens).toBe(400);
    expect(draft!.tenants).toBe(1);

    const chat = byFeature.get("section_chat");
    expect(chat).toBeDefined();
    expect(chat!.calls).toBe(2);
    expect(chat!.ok).toBe(1);
    expect(chat!.errors).toBe(1);
    expect(chat!.inputTokens).toBe(10);
    expect(chat!.outputTokens).toBe(20);

    // Ordered by total tokens desc → section_draft first.
    expect(rows[0]!.feature).toBe("section_draft");
  });

  it("pruneAiCallLogs removes only rows older than the retention window", async () => {
    // One fresh row via the gateway…
    await completeForTenant({
      organizationId: fx.orgA.organizationId,
      feature: "image_ocr",
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    // …and one back-dated row inserted directly.
    await db.insert(aiCallLogs).values({
      organizationId: fx.orgA.organizationId,
      feature: "image_ocr",
      status: "ok",
      createdAt: new Date(Date.now() - 100 * 24 * 60 * 60_000),
    });
    expect(await logsFor(fx.orgA.organizationId)).toHaveLength(2);

    const result = await pruneAiCallLogs(90);
    expect(result.retentionDays).toBe(90);
    expect(result.rowsDeleted).toBeGreaterThanOrEqual(1);

    const remaining = await logsFor(fx.orgA.organizationId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.createdAt.getTime()).toBeGreaterThan(
      Date.now() - 24 * 60 * 60_000,
    );
  });
});
