/**
 * BL-FB-GEN-VOC — voice of the customer against Postgres. Two tenants.
 * Asserts: the phrases are read from the deciding tenant's own
 * solicitations and opportunity; another tenant sees nothing for that
 * proposal; the per-section switch is scoped and audited.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, proposalSections, solicitations } from "@/db/schema";
import { getCustomerVoice, setSectionCustomerVoice } from "@/lib/customer-voice-signals";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-FB-GEN-VOC — customer voice", () => {
  let fx: TwoTenantFixture;
  let sectionA = "";

  beforeEach(async () => {
    fx = await createTwoTenants("voice");
    await db.insert(solicitations).values({
      organizationId: fx.orgA.organizationId,
      opportunityId: fx.orgA.opportunityId,
      title: "RFP",
      sectionMSummary:
        "Proposals will be evaluated on the offeror's zero trust architecture approach and its continuous monitoring capability.",
      rawText: "The Government will evaluate the Offeror's secure software supply chain practices.",
      extractedRequirements: [
        { kind: "shall", text: "The contractor shall implement a zero trust architecture across all enclaves.", ref: "C.3" },
        { kind: "shall", text: "The contractor shall provide continuous monitoring of all enclaves.", ref: "C.4" },
      ],
    });
    const [sec] = await db
      .insert(proposalSections)
      .values({ proposalId: fx.orgA.proposalId, kind: "technical", title: "Technical approach" })
      .returning({ id: proposalSections.id });
    sectionA = sec!.id;
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("reads the deciding tenant's solicitation language only", async () => {
    const a = await getCustomerVoice({ organizationId: fx.orgA.organizationId, proposalId: fx.orgA.proposalId });
    expect(a).not.toBeNull();
    const list = a!.phrases.map((p) => p.phrase);
    expect(list).toContain("zero trust architecture");
    expect(list).toContain("continuous monitoring");
    expect(list).toContain("software supply chain");
    expect(a!.sources).toMatchObject({ requirements: 2, sectionM: true });
    expect(a!.sources.rawTextChars).toBeGreaterThan(0);

    // Another tenant asking about A's proposal gets nothing; its own has no solicitation.
    expect(await getCustomerVoice({ organizationId: fx.orgB.organizationId, proposalId: fx.orgA.proposalId })).toBeNull();
    const b = await getCustomerVoice({ organizationId: fx.orgB.organizationId, proposalId: fx.orgB.proposalId });
    expect(b?.phrases).toEqual([]);
    expect(b?.sources).toMatchObject({ requirements: 0, sectionM: false, rawTextChars: 0 });
  });

  it("flips the section's echo switch for the owning tenant only, audited", async () => {
    const foreign = await setSectionCustomerVoice({
      organizationId: fx.orgB.organizationId,
      sectionId: sectionA,
      enabled: false,
      actor: { userId: fx.orgB.userId },
    });
    expect(foreign).toEqual({ ok: false, error: "Section not found." });

    const res = await setSectionCustomerVoice({
      organizationId: fx.orgA.organizationId,
      sectionId: sectionA,
      enabled: false,
      actor: { userId: fx.orgA.userId, email: "a@test" },
    });
    expect(res).toEqual({ ok: true, enabled: false });
    const [row] = await db
      .select({ echo: proposalSections.echoCustomerVoice })
      .from(proposalSections)
      .where(eq(proposalSections.id, sectionA));
    expect(row!.echo).toBe(false);

    const audits = await db
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "proposal_section.customer_voice.update")));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({ proposalId: fx.orgA.proposalId, enabled: false });
    const none = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgB.organizationId), eq(auditLogs.action, "proposal_section.customer_voice.update")));
    expect(none).toHaveLength(0);
  });
});
