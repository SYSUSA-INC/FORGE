/**
 * BL-FB-X-CRM Slice 4 — the nightly agency refresh against Postgres, with
 * USAspending stubbed: it refreshes the agencies each tenant has contacts
 * at, caches each answer under that tenant, leaves a fresh cache alone,
 * records the read in the owning tenant's log, and does nothing while
 * awards intel is off.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agencyHistoryCache, auditLogs, customerContacts } from "@/db/schema";
import { agencyKey } from "@/lib/crm-logic";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const calls: string[] = [];
vi.mock("@/lib/usaspending", () => ({
  searchAwardsByCriteria: async (c: { awardingSubAgencyName?: string; awardingAgencyName?: string }) => {
    calls.push(c.awardingSubAgencyName ?? c.awardingAgencyName ?? "");
    return {
      ok: true,
      totalRecords: 1,
      awards: [
        {
          awardId: "W1",
          recipientName: "Acme Federal",
          recipientUei: "",
          amount: 1_000_000,
          awardingAgency: "Agency",
          awardingSubAgency: "Sub",
          awardType: "Definitive Contract",
          startDate: "2026-01-01",
          endDate: null,
          description: "Help desk",
          naicsCode: "541512",
          pscCode: "D302",
          setAsideCode: "",
          uiUrl: "https://example.test/award/W1",
        },
      ],
    };
  },
}));

import { refreshWatchedAgencies } from "@/lib/crm-history";

describe("BL-FB-X-CRM — nightly refresh of watched agencies", () => {
  let fx: TwoTenantFixture;
  const tag = Date.now().toString(36);
  const va = `Veterans Bureau ${tag}`;
  const gsa = `Supply Office ${tag}`;
  const nasa = `Space Office ${tag}`;
  let flag: string | undefined;

  beforeEach(async () => {
    fx = await createTwoTenants("crm-refresh");
    flag = process.env.AWARDS_INTEL_ENABLED;
    calls.length = 0;
    const contact = (organizationId: string, agency: string, name: string) => ({ organizationId, agency, agencyKey: agencyKey(agency), name });
    await db.insert(customerContacts).values([
      contact(fx.orgA.organizationId, va, "Ana One"),
      contact(fx.orgA.organizationId, va, "Ana Two"),
      contact(fx.orgA.organizationId, gsa, "Gus"),
      contact(fx.orgB.organizationId, nasa, "Nia"),
    ]);
    // A's supply office was looked up an hour ago: fresh, left alone.
    await db.insert(agencyHistoryCache).values({
      organizationId: fx.orgA.organizationId,
      agencyKey: agencyKey(gsa),
      agency: gsa,
      payload: { agency: gsa, awards: [], summary: { total: 0, count: 0, topRecipients: [], setAsides: [], recentCount: 0 }, totalRecords: 0, naicsFiltered: false, matchedAs: "agency" } as never,
      fetchedAt: new Date(Date.now() - 3_600_000),
    });
  });

  afterEach(async () => {
    if (flag === undefined) delete process.env.AWARDS_INTEL_ENABLED;
    else process.env.AWARDS_INTEL_ENABLED = flag;
    await fx.cleanup();
  });

  it("refreshes each tenant's watched agencies under that tenant, once, and skips fresh ones", async () => {
    delete process.env.AWARDS_INTEL_ENABLED;
    expect(await refreshWatchedAgencies({ limit: 1000 })).toEqual({ disabled: true, candidates: 0, refreshed: 0, failed: 0 });
    expect(calls).toEqual([]);

    process.env.AWARDS_INTEL_ENABLED = "1";
    const res = await refreshWatchedAgencies({ limit: 1000 });
    expect(res.refreshed).toBeGreaterThanOrEqual(2);

    const cacheOf = async (organizationId: string, agency: string) =>
      (await db.select({ fetchedAt: agencyHistoryCache.fetchedAt }).from(agencyHistoryCache).where(and(eq(agencyHistoryCache.organizationId, organizationId), eq(agencyHistoryCache.agencyKey, agencyKey(agency)))))[0];
    expect(await cacheOf(fx.orgA.organizationId, va)).toBeTruthy();
    expect(await cacheOf(fx.orgB.organizationId, nasa)).toBeTruthy();
    // Never cross-cached.
    expect(await cacheOf(fx.orgB.organizationId, va)).toBeUndefined();
    expect(await cacheOf(fx.orgA.organizationId, nasa)).toBeUndefined();
    // The fresh one wasn't asked about.
    expect(calls.some((c) => c.includes("Supply Office"))).toBe(false);

    const reads = await db
      .select({ resourceId: auditLogs.resourceId, actor: auditLogs.actorEmailSnapshot })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "crm.agency.history")));
    expect(reads).toEqual([{ resourceId: va, actor: "cron:crm-agency-refresh" }]);

    // A second run the same night finds everything fresh.
    calls.length = 0;
    await refreshWatchedAgencies({ limit: 1000 });
    expect(calls.some((c) => c.includes(tag))).toBe(false);
  });
});
