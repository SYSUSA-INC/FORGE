import { describe, expect, it } from "vitest";
import {
  acceptCompanyModel,
  companyModelChanges,
  emptyCompanyModel,
  linesToList,
  sanitizeCompanyModelBody,
  type CompanyModelBody,
} from "@/lib/company-model";
import { buildCompanyModelPrompt } from "@/lib/company-model-prompt";

const body = (over: Partial<CompanyModelBody> = {}): CompanyModelBody => ({ ...emptyCompanyModel(), ...over });

describe("acceptCompanyModel", () => {
  it("keeps only evidence the build showed, downgrades proven without evidence, and trims NAICS to listed codes", () => {
    const out = acceptCompanyModel({
      parsed: body({
        capabilities: [
          { name: "ITSM migration", description: "ServiceNow", strength: "proven", evidence: ["pp:p1", "knowledge:nope", "pp:p1"] },
          { name: "Cloud", description: "", strength: "proven", evidence: ["proposal:x"] },
          { name: "", description: "dropped", strength: "partial", evidence: [] },
        ],
        naicsWork: [
          { code: "541512", whatWeDo: "ITSM" },
          { code: "NAICS 541519", whatWeDo: "support" },
          { code: "999999", whatWeDo: "not ours" },
          { code: "541512", whatWeDo: "" },
        ],
        keywords: ["ITSM", "itsm", "", "ServiceNow"],
        differentiators: ["", "Cleared staff"],
      }),
      allowedEvidence: new Map([["pp:p1", { kind: "past_performance", label: "DHS — ITSM" }]]),
      naicsCodes: new Set(["541512", "541519"]),
    });
    expect(out.capabilities).toHaveLength(2);
    expect(out.capabilities[0]).toMatchObject({ strength: "proven", evidence: ["pp:p1"] });
    expect(out.capabilities[1]).toMatchObject({ strength: "unproven", evidence: [] });
    expect(out.naicsWork).toEqual([
      { code: "541512", whatWeDo: "ITSM" },
      { code: "541519", whatWeDo: "support" },
    ]);
    expect(out.keywords).toEqual(["ITSM", "ServiceNow"]);
    expect(out.differentiators).toEqual(["Cleared staff"]);
  });
});

describe("sanitizeCompanyModelBody", () => {
  it("accepts a well-formed edit, drops blanks, and rejects an oversized field", () => {
    const ok = sanitizeCompanyModelBody(body({ summary: "  We do ITSM.  ", capabilities: [{ name: "X", description: "", strength: "partial", evidence: ["", "pp:1"] }], keywords: ["a", "a", ""] }));
    expect(ok?.summary).toBe("We do ITSM.");
    expect(ok?.capabilities[0]?.evidence).toEqual(["pp:1"]);
    expect(ok?.keywords).toEqual(["a"]);
    expect(sanitizeCompanyModelBody(body({ summary: "x".repeat(2_001) }))).toBeNull();
    expect(sanitizeCompanyModelBody({ summary: "no lists" })).toBeNull();
  });
});

describe("companyModelChanges and linesToList", () => {
  it("counts differing sections and splits lines", () => {
    const a = body({ summary: "a", keywords: ["k"] });
    expect(companyModelChanges(a, a)).toBe(0);
    expect(companyModelChanges(a, body({ summary: "b", keywords: ["k"], gaps: ["g"] }))).toBe(2);
    expect(companyModelChanges(null, a)).toBe(8);
    expect(linesToList(" one \n\n two \nthree", 2)).toEqual(["one", "two"]);
  });
});

describe("buildCompanyModelPrompt", () => {
  it("shows every evidence id with its prefix and asks for a revision when a model is approved", () => {
    const p = buildCompanyModelPrompt({
      organization: { name: "Acme", website: "", state: "VA", primaryNaics: "541512", naicsList: ["541512"], pscCodes: [], setAsides: ["SDVOSB"], vehicles: [], companySecurityLevel: "Secret", employeeSecurityLevel: "None", dcaaCompliant: false, keywords: [] },
      pastPerformance: [{ id: "p1", customer: "DHS", contract: "ITSM", value: "", periodStart: "", periodEnd: "", description: "Migrated 32 workflows." }],
      knowledgeEntries: [{ id: "k1", kind: "capability", title: "Cloud", body: "text", tags: [] }],
      pursuits: [{ proposalId: "pr1", title: "VA pilot", outcome: "lost", agency: "VA", naicsCode: "541512", reasons: ["price"], awardedTo: "Rival", decidedAt: "2026-01-02" }],
      questionnaireAnswers: [{ opportunityId: "o1", opportunityTitle: "Opp", questionId: "s2", question: "Clearances?", value: "Have it, proven", evidence: "FCL" }],
      approved: null,
    });
    const text = p.messages[0]!.content;
    for (const id of ["pp:p1", "knowledge:k1", "proposal:pr1", "questionnaire:o1:s2", "LOST", "reasons: price", "awarded to Rival", "SDVOSB"]) expect(text).toContain(id);
    expect(p.system).not.toContain("approved model exists");
    const revised = buildCompanyModelPrompt({ ...JSON.parse(JSON.stringify({ organization: { name: "Acme", website: "", state: "", primaryNaics: "", naicsList: [], pscCodes: [], setAsides: [], vehicles: [], companySecurityLevel: "", employeeSecurityLevel: "", dcaaCompliant: false, keywords: [] }, pastPerformance: [], knowledgeEntries: [], pursuits: [], questionnaireAnswers: [] })), approved: "{\"summary\":\"old\"}" });
    expect(revised.system).toContain("approved model exists");
    expect(revised.messages[0]!.content).toContain("Approved model to revise");
  });
});
