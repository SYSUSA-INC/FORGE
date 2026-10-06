/**
 * BL-AIX Phase 1d — sentences that state a hard figure with no citation
 * are flagged [NEEDS CITATION]; figures the drafter was given, references,
 * commitments and already-marked sentences are left alone.
 */
import { describe, expect, it } from "vitest";
import { factTokens, flagUncitedClaims } from "@/lib/uncited-claims";

const KNOWN = [
  "Cloud migration support, GSA, solicitation 47QT-26-R-0001, NAICS 541512.",
  "L.5.2.1 Volume I Technical shall not exceed 25 pages.",
  "C.1 The contractor shall migrate 40 legacy applications to a FedRAMP High cloud.",
].join("\n");

describe("BL-AIX Phase 1d — uncited claims", () => {
  it("normalises hard figures and ignores references and brackets", () => {
    expect([...factTokens("We saved $1,200,000 (12%) in 2023 across 140 sites.")].sort()).toEqual(
      ["$:1200000", "%:12", "n:140", "y:2023"].sort(),
    );
    expect([...factTokens("Holds ISO 9001:2015, CMMI-DEV ML 3 and SOC 2; contract 70RTAC-21-C-0001.")].sort()).toEqual(
      ["c:ISO9001:2015", "c:CMMI-DEVML3", "c:SOC2", "k:70RTAC-21-C-0001"].sort(),
    );
    expect(factTokens("Per L.5.2.1 and C.3.10 [S2] [TBD 2024], see 3.2.1 with 4 phases and 24x7 support.")).toEqual(new Set());
    expect(factTokens("Uptime $2.5M and 99.9 percent")).toEqual(new Set(["$:2.5m", "%:99.9"]));
  });

  it("flags an uncited figure the drafter was not given", () => {
    const { text, flagged } = flagUncitedClaims("We have migrated 140 applications since 2019. Our approach is phased.", KNOWN);
    expect(flagged).toBe(1);
    expect(text).toBe("We have migrated 140 applications since 2019. [NEEDS CITATION] Our approach is phased.");
  });

  it("leaves figures from the solicitation and the proposal setup alone", () => {
    const draft = "Under solicitation 47QT-26-R-0001 we move all 40 applications within the 25-page plan for NAICS 541512.";
    expect(flagUncitedClaims(draft, KNOWN)).toEqual({ text: draft, flagged: 0 });
  });

  it("skips cited sentences, already-flagged sentences and commitments", () => {
    const draft = [
      "We migrated 32 applications for DHS [S1].",
      "We cut costs by 18% [NEEDS CITATION].",
      "We will staff 12 engineers from day one.",
      "Our team proposes a 90-day transition.",
    ].join(" ");
    expect(flagUncitedClaims(draft, KNOWN)).toEqual({ text: draft, flagged: 0 });
  });

  it("works line by line on lists and keeps the separators", () => {
    const draft = "Key results:\n- 99.5% availability across 2024\n- Phased cutover with rollback";
    expect(flagUncitedClaims(draft, KNOWN)).toEqual({
      text: "Key results:\n- 99.5% availability across 2024 [NEEDS CITATION]\n- Phased cutover with rollback",
      flagged: 1,
    });
  });
});
