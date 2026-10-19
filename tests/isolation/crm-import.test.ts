/**
 * BL-FB-X-CRM Slice 3 — importing contacts and the agency-history cache
 * against Postgres. Two tenants. Asserts: the preview marks only the
 * owning tenant's existing people as duplicates; the commit creates the
 * new ones in the owning tenant and skips or updates the duplicates
 * there, audited once per call (BL-STAB-2f: with the import's id and
 * part when it arrives in parts); rows from the browser are re-checked;
 * the cached procurement history is served per tenant without asking
 * USAspending, and flagged when older than a day.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agencyHistoryCache, auditLogs, customerContacts, type AgencyHistoryPayload } from "@/db/schema";
import { listContacts, saveContact } from "@/lib/crm";
import { agencyProcurementHistory, cachedAgencyHistory } from "@/lib/crm-history";
import { commitContactImport, findImportDuplicates } from "@/lib/crm-import";
import { dedupeWithinImport, parseImport } from "@/lib/crm-import-logic";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const sessionUserStub = { id: "PLACEHOLDER", email: "a@test", name: "Capture Lead", image: null as null, isSuperadmin: false as const, organizationId: "PLACEHOLDER", role: "admin" as const };
vi.mock("@/lib/auth-helpers", () => ({
  requireAuth: async () => sessionUserStub,
  requireCurrentOrg: async () => ({ user: sessionUserStub, organizationId: sessionUserStub.organizationId, isImpersonating: false }),
  getSessionUser: async () => sessionUserStub,
}));

import { commitContactImportAction } from "@/app/(app)/contacts/actions";

// Ana is known by email; Dee is known by agency and name (no email on file); Bo is new.
const CSV = [
  "Name,Agency,Office,Title,Email,Next touch",
  "Ana Rivera,Department of the Navy,NAVSEA,Contracting Officer,ANA@navy.mil,2026-12-01",
  "Bo Chen,Navy,,Deputy Director,bo.chen@navy.mil,",
  "Dee  Park,U.S. Navy,PEO IWS,Program Manager,dee.park@navy.mil,",
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
    expect((await saveContact({ organizationId: fx.orgA.organizationId, input: { agency: "Department of the Navy", name: "Dee Park", role: "technical" }, actor: actorA })).ok).toBe(true);
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("previews against the owning tenant's contacts and imports new people there, skipping or updating duplicates", async () => {
    // The browser parses the file and asks only who is already known.
    const parsed = parseImport(CSV, "people.csv");
    expect(parsed.format).toBe("csv");
    const { rows } = dedupeWithinImport(parsed.rows);
    const people = rows.map(({ name, agency, email }) => ({ name, agency, email }));
    // One answer per person, in order (someone who can't be a contact gets none).
    const check = await findImportDuplicates({ organizationId: fx.orgA.organizationId, people: [{ name: "No agency" }, ...people] });
    if (!check.ok) throw new Error(check.error);
    expect(check.matches.map((m) => m?.by ?? null)).toEqual([null, "email", null, "name"]);
    expect(check.matches[1]!.existingId).toBe(anaA);
    // Tenant B has nobody yet: every row is new there.
    const checkB = await findImportDuplicates({ organizationId: fx.orgB.organizationId, people });
    expect(checkB.ok && checkB.matches.every((m) => m === null)).toBe(true);

    expect(await commitContactImport({ organizationId: fx.orgA.organizationId, rows, duplicates: "skip", actor: actorA })).toEqual({ ok: true, created: 1, updated: 0, skipped: 2 });
    let listA = await listContacts({ organizationId: fx.orgA.organizationId });
    expect(listA.map((c) => c.name).sort()).toEqual(["Ana Rivera", "Bo Chen", "Dee Park"]);
    expect(listA.find((c) => c.name === "Bo Chen")).toMatchObject({ agencyKey: "navy", role: "executive", email: "bo.chen@navy.mil" });
    // Skipped means untouched: Dee still has no email.
    expect(listA.find((c) => c.name === "Dee Park")).toMatchObject({ email: "", role: "technical" });
    expect(await listContacts({ organizationId: fx.orgB.organizationId })).toEqual([]);

    // Importing the same file again with "update": everyone is known now; the file fills what it has.
    expect(await commitContactImport({ organizationId: fx.orgA.organizationId, rows, duplicates: "update", actor: actorA })).toEqual({ ok: true, created: 0, updated: 3, skipped: 0 });
    listA = await listContacts({ organizationId: fx.orgA.organizationId });
    expect(listA).toHaveLength(3);
    expect(listA.find((c) => c.name === "Dee Park")).toMatchObject({ email: "dee.park@navy.mil", role: "program_manager", title: "Program Manager", office: "PEO IWS" });
    const [ana] = await db.select({ title: customerContacts.title, office: customerContacts.office, email: customerContacts.email, role: customerContacts.role, nextTouchAt: customerContacts.nextTouchAt }).from(customerContacts).where(and(eq(customerContacts.id, anaA), eq(customerContacts.organizationId, fx.orgA.organizationId)));
    expect(ana).toMatchObject({ office: "NAVSEA", title: "Contracting Officer", email: "ana@navy.mil", role: "contracting_officer" });
    expect(ana!.nextTouchAt?.toISOString().slice(0, 10)).toBe("2026-12-01");

    expect((await commitContactImport({ organizationId: fx.orgA.organizationId, rows: [{ name: "Nobody" }], duplicates: "skip", actor: actorA })).ok).toBe(false);
    const audits = await db.select({ action: auditLogs.action, metadata: auditLogs.metadata }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    const imports = audits.filter((a) => a.action === "crm.contact.import").map((a) => a.metadata as Record<string, unknown>);
    expect(imports).toHaveLength(2);
    expect(imports.some((m) => m.rows === 3 && m.created === 1 && m.skipped === 2)).toBe(true);
    expect(imports.some((m) => m.rows === 3 && m.updated === 3 && m.duplicates === "update")).toBe(true);
  });

  it("BL-STAB-2f — rows from the browser are re-checked; a part of a larger import is audited as that part", async () => {
    const importId = crypto.randomUUID();
    const tampered = [
      // Too long, a role that isn't one, a NUL Postgres would refuse.
      { name: "Eve\u0000 Stone", agency: "Army", notes: "x".repeat(10_000), role: "superadmin" as never, line: 2 },
      // No agency: not a contact.
      { name: "Nobody", line: 3 },
    ];
    const res = await commitContactImport({ organizationId: fx.orgA.organizationId, rows: tampered, duplicates: "skip", actor: actorA, batch: { id: importId, part: 2, parts: 3 } });
    expect(res).toEqual({ ok: true, created: 1, updated: 0, skipped: 0 });
    const eve = (await listContacts({ organizationId: fx.orgA.organizationId })).find((c) => c.agency === "Army");
    expect(eve).toMatchObject({ name: "Eve Stone", role: "other" });
    const [row] = await db.select({ notes: customerContacts.notes }).from(customerContacts).where(and(eq(customerContacts.id, eve!.id), eq(customerContacts.organizationId, fx.orgA.organizationId)));
    expect(row!.notes).toHaveLength(4_000);
    const [audit] = await db.select({ metadata: auditLogs.metadata }).from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "crm.contact.import")));
    expect(audit!.metadata).toMatchObject({ rows: 1, created: 1, importId, part: 2, parts: 3 });
    // Through the action: a part label that isn't one is dropped, not stored.
    sessionUserStub.id = fx.orgA.userId;
    sessionUserStub.organizationId = fx.orgA.organizationId;
    const badId = await commitContactImportAction({ rows: [{ name: "Flo Ames", agency: "Army" }], duplicates: "skip", batch: { id: "<script>", part: 1, parts: 1 } });
    expect(badId).toEqual({ ok: true, created: 1, updated: 0, skipped: 0 });
    const badPart = await commitContactImportAction({ rows: [{ name: "Hal Inge", agency: "Army" }], duplicates: "skip", batch: { id: importId, part: 0, parts: 1 } });
    expect(badPart).toEqual({ ok: true, created: 1, updated: 0, skipped: 0 });
    const good = await commitContactImportAction({ rows: [{ name: "Gus Hale", agency: "Army" }], duplicates: "skip", batch: { id: importId, part: 3, parts: 3 } });
    expect(good).toEqual({ ok: true, created: 1, updated: 0, skipped: 0 });
    const parts = (await db.select({ metadata: auditLogs.metadata }).from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "crm.contact.import")))).map((a) => a.metadata as Record<string, unknown>);
    expect(parts.map((m) => m.part ?? null).sort()).toEqual([2, 3, null, null]);
    for (const m of parts.filter((p) => p.part === undefined)) expect(m).not.toHaveProperty("importId");

    // At most one import's worth of people is checked per call.
    const many = Array.from({ length: 600 }, (_, i) => ({ name: `P ${i}`, agency: "Army", email: "" }));
    const check = await findImportDuplicates({ organizationId: fx.orgA.organizationId, people: many });
    expect(check.ok && check.matches).toHaveLength(500);
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
