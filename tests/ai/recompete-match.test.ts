/**
 * BL-FB-WIN-RECOMPETE — tests for the pure recompete matcher.
 */

import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  findRecompetes,
  officeStem,
  normalizeSolicitationNumber,
  RECOMPETE_THRESHOLDS,
  scopeSimilarity,
  scoreRecompete,
  summarizeMatch,
  tokenize,
  type RecompetePrior,
  type RecompeteTarget,
} from "@/lib/recompete-match";

let seq = 0;
function prior(over: Partial<RecompetePrior>): RecompetePrior {
  seq += 1;
  return {
    proposalId: `p${seq}`,
    opportunityId: `o${seq}`,
    title: `Prior ${seq}`,
    agency: "Department of the Air Force",
    naicsCode: "541512",
    solicitationNumber: "",
    noticeId: "",
    scopeText: "",
    outcome: "lost",
    decidedAt: "2024-06-01T00:00:00Z",
    awardedTo: "",
    awardValue: null,
    reasons: [],
    lessonsLearned: "",
    debrief: null,
    winnerAnalysis: null,
    ...over,
  };
}
function target(over: Partial<RecompeteTarget>): RecompeteTarget {
  return {
    title: "",
    agency: "Department of the Air Force",
    naicsCode: "541512",
    solicitationNumber: "",
    noticeId: "",
    scopeText: "",
    incumbent: "",
    ...over,
  };
}

describe("recompete — text helpers", () => {
  it("tokenize drops boilerplate, stems and adds bigrams", () => {
    expect(tokenize("Enterprise Network Engineering Services")).toEqual([
      "enterprise",
      "network",
      "engineer",
      "enterprise network",
      "network engineer",
    ]);
    expect(tokenize("the of and shall")).toEqual([]);
  });

  it("cosineSimilarity is 1 for identical, 0 for disjoint", () => {
    const a = tokenize("Cybersecurity operations center staffing");
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
    expect(cosineSimilarity(a, tokenize("Grounds maintenance and snow removal"))).toBe(0);
    expect(cosineSimilarity([], a)).toBe(0);
  });

  it("scopeSimilarity ignores shared boilerplate words in titles", () => {
    const sim = scopeSimilarity(
      { title: "IT Support Services", scopeText: "" },
      { title: "Janitorial Support Services", scopeText: "" },
    );
    expect(sim).toBe(0);
    const near = scopeSimilarity(
      { title: "Information Technology Support Services, Region 5", scopeText: "" },
      { title: "Region 5 Information Technology Support", scopeText: "" },
    );
    expect(near).toBeGreaterThan(0.6);
  });

  it("solicitation number helpers", () => {
    expect(normalizeSolicitationNumber("w912dy-24-r-0012")).toBe("W912DY24R0012");
    expect(officeStem("W912DY-24-R-0012")).toBe("W912DY");
    expect(officeStem("FA8773-25-R-0001")).toBe("FA8773");
    expect(officeStem("N00024-24-R-5501")).toBe("N00024");
    expect(officeStem("12345-24-R-0001")).toBe(""); // no letters
    expect(officeStem("47QFCA24R0001")).toBe(""); // no separators
    expect(officeStem("")).toBe("");
  });
});

