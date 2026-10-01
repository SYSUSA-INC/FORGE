/**
 * BL-AIP-7d part ii — onboarding against Postgres, two tenants: state,
 * proposal (refused without NAICS / the feature; stub = registration
 * only) and apply (scout profile merged, one entry, audited) read and
 * write the deciding tenant only.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, knowledgeEntries, organizations } from "@/db/schema";
import { getAIProviderStatus } from "@/lib/ai";
import { applyOnboardingProposal, getOnboardingState, proposeOnboarding } from "@/lib/onboarding";
import { CAPABILITY_ENTRY_TITLE } from "@/lib/onboarding-logic";
import { getScoutProfile } from "@/lib/scout";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-AIP-7d part ii — onboarding from a UEI", () => {
  let fx: TwoTenantFixture;
  let tierA: { cleanup: () => Promise<void> };
  const tag = Date.now().toString(36);

  beforeEach(async () => {
    fx = await createTwoTenants("onboarding");
    tierA = await createTierAndSubscribe({
      organizationId: fx.orgA.organizationId,
      slug: `onb-a-${tag}`,
      name: "Onboarding A",
      featureFlags: { aiAutoDraft: true },
      quotas: { aiTokensPerMonth: 0, aiRequestsPerMonth: 100 },
    });
    await db
      .update(organizations)
      .set({
        name: `Acme Orbital ${tag}`,
        uei: "ABC123DEF456",
        state: "VA",
        primaryNaics: "541512",
        naicsList: ["541512", "541519"],
        socioEconomic: { sba8a: true, smallBusiness: true, sdb: false, wosb: false, sdvosb: false, hubzone: false },
      })
      .where(eq(organizations.id, fx.orgA.organizationId));
  });

  afterEach(async () => {
    await tierA.cleanup();
    await fx.cleanup();
  });

  it("reads each tenant's own setup state", async () => {
    const a = await getOnboardingState({ organizationId: fx.orgA.organizationId });
    expect(a?.profile).toMatchObject({ uei: "ABC123DEF456", primaryNaics: "541512", naicsList: ["541512", "541519"] });
    expect(a?.status).toMatchObject({ needsUei: false, needsNaics: false, needsScout: true, needsCapability: true, complete: false });

    const b = await getOnboardingState({ organizationId: fx.orgB.organizationId });
    expect(b?.status).toMatchObject({ needsUei: true, needsNaics: true, needsScout: true, needsCapability: true });
  });

  it("proposes from the tenant's own registration, refusing without NAICS or the feature", async () => {
    const actorB = { userId: fx.orgB.userId };
    const noNaics = await proposeOnboarding({ organizationId: fx.orgB.organizationId, actor: actorB });
    expect(noNaics.ok).toBe(false);
    if (!noNaics.ok) expect(noNaics.error).toMatch(/NAICS/);

    await db.update(organizations).set({ primaryNaics: "236220" }).where(eq(organizations.id, fx.orgB.organizationId));
    const noFeature = await proposeOnboarding({ organizationId: fx.orgB.organizationId, actor: actorB });
    expect(noFeature.ok).toBe(false);

    const res = await proposeOnboarding({ organizationId: fx.orgA.organizationId, actor: { userId: fx.orgA.userId, email: "a@test" } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.proposal.capabilityStatement.length).toBeGreaterThan(0);
    if (getAIProviderStatus().active.name === "stub") {
      expect(res.stubbed).toBe(true);
      expect(res.fallback).toBe(true);
      expect(res.proposal.capabilityStatement).toContain(`Acme Orbital ${tag}`);
      expect(res.proposal.scoutKeywords).toEqual(["NAICS 541512", "NAICS 541519", "8(a)", "small business"]);
      expect(res.proposal.targetAgencies).toEqual([]);
    }
    const audits = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "onboarding.assist.generate")));
    expect(audits).toHaveLength(1);
  });

  it("applies to the deciding tenant only, merging the scout profile and creating one entry", async () => {
    const actor = { userId: fx.orgA.userId, email: "a@test" };
    const nothing = await applyOnboardingProposal({ organizationId: fx.orgA.organizationId, proposal: {}, runScout: false, actor });
    expect(nothing.ok).toBe(false);

    const first = await applyOnboardingProposal({
      organizationId: fx.orgA.organizationId,
      proposal: {
        capabilityStatement: `Acme ${tag} migrates agency workloads to zero-trust cloud environments.`,
        scoutKeywords: ["zero trust", "Zero Trust", "cloud migration"],
        extraNaics: ["541512", "518210"],
        targetAgencies: [{ name: "DISA", why: "Buys zero-trust." }],
      },
      runScout: false,
      actor,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.entryId).toBeTruthy();
    expect(first.keywords).toEqual(["zero trust", "cloud migration"]);
    expect(first.extraNaics).toEqual(["518210"]);
    expect(first.scout).toBeNull();

    const [entry] = await db
      .select({ title: knowledgeEntries.title, kind: knowledgeEntries.kind, tags: knowledgeEntries.tags, metadata: knowledgeEntries.metadata, orgId: knowledgeEntries.organizationId })
      .from(knowledgeEntries)
      .where(eq(knowledgeEntries.id, first.entryId!));
    expect(entry).toMatchObject({
      title: CAPABILITY_ENTRY_TITLE,
      kind: "capability",
      orgId: fx.orgA.organizationId,
      metadata: { source: "onboarding_assist", uei: "ABC123DEF456", primaryNaics: "541512", targetAgencies: "DISA — Buys zero-trust." },
    });
    expect(entry?.tags).toContain("onboarding");

    // Merged, not replaced; the known code stays excluded.
    const second = await applyOnboardingProposal({
      organizationId: fx.orgA.organizationId,
      proposal: { scoutKeywords: ["cloud migration", "devsecops"], extraNaics: ["541519", "541715"] },
      runScout: false,
      actor,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.keywords).toEqual(["zero trust", "cloud migration", "devsecops"]);
    expect(second.extraNaics).toEqual(["518210", "541715"]);
    expect(second.entryId).toBeNull();

    expect((await getScoutProfile({ organizationId: fx.orgA.organizationId })).keywords).toEqual(["zero trust", "cloud migration", "devsecops"]);
    expect((await getScoutProfile({ organizationId: fx.orgB.organizationId })).keywords).toEqual([]);
    const bEntries = await db
      .select({ id: knowledgeEntries.id })
      .from(knowledgeEntries)
      .where(eq(knowledgeEntries.organizationId, fx.orgB.organizationId));
    expect(bEntries).toHaveLength(0);

    const a = await getOnboardingState({ organizationId: fx.orgA.organizationId });
    expect(a?.status.complete).toBe(true);
    const b = await getOnboardingState({ organizationId: fx.orgB.organizationId });
    expect(b?.status.complete).toBe(false);

    const audits = await db
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "onboarding.apply")))
      .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));
    expect(audits).toHaveLength(2);
    expect(audits[0]!.metadata).toMatchObject({ keywords: ["zero trust", "cloud migration"], agencies: ["DISA"], runScout: false });
    expect(audits[1]!.metadata).toMatchObject({ keywords: ["cloud migration", "devsecops"], agencies: [], entryId: null });
    const none = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgB.organizationId), eq(auditLogs.action, "onboarding.apply")));
    expect(none).toHaveLength(0);
  });
});
