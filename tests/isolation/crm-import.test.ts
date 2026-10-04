/**
 * BL-FB-X-CRM Slice 3 — importing contacts and the agency-history cache
 * against Postgres. Two tenants. Asserts: the preview marks only the
 * owning tenant's existing people as duplicates; the commit creates the
 * new ones in the owning tenant and skips or updates the duplicates
 * there, audited once; the cached procurement history is served per
 * tenant without asking USAspending, and flagged when older than a day.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agencyHistoryCache, auditLogs, customerContacts, type AgencyHistoryPayload } from "@/db/schema";
import { listContacts, saveContact } from "@/lib/crm";
import { agencyProcurementHistory, cachedAgencyHistory } from "@/lib/crm-history";
import { commitContactImport, previewContactImport } from "@/lib/crm-import";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const CSV = [
  "Name,Agency,Office,Title,Email,Next touch",
  "Ana Rivera,Department of the Navy,NAVSEA,Contracting Officer,ANA@navy.mil,2026-12-01",
  "Bo Chen,Navy,,Deputy Director,bo.chen@navy.mil,",
  "Ana  Rivera,U.S. Navy,,Program Manager,ana.other@navy.mil,",
].join("\n");

const PAYLOAD: AgencyHistoryPayload = {
  agency: "Navy",
  awards: [{ awardId: "N0001", recipientName: "Acme Federal", amount: 1_000_000, awardingSubAgency: "NAVSEA", awardType: "Definitive Contract", startDate: "2025-01-01", endDate: "2027-01-01", description: "Help desk", naicsCode: "541512", setAsideCode: "", uiUrl: "https://usaspending.gov/award/N0001" }],
  summary: { awards: 1, totalObligated: 1_000_000, topRecipients: [{ name: "Acme Federal", amount: 1_000_000, awards: 1 }], naicsMix: [{ code: "541512", amount: 1_000_000 }], endingWithinYear: 0, latestEndDate: "2027-01-01", subAgencies: ["NAVSEA"] },
  totalRecords: 1,
  naicsFiltered: true,
  matchedAs: "subagency",
};

describe("BL-FB-X-CRM Slice 3 — import and history cache", () => {
  let fx: TwoTenantFixture;
  let anaA = "";
  const actorA = { userId: "", email: "a@test" };

  beforeEach(async () => {
    fx = await createTwoTenants("crm-import");
    actorA.userId = fx.orgA.userId;
    const created = await saveContact({ organizationId: fx.orgA.organizationId, input: { agency: "Navy", name: "Ana Rivera", email: "ana@navy.mil", role: "cor" }, actor: actorA });
    expect(created.ok).toBe(true);
    if (created.ok) anaA = created.id;
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("previews against the owning tenant's contacts and imports new people there, skipping or updating duplicates", async () => {
    expect((await previewContactImport({ organizationId: fx.orgA.organizationId, text: "   " })).ok).toBe(false);
    const preview = await previewContactImport({ organizationId: fx.orgA.organizationId, text: CSV, fileName: "people.csv" });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.format).toBe("csv");
    expect(preview.summary).toEqual({ total: 3, fresh: 1, duplicates: 2, agencies: 1, skipped: 0 });
    expect(preview.rows.map((r) => [r.name, r.duplicate?.by ?? null])).toEqual([
      ["Ana Rivera", "email"],
      ["Bo Chen", null],
      ["Ana Rivera", "name"],
    ]);
    expect(preview.rows[0]!.duplicate?.existingId).toBe(anaA);
    // Tenant B has nobody yet: every row is new there.
    const previewB = await previewContactImport({ organizationId: fx.orgB.organizationId, text: CSV });
    expect(previewB.ok && previewB.summary.duplicates).toBe(0);

    const rows = preview.rows.map(({ duplicate: _d, ...r }) => r);
    expect(await commitContactImport({ organizationId: fx.orgA.organizationId, rows, duplicates: "skip", actor: actorA })).toEqual({ ok: true, created: 1, updated: 0, skipped: 2 });
    let listA = await listContacts({ organizationId: fx.orgA.organizationId });
    expect(listA.map((c) => c.name).sort()).toEqual(["Ana Rivera", "Bo Chen"]);
    expect(listA.find((c) => c.name === "Bo Chen")).toMatchObject({ agencyKey: "navy", role: "executive", email: "bo.chen@navy.mil" });
    expect(await listContacts({ organizationId: fx.orgB.organizationId })).toEqual([]);

    // Importing the same file again with "update": everyone is known now; the file fills what it has.
    expect(await commitContactImport({ organizationId: fx.orgA.organizationId, rows, duplicates: "update", actor: actorA })).toEqual({ ok: true, created: 0, updated: 3, skipped: 0 });
    listA = await listContacts({ organizationId: fx.orgA.organizationId });
    expect(listA).toHaveLength(2);
    const [ana] = await db.select({ title: customerContacts.title, office: customerContacts.office, email: customerContacts.email, role: customerContacts.role, nextTouchAt: customerContacts.nextTouchAt }).from(customerContacts).where(and(eq(customerContacts.id, anaA), eq(customerContacts.organizationId, fx.orgA.organizationId)));
    // Two rows matched Ana; the later one (by name) wrote last.
    expect(ana).toMatchObject({ office: "NAVSEA", title: "Program Manager", email: "ana.other@navy.mil", role: "program_manager" });
    expect(ana!.nextTouchAt?.toISOString().slice(0, 10)).toBe("2026-12-01");

    expect((await commitContactImport({ organizationId: fx.orgA.organizationId, rows: [{ name: "Nobody" }], duplicates: "skip", actor: actorA })).ok).toBe(false);
    const audits = await db.select({ action: auditLogs.action, metadata: auditLogs.metadata }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    const imports = audits.filter((a) => a.action === "crm.contact.import");
    expect(imports).toHaveLength(2);
    expect(imports[0]!.metadata).toMatchObject({ rows: 3, created: 1, skipped: 2 });
  });

  it("serves the cached procurement history per tenant without asking USAspending, and flags a stale answer", async () => {
    const flag = process.env.AWARDS_INTEL_ENABLED;
    process.env.AWARDS_INTEL_ENABLED = "1";
    try {
      expect(await cachedAgencyHistory({ organizationId: fx.orgA.organizationId, agency: "Department of the Navy" })).toBeNull();
      await db.insert(agencyHistoryCache).values({ organizationId: fx.orgA.organizationId, agencyKey: "navy", agency: "Navy", payload: PAYLOAD, fetchedAt: new Date() });

      const hit = await cachedAgencyHistory({ organizationId: fx.orgA.organizationId, agency: "U.S. Navy" });
      expect(hit).toMatchObject({ ok: true, cached: true, stale: false, agency: "Navy", totalRecords: 1 });
      expect(await cachedAgencyHistory({ organizationId: fx.orgB.organizationId, agency: "Navy" })).toBeNull();
      expect(await cachedAgencyHistory({ organizationId: fx.orgA.organizationId, agency: "Army" })).toBeNull();

      // A fresh cache answers the full lookup too, with no external call.
      const live = await agencyProcurementHistory({ organizationId: fx.orgA.organizationId, agency: "Navy", actor: actorA });
      expect(live).toMatchObject({ ok: true, cached: true, stale: false, matchedAs: "subagency" });
      if (live.ok) expect(live.summary.topRecipients[0]?.name).toBe("Acme Federal");

      await db.update(agencyHistoryCache).set({ fetchedAt: new Date(Date.now() - 2 * 24 * 3_600_000) }).where(and(eq(agencyHistoryCache.organizationId, fx.orgA.organizationId), eq(agencyHistoryCache.agencyKey, "navy")));
      expect(await cachedAgencyHistory({ organizationId: fx.orgA.organizationId, agency: "Navy" })).toMatchObject({ ok: true, cached: true, stale: true });

      delete process.env.AWARDS_INTEL_ENABLED;
      expect(await cachedAgencyHistory({ organizationId: fx.orgA.organizationId, agency: "Navy" })).toBeNull();
      expect(await agencyProcurementHistory({ organizationId: fx.orgA.organizationId, agency: "Navy", actor: actorA })).toMatchObject({ ok: false, disabled: true });
    } finally {
      if (flag === undefined) delete process.env.AWARDS_INTEL_ENABLED;
      else process.env.AWARDS_INTEL_ENABLED = flag;
    }
  });
});
