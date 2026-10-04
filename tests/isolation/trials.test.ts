/**
 * BL-AUTH-ABUSE Slice 2a — trials, against Postgres. A platform admin
 * starts a 14-day trial; once it ends without a plan the workspace keeps
 * full editing (proposals, invites, uploads, export) while AI pauses —
 * the AI flags, the AI quotas and the gateway all refuse with the trial
 * message. Extending restores AI from today; converting gives full
 * access. Stripe-paying workspaces can't be put on a trial. Tenant B is
 * never touched.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, tenantSubscriptions } from "@/db/schema";
import { __setCompleteImplForTest, completeForTenant } from "@/lib/ai";
import { enforceQuota, enforceSeatsQuota, enforceStorageQuota, ensureFeature, getCurrentTier } from "@/lib/subscription-gates";
import { convertTenantTrial, extendTenantTrial, startTenantTrial } from "@/lib/tenant-subscription";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const DAY = 86_400_000;

describe("BL-AUTH-ABUSE — trials: full editing always, AI pauses when a trial ends", () => {
  let fx: TwoTenantFixture;
  let tierA: { cleanup: () => Promise<void> };
  let tierB: { cleanup: () => Promise<void> };
  let providerCalls = 0;
  const tag = Date.now().toString(36);

  beforeEach(async () => {
    fx = await createTwoTenants("trials");
    tierA = await createTierAndSubscribe({
      organizationId: fx.orgA.organizationId,
      slug: `tr-a-${tag}`,
      name: "Trial A",
      featureFlags: { aiAutoDraft: true, complianceMatrix: true, winnerAnalysis: true, bulkExport: true },
      quotas: { aiRequestsPerMonth: 100, aiTokensPerMonth: 0, proposalsPerMonth: 50, seatsIncluded: 0, storageGb: 0 },
    });
    tierB = await createTierAndSubscribe({
      organizationId: fx.orgB.organizationId,
      slug: `tr-b-${tag}`,
      name: "Trial B",
      featureFlags: { aiAutoDraft: true },
      quotas: { aiRequestsPerMonth: 100 },
    });
    providerCalls = 0;
    __setCompleteImplForTest(async () => {
      providerCalls += 1;
      return { text: "ok", provider: "stub" as const, model: "test-mock", inputTokens: 1, outputTokens: 1, stubbed: false };
    });
  });

  afterEach(async () => {
    __setCompleteImplForTest(null);
    await tierA.cleanup();
    await tierB.cleanup();
    await fx.cleanup();
  });

  it("starts, pauses AI at expiry without touching editing, extends and converts", async () => {
    const actor = { userId: fx.orgA.userId, email: "admin@test" };
    const started = await startTenantTrial({ organizationId: fx.orgA.organizationId, actor });
    expect(started.ok).toBe(true);
    const [row] = await db.select({ status: tenantSubscriptions.status, trialUntil: tenantSubscriptions.trialUntil }).from(tenantSubscriptions).where(eq(tenantSubscriptions.organizationId, fx.orgA.organizationId));
    expect(row!.status).toBe("trial");
    expect(Math.round((row!.trialUntil!.getTime() - Date.now()) / DAY)).toBe(14);
    expect(await startTenantTrial({ organizationId: fx.orgA.organizationId, actor })).toEqual({ ok: false, error: "Already on a trial — extend it instead." });
    expect((await getCurrentTier(fx.orgA.organizationId))!.trial.kind).toBe("active");
    await expect(ensureFeature(fx.orgA.organizationId, "aiAutoDraft")).resolves.toBeUndefined();

    // The trial ends.
    await db.update(tenantSubscriptions).set({ trialUntil: new Date(Date.now() - DAY) }).where(eq(tenantSubscriptions.organizationId, fx.orgA.organizationId));
    const ended = (await getCurrentTier(fx.orgA.organizationId))!;
    expect(ended.trial.kind).toBe("expired");
    expect(ended.effectiveFlags).toMatchObject({ aiAutoDraft: false, complianceMatrix: false, winnerAnalysis: false, bulkExport: true });

    // AI pauses everywhere it is asked for…
    await expect(ensureFeature(fx.orgA.organizationId, "aiAutoDraft")).rejects.toThrow(/trial ended .*AI features are paused/);
    await expect(enforceQuota(fx.orgA.organizationId, "aiRequestsPerMonth")).rejects.toThrow(/trial ended/);
    await expect(
      completeForTenant({ organizationId: fx.orgA.organizationId, feature: "section_draft", system: "x", messages: [{ role: "user", content: "y" }] }),
    ).rejects.toThrow(/trial ended/);
    expect(providerCalls).toBe(0);

    // …while editing carries on: new proposals, invites, uploads, export.
    await expect(enforceQuota(fx.orgA.organizationId, "proposalsPerMonth")).resolves.toMatchObject({ limit: 50 });
    await expect(enforceSeatsQuota(fx.orgA.organizationId)).resolves.toBeTruthy();
    await expect(enforceStorageQuota(fx.orgA.organizationId, 1024)).resolves.toBeTruthy();
    await expect(ensureFeature(fx.orgA.organizationId, "bulkExport")).resolves.toBeUndefined();

    // Tenant B never noticed.
    expect((await getCurrentTier(fx.orgB.organizationId))!.trial.kind).toBe("none");
    await expect(ensureFeature(fx.orgB.organizationId, "aiAutoDraft")).resolves.toBeUndefined();

    // Extending an ended trial gives the days from today and AI comes back.
    const extended = await extendTenantTrial({ organizationId: fx.orgA.organizationId, actor, days: 7 });
    expect(extended.ok).toBe(true);
    if (extended.ok) expect(Math.round((extended.trialUntil!.getTime() - Date.now()) / DAY)).toBe(7);
    await expect(ensureFeature(fx.orgA.organizationId, "aiAutoDraft")).resolves.toBeUndefined();
    await completeForTenant({ organizationId: fx.orgA.organizationId, feature: "section_draft", system: "x", messages: [{ role: "user", content: "y" }] });
    expect(providerCalls).toBe(1);
    expect(await extendTenantTrial({ organizationId: fx.orgB.organizationId, actor, days: 7 })).toEqual({ ok: false, error: "This workspace is not on a trial." });
    expect((await extendTenantTrial({ organizationId: fx.orgA.organizationId, actor, days: 0 })).ok).toBe(false);

    // Converting ends the trial for good.
    expect(await convertTenantTrial({ organizationId: fx.orgA.organizationId, actor })).toEqual({ ok: true, trialUntil: null });
    const [after] = await db.select({ status: tenantSubscriptions.status, trialUntil: tenantSubscriptions.trialUntil }).from(tenantSubscriptions).where(eq(tenantSubscriptions.organizationId, fx.orgA.organizationId));
    expect(after).toEqual({ status: "active", trialUntil: null });
    expect((await getCurrentTier(fx.orgA.organizationId))!.trial.kind).toBe("none");

    const audits = await db
      .select({ action: auditLogs.action, organizationId: auditLogs.organizationId })
      .from(auditLogs)
      .where(and(inArray(auditLogs.organizationId, [fx.orgA.organizationId, fx.orgB.organizationId]), inArray(auditLogs.action, ["tenant.trial_start", "tenant.trial_extend", "tenant.trial_convert"])));
    expect(audits.map((a) => a.action).sort()).toEqual(["tenant.trial_convert", "tenant.trial_extend", "tenant.trial_start"]);
    expect(audits.every((a) => a.organizationId === fx.orgA.organizationId)).toBe(true);
  });

  it("refuses a trial for a workspace paying through Stripe", async () => {
    await db.update(tenantSubscriptions).set({ stripeSubscriptionId: `sub_${tag}` }).where(eq(tenantSubscriptions.organizationId, fx.orgB.organizationId));
    expect(await startTenantTrial({ organizationId: fx.orgB.organizationId, actor: { userId: fx.orgB.userId } })).toEqual({
      ok: false,
      error: "This workspace pays through Stripe; trials are for workspaces without a plan.",
    });
  });
});
