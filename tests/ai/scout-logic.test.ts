/**
 * BL-AIP-7b — the nightly scout's pure parts.
 */

import { describe, expect, it } from "vitest";
import {
  awardExpiresWithin,
  EMPTY_SCOUT_TRACK,
  gradeTriage,
  learningExamples,
  scoutFit,
  summarizeScoutTrack,
  type FitContext,
  type FitInput,
} from "@/lib/scout-logic";

const now = new Date("2026-09-29T09:00:00Z");
const socio = { sba8a: true, smallBusiness: true, sdb: false, wosb: false, sdvosb: false, hubzone: false };

const base: FitInput = {
  source: "org_naics",
  title: "Enterprise help desk support",
  description: "Tier 1 and 2 help desk services for a field office.",
  agency: "Department of Energy",
  naicsCode: "541512",
  setAside: "",
  responseDueAt: new Date("2026-10-20T00:00:00Z"),
};

const ctx: FitContext = {
  primaryNaics: "541512",
  naicsList: ["541519"],
  socio,
  keywords: ["help desk"],
  keyword: null,
  recompete: null,
  customer: null,
  now,
};

describe("scoutFit", () => {
  it("rewards the primary NAICS, a keyword hit and an eligible set-aside, and names each", () => {
    const r = scoutFit({ ...base, setAside: "8(a) Sole Source" }, ctx);
    expect(r.score).toBe(35 + 30 + 15 + 10);
    expect(r.signals).toEqual(
      expect.arrayContaining([
        expect.stringContaining("primary code"),
        expect.stringContaining("qualify for: 8(a)"),
        expect.stringContaining("keyword: help desk"),
      ]),
    );
  });

  it("penalises a foreign NAICS, an ineligible set-aside and a near due date, floored at zero", () => {
    const r = scoutFit(
      {
        ...base,
        title: "x",
        description: "y",
        naicsCode: "236220",
        setAside: "Service-Disabled Veteran-Owned Small Business",
        responseDueAt: new Date("2026-10-01T00:00:00Z"),
      },
      ctx,
    );
    expect(r.score).toBe(0);
    expect(r.signals).toEqual(
      expect.arrayContaining([
        expect.stringContaining("outside your codes"),
        expect.stringContaining("do not qualify"),
        "Due in 2 days",
      ]),
    );
  });

  it("adds the recompete radar, the customer record and the watchlist source, capped at 100", () => {
    const won = scoutFit(base, {
      ...ctx,
      recompete: { outcome: "won", confidence: "high", hasLessons: true },
      customer: { pursuits: 4, won: 2, lost: 2 },
    });
    expect(won.score).toBe(100);
    expect(won.signals).toEqual(
      expect.arrayContaining([
        "Looks like a recompete of a pursuit you won",
        "You have won at Department of Energy before (2 of 4)",
      ]),
    );

    const lost = scoutFit(
      { ...base, source: "watchlist_award", naicsCode: "", title: "Recompete", description: "" },
      {
        ...ctx,
        recompete: { outcome: "lost", confidence: "medium", hasLessons: true },
        customer: { pursuits: 3, won: 0, lost: 3 },
      },
    );
    expect(lost.score).toBe(35 + 10 - 5 + 10);
    expect(lost.signals).toContain("Expiring award on your watchlist");
    expect(lost.signals).toContain("Looks like a recompete of a pursuit you lost; lessons are on file");
  });

  it("is the base score with no organization data and no signals", () => {
    const r = scoutFit(
      { ...base, naicsCode: "", responseDueAt: null },
      { ...ctx, primaryNaics: "", naicsList: [], socio: null, keywords: [] },
    );
    expect(r).toEqual({ score: 35, signals: [] });
  });
});

describe("gradeTriage", () => {
  it("grades pursue and skip against the decision; watch and untriaged are inconclusive", () => {
    expect(gradeTriage("pursue", "imported")).toBe("correct");
    expect(gradeTriage("pursue", "dismissed")).toBe("wrong");
    expect(gradeTriage("skip", "dismissed")).toBe("correct");
    expect(gradeTriage("skip", "imported")).toBe("wrong");
    expect(gradeTriage("watch", "imported")).toBe("inconclusive");
    expect(gradeTriage(null, "dismissed")).toBe("inconclusive");
  });
});

describe("summarizeScoutTrack", () => {
  it("counts decided candidates only and reports decisive accuracy", () => {
    expect(
      summarizeScoutTrack([
        { status: "imported", grade: "correct" },
        { status: "dismissed", grade: "wrong" },
        { status: "dismissed", grade: "inconclusive" },
        { status: "new", grade: null },
      ]),
    ).toEqual({ n: 3, correct: 1, wrong: 1, inconclusive: 1, accuracy: 0.5, imported: 1, dismissed: 2 });
    expect(summarizeScoutTrack([])).toEqual(EMPTY_SCOUT_TRACK);
  });
});

describe("learningExamples", () => {
  const rows = [
    { title: "A", agency: "DOE", status: "imported", recommendation: "pursue" },
    { title: "B", agency: "", status: "dismissed", recommendation: null },
    { title: "C", agency: "VA", status: "new", recommendation: "watch" },
    { title: "D", agency: "VA", status: "dismissed", recommendation: "skip" },
  ];

  it("lists what was imported and dismissed, with the scout's call, capped per bucket", () => {
    expect(learningExamples(rows, 1)).toEqual({
      imported: ["A — DOE (scout said pursue)"],
      dismissed: ["B"],
    });
    expect(learningExamples(rows).dismissed).toEqual(["B", "D — VA (scout said skip)"]);
  });
});

describe("awardExpiresWithin", () => {
  it("returns days to the end date inside the window, including a recent lapse", () => {
    expect(awardExpiresWithin("2026-12-01", now, 180)).toBe(63);
    expect(awardExpiresWithin("2026-09-10", now, 180)).toBe(-19);
  });

  it("ignores far-off, long-lapsed, missing and unreadable dates", () => {
    expect(awardExpiresWithin("2027-09-01", now, 180)).toBeNull();
    expect(awardExpiresWithin("2026-07-01", now, 180)).toBeNull();
    expect(awardExpiresWithin("", now, 180)).toBeNull();
    expect(awardExpiresWithin(null, now, 180)).toBeNull();
    expect(awardExpiresWithin("not a date", now, 180)).toBeNull();
  });
});
