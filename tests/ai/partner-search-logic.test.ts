/**
 * BL-NAV-LIFECYCLE 3a-2 — the partner database's join and order: awards
 * grouped by UEI (once each, at the agency counted), the sources joined
 * by UEI with the organization's own UEI left out, filters, the set-aside
 * read only where the registry can say, and facts that name their source.
 */
import { describe, expect, it } from "vitest";
import {
  aggregateRecipients,
  certsFromSamDescriptions,
  formatMoney,
  keepsSetAside,
  mergePartnerHits,
  reasonFromFacts,
  setAsideNeed,
  type AwardInput,
} from "@/lib/partner-search-logic";

const award = (o: Partial<AwardInput>): AwardInput => ({
  awardId: "A1",
  recipientName: "Harbor Cyber LLC",
  recipientUei: "HARB0R123456",
  amount: 1_000_000,
  awardingAgency: "Department of Veterans Affairs",
  awardingSubAgency: "Veterans Health Administration",
  endDate: "2027-01-31",
  uiUrl: "https://www.usaspending.gov/award/A1",
  ...o,
});

describe("set-aside", () => {
  it("reads the wording the PWin model reads, and never guesses", () => {
    expect(setAsideNeed("Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside")).toBe("sdvosb");
    expect(setAsideNeed("8(a) Sole Source")).toBe("8a");
    expect(setAsideNeed("Economically Disadvantaged WOSB")).toBe("edwosb");
    expect(setAsideNeed("Women-Owned Small Business")).toBe("wosb");
    expect(setAsideNeed("HUBZone Set-Aside")).toBe("hubzone");
    expect(setAsideNeed("Total Small Business Set-Aside")).toBe("small");
    expect(setAsideNeed("Full and open")).toBeNull();
    expect(setAsideNeed("")).toBeNull();
    expect(setAsideNeed("Local area")).toBeNull();
  });

  it("says the set-aside is kept only when the registry can tell", () => {
    expect(keepsSetAside("sdvosb", ["sdvosb"])).toBe(true);
    expect(keepsSetAside("sdvosb", ["8a"])).toBe(false);
    expect(keepsSetAside("wosb", ["edwosb"])).toBe(true);
    expect(keepsSetAside("vob", ["sdvosb"])).toBe(true);
    expect(keepsSetAside("small", ["hubzone"])).toBe(true);
    expect(keepsSetAside("small", [])).toBeNull();
    expect(keepsSetAside(null, ["8a"])).toBeNull();
  });

  it("maps SAM.gov's SBA descriptions to certifications", () => {
    expect(certsFromSamDescriptions(["8(a) Program Participant", "SBA Certified HUBZone Firm"]).sort()).toEqual(["8a", "hubzone"]);
    expect(certsFromSamDescriptions(["SBA Certified Economically Disadvantaged Women-Owned Small Business"])).toEqual(["edwosb"]);
    expect(certsFromSamDescriptions(["Service-Disabled Veteran-Owned Small Business"])).toEqual(["sdvosb"]);
    expect(certsFromSamDescriptions(["Something else"])).toEqual([]);
  });
});

describe("aggregateRecipients", () => {
  it("counts each award once, and those at the agency (department or sub-agency)", () => {
    const m = aggregateRecipients(
      [
        award({}),
        award({}), // the same award from the agency search
        award({ awardId: "A2", amount: 4_000_000, awardingAgency: "Department of Defense", awardingSubAgency: "U.S. Army" }),
        award({ awardId: "A3", recipientUei: "keys70n12345", recipientName: "Keystone", amount: 500_000, awardingSubAgency: "VA" }),
        award({ awardId: "A4", recipientUei: "" }),
      ],
      "Department of Veterans Affairs",
    );
    expect([...m.keys()].sort()).toEqual(["HARB0R123456", "KEYS70N12345"]);
    const h = m.get("HARB0R123456")!;
    expect(h).toMatchObject({ awards: 2, value: 5_000_000, atAgency: 1, atAgencyValue: 1_000_000 });
    expect(h.top.map((t) => t.awardId)).toEqual(["A2", "A1"]);
    expect(m.get("KEYS70N12345")!.atAgency).toBe(1);
  });
});

