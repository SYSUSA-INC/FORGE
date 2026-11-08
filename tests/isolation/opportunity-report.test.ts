/**
 * BL-NAV-LIFECYCLE 2b-2 — Matrix Reports against Postgres, two tenants:
 * each save is the next version, a snapshot a later answer doesn't
 * change; it is audited; the latest shows per opportunity; another
 * tenant's opportunity can't be reported on and another tenant's report
 * can't be read.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, opportunityCapabilityMatrices, opportunityReports } from "@/db/schema";
import { asMatrixReport } from "@/lib/opportunity-report";
import { getReport, latestReports, saveMatrixReport } from "@/lib/opportunity-report-store";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const ans = (value: string, percent?: number) => ({ value, evidence: "", partnerCompanyId: null, percent, updatedAt: "", updatedByUserId: "" });

describe("BL-NAV-LIFECYCLE 2b-2 — Matrix Reports", () => {
  let fx: TwoTenantFixture;

  beforeEach(async () => {
    fx = await createTwoTenants("opportunity-report");
    for (const t of [fx.orgA, fx.orgB]) {
      await db.insert(opportunityCapabilityMatrices).values({
        organizationId: t.organizationId,
        opportunityId: t.opportunityId,
        questions: [
          { id: "q1", text: "Help desk", refs: ["C.1"], kind: "shall", area: "Service" },
          { id: "q2", text: "Migration", refs: ["C.2"], kind: "shall", area: "Migration" },
        ],
        answers: { q1: ans("have_proven"), q2: ans("partial", 40) } as never,
      });
    }
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  const actor = () => ({ userId: fx.orgA.userId, email: null });

  it("saves numbered snapshots that a later answer doesn't change, audited, latest first", async () => {
    const first = await saveMatrixReport({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, actor: actor() });
    expect(first).toMatchObject({ ok: true, version: 1 });
    await db
      .update(opportunityCapabilityMatrices)
      .set({ answers: { q1: ans("have_proven"), q2: ans("partial", 90) } as never })
      .where(eq(opportunityCapabilityMatrices.opportunityId, fx.orgA.opportunityId));
    const second = await saveMatrixReport({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, actor: actor() });
    expect(second).toMatchObject({ ok: true, version: 2 });

    const v1 = await getReport(fx.orgA.organizationId, first.ok ? first.id : "");
    expect(asMatrixReport(v1!.report.body)!.coverage).toBeCloseTo(0.7);
    const v2 = await getReport(fx.orgA.organizationId, second.ok ? second.id : "");
    expect(asMatrixReport(v2!.report.body)!.coverage).toBeCloseTo(0.95);
    expect(v2!.versions.map((v) => v.version)).toEqual([2, 1]);

    expect(await latestReports(fx.orgA.organizationId, fx.orgA.opportunityId)).toEqual([expect.objectContaining({ kind: "matrix", version: 2, versions: 2 })]);
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "opportunity.report.save")));
    expect(audits).toHaveLength(2);
  });

  it("refuses another tenant's opportunity and never reads another tenant's report", async () => {
    expect(await saveMatrixReport({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgB.opportunityId, actor: actor() })).toEqual({ ok: false, error: "Opportunity not found." });
    expect(await db.select().from(opportunityReports).where(eq(opportunityReports.opportunityId, fx.orgB.opportunityId))).toHaveLength(0);
    const theirs = await saveMatrixReport({ organizationId: fx.orgB.organizationId, opportunityId: fx.orgB.opportunityId, actor: { userId: fx.orgB.userId } });
    expect(theirs.ok).toBe(true);
    expect(await getReport(fx.orgA.organizationId, theirs.ok ? theirs.id : "")).toBeNull();
    expect(await latestReports(fx.orgA.organizationId, fx.orgB.opportunityId)).toEqual([]);
    expect(await getReport(fx.orgA.organizationId, "not-a-uuid")).toBeNull();
  });

  it("gives two saves at the same moment their own versions", async () => {
    const both = await Promise.all([1, 2].map(() => saveMatrixReport({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, actor: actor() })));
    expect(both.every((r) => r.ok)).toBe(true);
    expect(both.map((r) => (r.ok ? r.version : 0)).sort()).toEqual([1, 2]);
  });

  it("needs a built and answered matrix", async () => {
    await db.update(opportunityCapabilityMatrices).set({ answers: {} }).where(eq(opportunityCapabilityMatrices.opportunityId, fx.orgA.opportunityId));
    expect(await saveMatrixReport({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, actor: actor() })).toEqual({ ok: false, error: "Answer at least one question first." });
  });
});
