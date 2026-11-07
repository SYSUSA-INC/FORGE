/**
 * BL-NAV-LIFECYCLE 3a-2 — the partner database search against Postgres,
 * two tenants, USAspending and SAM.gov stubbed: the sources join by UEI,
 * only the searching organization's Companies and partners annotate the
 * hits, the search is recorded as a read, a source that is off is named,
 * and Add puts the firm in Companies (from SAM.gov, or from the search's
 * facts when SAM.gov can't be reached) and on the opportunity, never on
 * another tenant's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, certFirms, companies, opportunities, opportunityPartners } from "@/db/schema";
import type { UsaspendingSearchResult } from "@/lib/usaspending";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const awardsCalls: unknown[] = [];
let awardsAnswer: UsaspendingSearchResult = { ok: true, awards: [], totalRecords: 0 };
vi.mock("@/lib/usaspending", async (orig) => ({
  ...(await orig<typeof import("@/lib/usaspending")>()),
  searchAwardsByCriteria: vi.fn(async (c: unknown) => {
    awardsCalls.push(c);
    return awardsAnswer;
  }),
}));

let samFails = false;
vi.mock("@/lib/samgov", async (orig) => {
  const real = await orig<typeof import("@/lib/samgov")>();
  return {
    ...real,
    searchSamGovEntities: vi.fn(async () =>
      samFails
        ? { ok: false, cls: "network", error: "SAM.gov timed out." }
        : {
            ok: true,
            totalRecords: 1,
            entities: [
              {
                ueiSAM: "SAMONLY00001",
                legalBusinessName: "Sam Only LLC",
                cageCode: "1ABC2",
                registrationStatus: "Active",
                registrationExpirationDate: "2027-05-01",
                physicalAddressCity: "Reston",
                physicalAddressStateOrProvinceCode: "VA",
                physicalAddressCountryCode: "USA",
                primaryNaics: "541512",
                sbaCertifications: ["8(a) Program Participant"],
              },
            ],
          },
    ),
    fetchSamGovByUei: vi.fn(async (_cred: unknown, uei: string) =>
      samFails
        ? { ok: false, cls: "network", error: "SAM.gov timed out." }
        : {
            ok: true,
            profile: {
              name: "Sam Only LLC",
              uei,
              cageCode: "1ABC2",
              dunsNumber: "",
              website: "",
              contactName: "",
              contactTitle: "",
              phone: "",
              email: "",
              address: { line1: "1 Main St", line2: "", city: "Reston", state: "VA", zip: "20190", country: "USA" },
              primaryNaics: "541512",
              naicsList: ["541512"],
              sbaDescriptions: ["8(a) Program Participant"],
              registrationStatus: "Active",
              registrationExpirationDate: "2027-05-01",
            },
          },
    ),
  };
});

import { addPartnerFromSearch, searchPartners } from "@/lib/partner-search";

const CERT_UEIS = ["HARB0R123456", "CERTONLY0001", "WIDECERT0001"];

describe("BL-NAV-LIFECYCLE 3a-2 — the partner database search", () => {
  let fx: TwoTenantFixture;

  beforeEach(async () => {
    fx = await createTwoTenants("partner-search");
    vi.stubEnv("SAMGOV_API_KEY", "SHAREDKEY0123456789");
    vi.stubEnv("AWARDS_INTEL_ENABLED", "1");
    samFails = false;
    awardsCalls.length = 0;
    awardsAnswer = {
      ok: true,
      totalRecords: 1,
      awards: [
        {
          awardId: "VA-1",
          recipientName: "HARBOR CYBER LLC",
          recipientUei: "HARB0R123456",
          amount: 2_000_000,
          awardingAgency: "Department of Veterans Affairs",
          awardingSubAgency: "Veterans Health Administration",
          awardType: "D",
          startDate: "2023-01-01",
          endDate: "2027-01-01",
          description: "",
          naicsCode: "541512",
          pscCode: "",
          setAsideCode: "SDVOSBC",
          uiUrl: "https://www.usaspending.gov/award/VA-1",
        },
      ],
    };
    for (const t of [fx.orgA, fx.orgB]) {
      await db.update(opportunities).set({ naicsCode: "541512", agency: "Department of Veterans Affairs", setAside: "SDVOSB Set-Aside" }).where(eq(opportunities.id, t.opportunityId));
    }
    await db.insert(certFirms).values([
      { uei: "HARB0R123456", certType: "sdvosb", firmName: "HARBOR CYBER LLC", naicsPrimary: "541512", city: "Norfolk", state: "VA" },
      { uei: "CERTONLY0001", certType: "8a", firmName: "Cert Only Inc", naicsPrimary: "541512", city: "Austin", state: "TX", certExitDate: new Date("2020-01-01") },
    ]);
    // The other tenant knows Harbor; that must not show for the first.
    await db.insert(companies).values({ organizationId: fx.orgB.organizationId, name: "Harbor (theirs)", uei: "HARB0R123456", relationship: "teaming_partner" });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.delete(certFirms).where(inArray(certFirms.uei, CERT_UEIS));
    await fx.cleanup();
  });

  const actor = () => ({ userId: fx.orgA.userId, email: null });
  const a = () => ({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, actor: actor() });

  it("joins USAspending, current certifications and SAM.gov by UEI, annotated with this organization's own records only", async () => {
    const res = await searchPartners(a());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.criteria).toMatchObject({ naics: "541512", need: "sdvosb" });
    expect(res.notes).toEqual([]);
    // A certification that ended (Cert Only, 2020) isn't current.
    expect(res.hits.map((h) => h.uei)).toEqual(["HARB0R123456", "SAMONLY00001"]);
    const harbor = res.hits[0]!;
    expect(harbor).toMatchObject({ name: "HARBOR CYBER LLC", certs: ["sdvosb"], keepsSetAside: true, company: null });
    expect(harbor.awards).toMatchObject({ awards: 1, atAgency: 1 });
    expect(res.hits[1]!).toMatchObject({ certs: ["8a"], keepsSetAside: false, sam: { cage: "1ABC2" } });
    // Two NAICS pages and the agency's own.
    expect(awardsCalls.length).toBeGreaterThanOrEqual(3);
    const [read] = await db.select({ action: auditLogs.action, metadata: auditLogs.metadata }).from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "opportunity.partner.search")));
    expect(read?.metadata).toMatchObject({ category: "read", naics: "541512", hits: 2 });
    expect(await searchPartners({ ...a(), opportunityId: fx.orgB.opportunityId })).toEqual({ ok: false, error: "Opportunity not found." });
  });

  it("names a source that is off or failing, and the others still answer", async () => {
    vi.stubEnv("AWARDS_INTEL_ENABLED", "");
    samFails = true;
    const res = await searchPartners(a());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(awardsCalls).toHaveLength(0);
    expect(res.notes.join(" ")).toMatch(/USAspending is off/);
    expect(res.notes.join(" ")).toMatch(/SAM\.gov didn't answer/);
    expect(res.hits.map((h) => h.uei)).toEqual(["HARB0R123456"]);
  });

  it("adds a firm into Companies from SAM.gov and onto the opportunity, once", async () => {
    const res = await addPartnerFromSearch({ ...a(), uei: "samonly00001", name: "Sam Only LLC", relationship: "subcontractor", reason: "Registered and active in SAM.gov" });
    expect(res).toMatchObject({ ok: true, fromSam: true });
    const [co] = await db.select().from(companies).where(and(eq(companies.organizationId, fx.orgA.organizationId), eq(companies.uei, "SAMONLY00001")));
    expect(co).toMatchObject({ relationship: "subcontractor", syncSource: "samgov", city: "Reston" });
    const again = await addPartnerFromSearch({ ...a(), uei: "SAMONLY00001", name: "x", relationship: "teaming_partner", reason: "" });
    expect(again).toMatchObject({ ok: true, companyId: co!.id, fromSam: false });
    const partners = await db.select({ source: opportunityPartners.source, reason: opportunityPartners.reason }).from(opportunityPartners).where(eq(opportunityPartners.opportunityId, fx.orgA.opportunityId));
    expect(partners).toEqual([{ source: "search", reason: "Registered and active in SAM.gov" }]);
    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    expect(audits.map((x) => x.action)).toEqual(expect.arrayContaining(["company.import_samgov", "opportunity.partner.add"]));
  });

  it("writes the company from the search's facts when SAM.gov can't be reached, and never touches another tenant", async () => {
    samFails = true;
    const res = await addPartnerFromSearch({ ...a(), uei: "HARB0R123456", name: "HARBOR CYBER LLC", city: "Norfolk", state: "va", relationship: "teaming_partner", reason: "SDVOSB" });
    expect(res).toMatchObject({ ok: true, fromSam: false });
    const [co] = await db.select().from(companies).where(and(eq(companies.organizationId, fx.orgA.organizationId), eq(companies.uei, "HARB0R123456")));
    expect(co).toMatchObject({ name: "HARBOR CYBER LLC", state: "VA", syncSource: "partner_search" });
    expect(co!.notes).toMatch(/SAM\.gov couldn't be reached/);
    // The other tenant's Harbor is untouched and unused.
    expect(await db.select().from(companies).where(eq(companies.uei, "HARB0R123456"))).toHaveLength(2);
    expect(await addPartnerFromSearch({ ...a(), opportunityId: fx.orgB.opportunityId, uei: "HARB0R123456", name: "x", relationship: "teaming_partner", reason: "" })).toEqual({ ok: false, error: "Opportunity not found." });
    expect(await addPartnerFromSearch({ ...a(), uei: "not-a-uei", name: "x", relationship: "teaming_partner", reason: "" })).toEqual({ ok: false, error: "That isn't a UEI." });
    expect(await db.select().from(opportunityPartners).where(eq(opportunityPartners.opportunityId, fx.orgB.opportunityId))).toHaveLength(0);
  });

  it("Find more widens to the NAICS family and drops the state", async () => {
    await db.insert(certFirms).values({ uei: "WIDECERT0001", certType: "sdvosb", firmName: "Wide Cert Inc", naicsPrimary: "541511", city: "Austin", state: "TX" });
    const narrow = await searchPartners({ ...a(), state: "VA" });
    expect(narrow.ok && narrow.hits.map((h) => h.uei)).not.toContain("WIDECERT0001");
    expect(narrow.ok && narrow.criteria.widened).toBe(false);
    awardsCalls.length = 0;
    const wide = await searchPartners({ ...a(), state: "VA", widen: true });
    expect(wide.ok).toBe(true);
    if (!wide.ok) return;
    expect(wide.criteria).toMatchObject({ naics: "5415 (family)", widened: true });
    expect(wide.hits.map((h) => h.uei)).toContain("WIDECERT0001");
    expect(awardsCalls.every((c) => JSON.stringify((c as { naicsCodes?: string[] }).naicsCodes ?? ["5415"]) === JSON.stringify(["5415"]))).toBe(true);
    expect(wide.hits.find((h) => h.uei === "HARB0R123456")?.facts[0]).toContain("NAICS 5415 (family)");
  });
});
