import { describe, expect, it } from "vitest";
import { emptyCompanyModel, type CompanyModelSources } from "@/lib/company-model";
import { changedSections, computeStaleReasons } from "@/lib/company-model-staleness";

const sources: CompanyModelSources = {
  knowledgeEntryIds: ["k1"],
  pastPerformanceIds: ["p1", "p2"],
  proposalIds: [],
  questionnaireOpportunityIds: [],
  outcomes: { won: 0, lost: 0 },
  registrationOnly: false,
  naicsCodes: ["541512", "541519"],
};
const quiet = { outcomesSince: 0, questionnairesSince: 0, capabilityEntriesSince: 0, currentPastPerformanceIds: ["p1", "p2"], currentNaicsCodes: ["541519", "541512"] };

describe("computeStaleReasons", () => {
  it("is empty when nothing changed, whatever the NAICS order", () => {
    expect(computeStaleReasons(sources, quiet)).toEqual([]);
  });
  it("names each kind of change with its count", () => {
    expect(
      computeStaleReasons(sources, { outcomesSince: 2, questionnairesSince: 1, capabilityEntriesSince: 3, currentPastPerformanceIds: ["p1", "p3"], currentNaicsCodes: ["541512"] }),
    ).toEqual(["2 bids decided", "1 questionnaire confirmed", "3 capability entries added or edited", "past performance changed (1 added, 1 removed)", "NAICS codes changed"]);
  });
  it("skips the NAICS check for a build that did not record codes, and the profile checks without sources", () => {
    expect(computeStaleReasons({ ...sources, naicsCodes: undefined }, { ...quiet, currentNaicsCodes: ["1"] })).toEqual([]);
    expect(computeStaleReasons(null, { ...quiet, currentPastPerformanceIds: [], outcomesSince: 1 })).toEqual(["1 bid decided"]);
  });
});

describe("changedSections", () => {
  it("marks the sections that differ, and every section when nothing is approved", () => {
    const a = { ...emptyCompanyModel(), summary: "a", keywords: ["k"] };
    expect([...changedSections(a, { ...a, summary: "b", gaps: ["g"] })]).toEqual(["summary", "gaps"]);
    expect(changedSections(a, a).size).toBe(0);
    expect(changedSections(null, a).size).toBe(8);
  });
});