describe("mergePartnerHits", () => {
  const base = () => ({
    recipients: aggregateRecipients(
      [
        award({}),
        award({ awardId: "A2", recipientUei: "BIGFIRM00001", recipientName: "Big Firm", amount: 90_000_000, awardingAgency: "Department of Defense", awardingSubAgency: "U.S. Army" }),
        award({ awardId: "A3", recipientUei: "OURUEI000001", recipientName: "Us", amount: 50_000_000 }),
      ],
      "Department of Veterans Affairs",
    ),
    certs: [
      { uei: "harb0r123456", name: "HARBOR CYBER LLC", certType: "sdvosb", city: "Norfolk", state: "VA", naics: "541512" },
      { uei: "CERTONLY0001", name: "Cert Only Inc", certType: "8a", city: "Austin", state: "TX", naics: "541512" },
    ],
    sam: [{ uei: "SAMONLY00001", name: "Sam Only LLC", cage: "1ABC2", city: "Reston", state: "VA", naics: "541512", expires: "2027-05-01", certs: [] }],
    companies: [{ id: "c-harbor", uei: "HARB0R123456", name: "Harbor Cyber", relationship: "teaming_partner" as const }],
    consideredCompanyIds: new Set<string>(),
    ownUei: "ouruei000001",
    need: "sdvosb" as const,
    naics: "541512",
    agency: "Department of Veterans Affairs",
  });

  it("joins the sources by UEI, leaves our own UEI out, and puts the agency record first", () => {
    const hits = mergePartnerHits(base());
    expect(hits.map((h) => h.uei)).toEqual(["HARB0R123456", "BIGFIRM00001", "CERTONLY0001", "SAMONLY00001"]);
    const harbor = hits[0]!;
    expect(harbor).toMatchObject({ name: "Harbor Cyber", city: "Norfolk", state: "VA", certs: ["sdvosb"], keepsSetAside: true, company: { id: "c-harbor" }, considered: false });
    expect(harbor.sources).toEqual(["usaspending", "certifications", "companies"]);
    expect(harbor.facts).toEqual([
      "1 contract award under NAICS 541512 in the last 5 years, $1.0M (USAspending)",
      "1 at Department of Veterans Affairs, $1.0M (USAspending)",
      "SDVOSB (SBA certification registry)",
      "In your Companies as a teaming partner",
    ]);
    expect(hits[3]!.facts).toEqual(["Registered and active in SAM.gov, CAGE 1ABC2, until 2027-05-01"]);
    expect(hits.find((h) => h.uei === "CERTONLY0001")!.keepsSetAside).toBe(false);
  });

  it("filters by state (a firm with no location on record stays) and by certification", () => {
    const tx = mergePartnerHits({ ...base(), filters: { state: "tx" } });
    expect(tx.map((h) => h.uei)).toEqual(["BIGFIRM00001", "CERTONLY0001"]);
    expect(tx[0]!.state).toBe("");
    expect(mergePartnerHits({ ...base(), filters: { cert: "8a" } }).map((h) => h.uei)).toEqual(["CERTONLY0001"]);
  });

  it("marks a company already on the opportunity, and caps the list", () => {
    const hits = mergePartnerHits({ ...base(), consideredCompanyIds: new Set(["c-harbor"]), limit: 2 });
    expect(hits).toHaveLength(2);
    expect(hits[0]!.considered).toBe(true);
  });

  it("keeps the first two facts as the reason, and formats money", () => {
    expect(reasonFromFacts(["a", "b", "c"])).toBe("a; b");
    expect([formatMoney(950), formatMoney(12_500), formatMoney(3_250_000), formatMoney(2_100_000_000)]).toEqual(["$950", "$13K", "$3.3M", "$2.1B"]);
  });
});