describe("recompete — scoring", () => {
  it("same SAM notice is a certain match", () => {
    const m = scoreRecompete(
      target({ noticeId: "abc123", title: "Anything", agency: "Other Agency", naicsCode: "" }),
      prior({ noticeId: "abc123", title: "Something else" }),
    );
    expect(m).not.toBeNull();
    expect(m!.score).toBe(1);
    expect(m!.confidence).toBe("high");
    expect(m!.signals.map((s) => s.kind)).toEqual(["notice"]);
  });

  it("same solicitation number (any formatting) is a likely recompete", () => {
    const m = scoreRecompete(
      target({ solicitationNumber: "fa8773-25-r-0001", agency: "USAF", title: "Depot IT" }),
      prior({ solicitationNumber: "FA8773-25-R-0001", title: "Depot maintenance IT" }),
    );
    expect(m).not.toBeNull();
    expect(m!.score).toBeGreaterThanOrEqual(0.95);
    expect(m!.confidence).toBe("high");
    expect(m!.signals[0]!.kind).toBe("solicitation_number");
  });

  it("same agency + NAICS + near-identical scope is a likely recompete", () => {
    const m = scoreRecompete(
      target({ title: "Enterprise Network Engineering and Operations Support" }),
      prior({ title: "Enterprise Network Engineering & Operations" }),
    );
    expect(m).not.toBeNull();
    expect(m!.confidence).toBe("high");
    expect(m!.signals.map((s) => s.kind)).toEqual(["agency", "naics", "scope"]);
  });

  it("same agency + NAICS with unrelated scope is not a recompete", () => {
    const m = scoreRecompete(
      target({ title: "Grounds maintenance and snow removal" }),
      prior({ title: "Enterprise Network Engineering" }),
    );
    expect(m).toBeNull();
  });

  it("similar scope at a different agency without identifiers is not flagged", () => {
    const m = scoreRecompete(
      target({ title: "Enterprise Network Engineering", agency: "Department of Energy" }),
      prior({ title: "Enterprise Network Engineering", agency: "Department of the Air Force" }),
    );
    expect(m).toBeNull();
  });

  it("same office stem + agency + NAICS clears the bar even with weak scope", () => {
    const m = scoreRecompete(
      target({ solicitationNumber: "W912DY-26-R-0031", title: "Facilities sustainment" }),
      prior({ solicitationNumber: "W912DY-21-R-0007", title: "Base operations" }),
    );
    expect(m).not.toBeNull();
    expect(m!.confidence).toBe("medium");
    expect(m!.score).toBeCloseTo(0.55, 2);
    // Drop the NAICS and it no longer clears the threshold.
    expect(
      scoreRecompete(
        target({ solicitationNumber: "W912DY-26-R-0031", title: "Facilities sustainment", naicsCode: "561210" }),
        prior({ solicitationNumber: "W912DY-21-R-0007", title: "Base operations" }),
      ),
    ).toBeNull();
  });

  it("an incumbent who beat us adds a signal", () => {
    const base = scoreRecompete(
      target({ title: "Enterprise Network Engineering Support" }),
      prior({ title: "Enterprise Network Engineering", awardedTo: "ACME FEDERAL, INC." }),
    )!;
    const withInc = scoreRecompete(
      target({ title: "Enterprise Network Engineering Support", incumbent: "Acme Federal" }),
      prior({ title: "Enterprise Network Engineering", awardedTo: "ACME FEDERAL, INC." }),
    )!;
    expect(withInc.signals.some((s) => s.kind === "incumbent")).toBe(true);
    expect(withInc.score).toBeGreaterThanOrEqual(base.score);
    expect(withInc.score).toBeLessThanOrEqual(1);
  });

  it("findRecompetes ranks by score then recency and respects the limit", () => {
    const t = target({ title: "Enterprise Network Engineering Support", solicitationNumber: "FA8773-26-R-0002" });
    const exact = prior({ title: "Unrelated", solicitationNumber: "FA8773-26-R-0002", decidedAt: "2023-01-01T00:00:00Z" });
    const scopeOnly = prior({ title: "Enterprise Network Engineering", decidedAt: "2024-01-01T00:00:00Z" });
    const scopeOnlyNewer = prior({ title: "Enterprise Network Engineering", decidedAt: "2025-01-01T00:00:00Z" });
    const noise = prior({ title: "Grounds maintenance" });
    const all = findRecompetes(t, [noise, scopeOnly, exact, scopeOnlyNewer], 10);
    expect(all.map((m) => m.prior.proposalId)).toEqual([
      exact.proposalId,
      scopeOnlyNewer.proposalId,
      scopeOnly.proposalId,
    ]);
    expect(findRecompetes(t, [noise, scopeOnly, exact, scopeOnlyNewer], 1)).toHaveLength(1);
    expect(all.every((m) => m.score >= RECOMPETE_THRESHOLDS.flag)).toBe(true);
  });

  it("summarizeMatch prefers lessons, then debrief improvements, then winner recommendations", () => {
    const t = target({ title: "Enterprise Network Engineering Support" });
    const withLessons = scoreRecompete(
      t,
      prior({ title: "Enterprise Network Engineering", lessonsLearned: "Price the transition realistically.", debrief: { strengths: "", weaknesses: "", improvements: "Add a staffing plan." }, awardedTo: "Acme" }),
    )!;
    expect(summarizeMatch(withLessons).lessons).toBe("Price the transition realistically.");
    const withDebrief = scoreRecompete(
      t,
      prior({ title: "Enterprise Network Engineering", debrief: { strengths: "", weaknesses: "Thin staffing", improvements: "Add a staffing plan." } }),
    )!;
    expect(summarizeMatch(withDebrief).lessons).toBe("Add a staffing plan.");
    const withWa = scoreRecompete(
      t,
      prior({ title: "Enterprise Network Engineering", winnerAnalysis: { competitorName: "Acme", gapsWeHad: "No ITIL certs", recommendations: "Certify the team." } }),
    )!;
    const flag = summarizeMatch(withWa);
    expect(flag.lessons).toBe("Certify the team.");
    expect(flag.signals).toEqual(["Same agency", "Same NAICS 541512", expect.stringMatching(/^Scope \d+% similar$/)]);
    expect(summarizeMatch(withWa, 10).lessons).toBe("Certify t…");
  });
});
