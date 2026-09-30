/**
 * BL-AIP-7d — the ⌘K palette against Postgres. Two tenants with
 * look-alike records. Asserts: the record search returns the deciding
 * tenant's rows only, per kind, skipping archived knowledge; wildcard
 * characters in the text are neutralised; a Brain answer is built from
 * the deciding tenant's own sources only and is refused for a tenant
 * without the feature.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, companies, knowledgeEntries, solicitations } from "@/db/schema";
import { getAIProviderStatus } from "@/lib/ai";
import { answerFromBrain } from "@/lib/brain-answer";
import { likePattern, searchWorkspace } from "@/lib/palette-search";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-AIP-7d — palette search and Brain answers", () => {
  let fx: TwoTenantFixture;
  let tierA: { cleanup: () => Promise<void> };
  const tag = `orbital${Date.now().toString(36)}`;
  let entryA = "";
  let entryB = "";
  let archivedA = "";

  beforeEach(async () => {
    fx = await createTwoTenants("palette");
    tierA = await createTierAndSubscribe({
      organizationId: fx.orgA.organizationId,
      slug: `pal-a-${tag}`,
      name: "Palette A",
      featureFlags: { aiAutoDraft: true },
      quotas: { aiTokensPerMonth: 0, aiRequestsPerMonth: 100 },
    });
    await db.insert(companies).values([
      { organizationId: fx.orgA.organizationId, name: `Acme ${tag} Systems`, uei: "ACMEUEI12345" },
      { organizationId: fx.orgB.organizationId, name: `Acme ${tag} Systems B`, uei: "ACMEUEI12345" },
    ]);
    await db.insert(solicitations).values([
      { organizationId: fx.orgA.organizationId, title: `Debris tracking ${tag}`, agency: "NASA" },
    ]);
    const rows = await db
      .insert(knowledgeEntries)
      .values([
        {
          organizationId: fx.orgA.organizationId,
          kind: "capability",
          title: `Orbital debris tracking ${tag}`,
          body: `We built the ${tag} orbital debris tracking pipeline for NASA Goddard under contract NNG-${tag}.`,
        },
        {
          organizationId: fx.orgA.organizationId,
          kind: "capability",
          title: `Archived ${tag}`,
          body: `Old ${tag} orbital debris note.`,
          archivedAt: new Date(),
        },
        {
          organizationId: fx.orgB.organizationId,
          kind: "capability",
          title: `Orbital debris tracking ${tag} B`,
          body: `Tenant B's ${tag} orbital debris tracking work for NASA.`,
        },
      ])
      .returning({ id: knowledgeEntries.id, organizationId: knowledgeEntries.organizationId, title: knowledgeEntries.title });
    entryA = rows.find((r) => r.organizationId === fx.orgA.organizationId && !r.title.startsWith("Archived"))!.id;
    archivedA = rows.find((r) => r.title.startsWith("Archived"))!.id;
    entryB = rows.find((r) => r.organizationId === fx.orgB.organizationId)!.id;
  });

  afterEach(async () => {
    await tierA.cleanup();
    await fx.cleanup();
  });

  it("neutralises ILIKE wildcards", () => {
    expect(likePattern("orbital_%")).toBe("%orbital%");
    expect(likePattern("%")).toBeNull();
    expect(likePattern("  a ")).toBeNull();
    expect(likePattern("NASA  Goddard")).toBe("%nasa goddard%");
  });

  it("finds the deciding tenant's records only, per kind, skipping archived knowledge", async () => {
    const a = await searchWorkspace({ organizationId: fx.orgA.organizationId, query: tag });
    expect(a.map((r) => r.kind).sort()).toEqual(["company", "knowledge", "solicitation"]);
    expect(a.find((r) => r.kind === "knowledge")?.id).toBe(entryA);
    expect(a.some((r) => r.id === archivedA)).toBe(false);
    expect(a.some((r) => r.id === entryB)).toBe(false);
    expect(a.find((r) => r.kind === "company")).toMatchObject({
      title: `Acme ${tag} Systems`,
      subtitle: "UEI ACMEUEI12345",
      href: expect.stringMatching(/^\/companies\//),
    });
    expect(a.find((r) => r.kind === "solicitation")).toMatchObject({ subtitle: "NASA" });

    const b = await searchWorkspace({ organizationId: fx.orgB.organizationId, query: tag });
    expect(b.map((r) => r.kind).sort()).toEqual(["company", "knowledge"]);
    expect(b.find((r) => r.kind === "knowledge")?.id).toBe(entryB);

    // The seeded fixtures: an opportunity and a proposal per tenant.
    const seeded = await searchWorkspace({ organizationId: fx.orgA.organizationId, query: "bl19-palette" });
    expect(seeded.map((r) => r.kind).sort()).toEqual(["opportunity", "proposal"]);
    expect(seeded.map((r) => r.id).sort()).toEqual([fx.orgA.opportunityId, fx.orgA.proposalId].sort());

    // A UEI shared by both tenants' companies still only finds the caller's row.
    const byUei = await searchWorkspace({ organizationId: fx.orgA.organizationId, query: "acmeuei" });
    expect(byUei).toHaveLength(1);
    expect(byUei[0]!.title).toBe(`Acme ${tag} Systems`);

    expect(await searchWorkspace({ organizationId: fx.orgA.organizationId, query: "%" })).toEqual([]);
  });

  it("answers from the deciding tenant's own Brain and refuses a tenant without the feature", async () => {
    const question = `What orbital debris tracking work did we do for NASA Goddard ${tag}?`;

    const refused = await answerFromBrain({
      organizationId: fx.orgB.organizationId,
      question,
      actor: { userId: fx.orgB.userId },
    });
    expect(refused.ok).toBe(false);

    const res = await answerFromBrain({
      organizationId: fx.orgA.organizationId,
      question,
      actor: { userId: fx.orgA.userId, email: "a@test" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.view.question).toBe(question);
    expect(res.view.answer.length).toBeGreaterThan(0);
    expect(res.view.sources.length).toBeGreaterThan(0);
    // Only A's live entry can be a source: B's entry and A's archived one never appear.
    expect(res.view.sources.every((s) => s.href === `/knowledge-base/${entryA}`)).toBe(true);
    expect(res.view.sources.some((s) => s.href.includes(entryB) || s.href.includes(archivedA))).toBe(false);
    if (getAIProviderStatus().active.name === "stub") {
      expect(res.view.extractive).toBe(true);
      expect(res.view.answer).toContain("[1]");
      expect(res.view.sources[0]).toMatchObject({ n: 1, cited: true, source: "entry", kind: "capability" });
    }

    const audits = await db
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "brain.answer")));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({ sources: 1, cited: [1] });
    const none = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgB.organizationId), eq(auditLogs.action, "brain.answer")));
    expect(none).toHaveLength(0);

    // Too short for the Brain.
    expect(await answerFromBrain({ organizationId: fx.orgA.organizationId, question: "nasa", actor: { userId: null } })).toEqual({
      ok: false,
      error: "Ask a longer question.",
    });
  });
});
