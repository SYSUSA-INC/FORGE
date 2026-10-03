/**
 * BL-FB-GEN-GRAPHICS — graphics suggestions against Postgres. Two
 * tenants. Asserts: suggestions come from the owning tenant's section
 * only; a section too short is refused before any gate; the feature
 * gate holds; with the stub provider the heuristic proposals are used
 * and rendered; the run is audited.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, proposalSections } from "@/db/schema";
import { getAIProviderStatus } from "@/lib/ai";
import { suggestSectionGraphics } from "@/lib/graphics";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const TEXT =
  "Users reach the portal through single sign-on. The portal calls the API gateway, which routes requests to the ticketing service and the reporting dashboard. Both services write to the database and stream events to the SIEM. Everything runs in AWS GovCloud with monitoring on every node, and the help desk answers tickets around the clock.";

describe("BL-FB-GEN-GRAPHICS — suggestSectionGraphics", () => {
  let fx: TwoTenantFixture;
  let tierA: { cleanup: () => Promise<void> };
  let sectionA = "";
  let sectionB = "";
  const tag = Date.now().toString(36);

  beforeEach(async () => {
    fx = await createTwoTenants("graphics");
    tierA = await createTierAndSubscribe({
      organizationId: fx.orgA.organizationId,
      slug: `gfx-a-${tag}`,
      name: "Graphics A",
      featureFlags: { aiAutoDraft: true },
      quotas: { aiTokensPerMonth: 0, aiRequestsPerMonth: 100 },
    });
    const [a] = await db
      .insert(proposalSections)
      .values({ proposalId: fx.orgA.proposalId, kind: "technical", title: "Technical Approach", content: TEXT })
      .returning({ id: proposalSections.id });
    sectionA = a!.id;
    const [b] = await db
      .insert(proposalSections)
      .values({ proposalId: fx.orgB.proposalId, kind: "technical", title: "Technical Approach", content: TEXT })
      .returning({ id: proposalSections.id });
    sectionB = b!.id;
  });

  afterEach(async () => {
    await tierA.cleanup();
    await fx.cleanup();
  });

  it("suggests from the owning tenant's section only, gated, audited", async () => {
    const actorA = { userId: fx.orgA.userId, email: "a@test" };
    // Another tenant's section is not found; a short section is refused before the gate.
    expect(await suggestSectionGraphics({ organizationId: fx.orgA.organizationId, sectionId: sectionB, actor: actorA })).toEqual({ ok: false, error: "Section not found." });
    const short = await suggestSectionGraphics({ organizationId: fx.orgA.organizationId, sectionId: sectionA, currentBodyPlain: "Too short.", actor: actorA });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error).toMatch(/40\+ words/);
    // Tenant B has no tier with the feature.
    expect((await suggestSectionGraphics({ organizationId: fx.orgB.organizationId, sectionId: sectionB, actor: { userId: fx.orgB.userId } })).ok).toBe(false);

    const res = await suggestSectionGraphics({ organizationId: fx.orgA.organizationId, sectionId: sectionA, actor: actorA });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.suggestions.length).toBeGreaterThan(0);
    for (const s of res.suggestions) {
      expect(s.svg.startsWith("<svg")).toBe(true);
      expect(s.dataUri.startsWith("data:image/svg+xml")).toBe(true);
      expect(s.mermaid).toMatch(/^flowchart (TB|LR|TD)/);
      expect(s.nodes.length).toBeGreaterThanOrEqual(2);
    }
    if (getAIProviderStatus().active.name === "stub") {
      expect(res.stubbed).toBe(true);
      expect(res.fallback).toBe(true);
      expect(res.suggestions[0]!.kind).toBe("architecture");
    }

    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    expect(audits.filter((a) => a.action === "section.graphics.suggest")).toHaveLength(1);
    const foreign = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgB.organizationId));
    expect(foreign.filter((a) => a.action === "section.graphics.suggest")).toHaveLength(0);
  });
});
