/**
 * BL-AIP-7b — the nightly scout's pure parts.
 */

import { describe, expect, it } from "vitest";
import {
  awardExpiresWithin,
  EMPTY_SCOUT_TRACK,
  gradeTriage,
  keywordStrength,
  learningExamples,
  naicsCodeOf,
  passingMentionOnly,
  recompeteFromSignals,
  scoutCodes,
  scoutFit,
  scoutKeywordQuery,
  solicitationKey,
  staleReason,
  defaultFindsFilter,
  filterFinds,
  scoutSearchFunnel,
  scoutTriageAllowance,
  summarizeScoutTrack,
  type FitContext,
  type FitInput,
  type ScoutCandidateView,
  type ScoutListFilter,
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
  it("BL-SCOUT-QUALITY — starts at zero and earns: primary NAICS, the keyword in the title, an eligible set-aside", () => {
    const r = scoutFit({ ...base, title: "Enterprise help desk support", setAside: "8(a) Sole Source" }, ctx);
    expect(r.score).toBe(25 + 10 + 30);
    expect(r.signals).toEqual([
      "NAICS 541512 is your primary code",
      "Set-aside you qualify for: 8(a) Sole Source",
      "Your keyword help desk is in the title",
    ]);
    expect(r.keyword).toMatchObject({ term: "help desk", strength: "strong", inTitle: true });
  });

  it("weighs the keyword by how often the notice says it: three times, twice, once in passing", () => {
    const three = scoutFit({ ...base, title: "Support", description: "help desk. help desk. help desk." }, ctx);
    expect(three.signals).toContain("Your keyword help desk is mentioned 3 times");
    expect(three.score).toBe(25 + 30);
    const two = scoutFit({ ...base, title: "Support", description: "help desk and a help desk" }, ctx);
    expect(two.signals).toContain("Your keyword help desk is mentioned twice");
    expect(two.score).toBe(25 + 15);
    const short = scoutFit({ ...base, title: "Support", description: "Migrating the help desk to a new platform." }, ctx);
    expect(short.signals).toContain("Your keyword help desk is mentioned in this short notice");
    expect(short.score).toBe(25 + 15);
    const long = "Network operations and cyberspace defense support across the enterprise. ".repeat(14);
    const once = scoutFit({ ...base, title: "Support", description: `${long} The help desk is the government's.` }, ctx);
    expect(once.signals).toContain("Your keyword help desk is mentioned once, in passing");
    expect(once.score).toBe(25 + 3);
  });

  it("BL-STAB-10b — a keyword phrase still hits across a line break in the description", () => {
    const r = scoutFit({ ...base, title: "Support", description: "Tier 1 help\ndesk services." }, ctx);
    expect(r.keyword).toMatchObject({ term: "help desk", mentions: 1 });
  });

  it("a keyword the search confirmed but this text lacks is in an earlier notice of the solicitation", () => {
    const r = scoutFit({ ...base, title: "Amendment 0004", description: "Extends the response date." }, { ...ctx, keywords: ["ServiceNow"], keyword: "ServiceNow" });
    expect(r.signals).toContain("Your keyword ServiceNow is in an earlier notice of this solicitation");
    expect(r.keyword).toMatchObject({ strength: "moderate", where: "earlier" });
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
    expect(won.score).toBe(25 + 30 + 25 + 10);
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
    expect(lost.score).toBe(10 - 5 + 15);
    expect(lost.signals).toContain("Expiring award on your watchlist");
    expect(lost.signals).toContain("Looks like a recompete of a pursuit you lost; lessons are on file");
  });

  it("is zero with no organization data and no signals", () => {
    const r = scoutFit(
      { ...base, naicsCode: "", responseDueAt: null },
      { ...ctx, primaryNaics: "", naicsList: [], socio: null, keywords: [] },
    );
    expect(r).toEqual({ score: 0, signals: [], keyword: null });
  });

  it("a notice that only shares a NAICS code with the company scores low", () => {
    const r = scoutFit({ ...base, title: "Cyberspace operations", description: "Operational support services." }, { ...ctx, naicsList: ["541512"], primaryNaics: "541519", keywords: [] });
    expect(r.score).toBe(15);
  });
});

describe("BL-SCOUT-QUALITY — keywordStrength, passing mentions, solicitation keys", () => {
  it("picks the strongest keyword evidence across the list", () => {
    expect(keywordStrength("ServiceNow ITSM support", "", ["ITSM", "ServiceNow"])).toMatchObject({ strength: "strong", inTitle: true });
    expect(keywordStrength("Ops", "uses ITSM once; ServiceNow ServiceNow", ["ITSM", "ServiceNow"])).toMatchObject({ term: "ServiceNow", strength: "moderate" });
    expect(keywordStrength("Ops", "nothing relevant", ["ServiceNow"])).toBeNull();
  });

  it("drops a keyword find mentioned only in passing, unless a recompete or a past win ties it to the company", () => {
    const weak = scoutFit({ ...base, title: "Ops", description: `${"Operational support services for the enterprise. ".repeat(20)} ServiceNow once.` }, { ...ctx, keywords: ["ServiceNow"] });
    expect(passingMentionOnly(weak, { recompete: null, customer: null }, "keyword")).toBe(true);
    expect(passingMentionOnly(weak, { recompete: { outcome: "won", confidence: "high", hasLessons: false }, customer: null }, "keyword")).toBe(false);
    expect(passingMentionOnly(weak, { recompete: null, customer: { pursuits: 2, won: 1, lost: 1 } }, "keyword")).toBe(false);
    expect(passingMentionOnly(weak, { recompete: null, customer: null }, "org_naics")).toBe(false);
    const strong = scoutFit({ ...base, title: "ServiceNow modernization", description: "" }, { ...ctx, keywords: ["ServiceNow"] });
    expect(passingMentionOnly(strong, { recompete: null, customer: null }, "keyword")).toBe(false);
  });

  it("keys a solicitation by its number's letters and digits; short or generic numbers never group", () => {
    expect(solicitationKey("M67854-26-I-4208")).toBe("M6785426I4208");
    expect(solicitationKey(" m67854 26 i 4208 ")).toBe("M6785426I4208");
    expect(solicitationKey("N/A")).toBeNull();
    expect(solicitationKey("RFI-001")).toBeNull();
    expect(solicitationKey("")).toBeNull();
  });

  it("reads the recompete verdict back from stored signals", () => {
    expect(recompeteFromSignals(["Looks like a recompete of a pursuit you won"])).toMatchObject({ outcome: "won" });
    expect(recompeteFromSignals(["Looks like a recompete of a pursuit you lost; lessons are on file"])).toMatchObject({ outcome: "lost", hasLessons: true });
    expect(recompeteFromSignals(["NAICS 541512 is your primary code"])).toBeNull();
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

describe("BL-STAB-10d — what the scout searches and what still fits", () => {
  it("searches the Scout page's codes first, then the organization's, ten at most, codes only", () => {
    expect(["541512", "541512 - Computer Systems Design", "NAICS 541519", "2022 NAICS 541512", "1234567 541512", "54", "5", "1234567", "541512 or 541519", "2022 code 54", "", null].map(naicsCodeOf)).toEqual([
      "541512", "541512", "541519", "541512", "541512", "54", "", "", "", "", "", "",
    ]);
    const org = { primary: "518210", list: ["541715 - R&D", "541512", "236220", "541330", "541611", "541618", "541690", "541990", "561110", "611430"] };
    const c = scoutCodes({ extra: ["541519", "541513", "541511", "541512"], ...org }, 10);
    expect(c.searched).toEqual(["541519", "541513", "541511", "541512", "518210", "541715", "236220", "541330", "541611", "541618"]);
    expect(c.all.slice(10)).toEqual(["541690", "541990", "561110", "611430"]);
    expect(c.unreadable).toEqual([]);
    expect(scoutCodes({ extra: ["541519"], primary: null, list: ["Computer Systems Design", "541512 or 541519"] }, 10)).toEqual({
      searched: ["541519"],
      all: ["541519"],
      unreadable: ["Computer Systems Design", "541512 or 541519"],
    });
  });

  it("reads every saved keyword as one any-of list: -word excludes from every find, +word stays in its phrase", () => {
    const q = scoutKeywordQuery(["Enterprise IT modernization", "ServiceNow", "Digital Transformation"])!;
    expect(q.anyOf).toEqual([["enterprise it modernization", "servicenow", "digital transformation"]]);
    expect(q.terms).toEqual([]);
    const ten = scoutKeywordQuery(Array.from({ length: 10 }, (_, i) => `keyword number ${i} ${"x".repeat(40)}`))!;
    expect(ten.anyOf[0]).toHaveLength(10);
    const signs = scoutKeywordQuery(["+cloud migration", "zero trust -hardware", "a, b"])!;
    expect(signs).toMatchObject({ terms: [], anyOf: [["cloud migration", "zero trust", "a b"]], excluded: ["hardware"] });
    expect(scoutKeywordQuery(["IT", "ServiceNow"])!.notes).toEqual(["“IT” is in almost every notice."]);
    expect(scoutKeywordQuery([])).toBeNull();
    expect(scoutKeywordQuery(["  ", "-"])).toBeNull();
  });

  it("says why a waiting find no longer fits — past due, another code, no keyword — and keeps what it can't judge", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    const rules = { codes: ["541519", "541512"], query: scoutKeywordQuery(["ServiceNow", "Digital Transformation"]), now };
    const find = { source: "org_naics" as const, naicsCode: "541512", responseDueAt: new Date("2026-11-01T00:00:00Z"), title: "IT support", agency: "VA" };
    expect(staleReason(find, rules, { text: "Migrating the help desk to ServiceNow." })).toBeNull();
    expect(staleReason({ ...find, title: "ServiceNow renewal" }, rules, null)).toBeNull();
    expect(staleReason(find, rules, { text: "Data collection support services." })).toBe("no_keyword");
    expect(staleReason(find, rules, { none: true })).toBe("no_keyword");
    expect(staleReason({ ...find, naicsCode: "518210" }, rules, { text: "ServiceNow." })).toBe("other_code");
    expect(staleReason({ ...find, responseDueAt: new Date("2026-10-01T00:00:00Z") }, rules, { text: "ServiceNow." })).toBe("past_due");
    // Can't tell yet: no description known, cut text without a hit, or paragraphs run together around a keyword.
    expect(staleReason(find, rules, null)).toBeNull();
    expect(staleReason(find, rules, { text: "Data collection…", partial: true })).toBeNull();
    expect(staleReason(find, rules, { text: "BackgroundServiceNow is the tool." })).toBeNull();
    // A watchlisted award isn't judged by keywords or codes; with no keywords, codes alone decide.
    expect(staleReason({ ...find, source: "watchlist_award", naicsCode: "" }, rules, null)).toBeNull();
    expect(staleReason(find, { ...rules, query: null }, null)).toBeNull();
    expect(staleReason({ ...find, naicsCode: "" }, { ...rules, query: null }, null)).toBe("other_code");
    // Kept for a keyword still searched (found in an earlier notice or the agency): it stays,
    // unless an excluded word shows; once that keyword is dropped, its own text decides.
    const amendment = { ...find, title: "Amendment 0001", matchedKeyword: "ServiceNow" };
    expect(staleReason(amendment, rules, { text: "Extends the due date." })).toBeNull();
    expect(staleReason(amendment, { ...rules, query: scoutKeywordQuery(["ServiceNow -hardware"]) }, { text: "Adds a hardware refresh." })).toBe("no_keyword");
    expect(staleReason(amendment, { ...rules, query: scoutKeywordQuery(["Digital Transformation"]) }, { text: "Extends the due date." })).toBe("no_keyword");
  });

  it("BL-SCOUT-QUALITY — a keyword the search confirmed only in the agency's name is a passing mention", () => {
    const r = scoutFit({ ...base, agency: "Department of Veterans Affairs", title: "Help desk", description: "Tier 1 support." }, { ...ctx, keywords: ["Veterans Affairs"], keyword: "Veterans Affairs" });
    expect(r.signals).toContain("Your keyword Veterans Affairs is only in the agency's name");
    expect(r.keyword).toMatchObject({ strength: "weak", where: "agency" });
  });
});

describe("BL-SCOUT-REACH — the AI review's share and the search funnel", () => {
  it("keeps a fifth of the month's AI requests for the rest of FORGE", () => {
    expect(scoutTriageAllowance(0, 0, 25)).toBe(25); // unlimited plan
    expect(scoutTriageAllowance(500, 0, 25)).toBe(25);
    expect(scoutTriageAllowance(500, 390, 25)).toBe(10); // 500 − 390 − 100 kept back
    expect(scoutTriageAllowance(100, 75, 25)).toBe(5);
    expect(scoutTriageAllowance(100, 95, 25)).toBe(0);
  });

  const counts = { samTotal: 412, received: 412, truncated: false, otherTypes: 120, folded: 40, matched: 250, notMentioned: 0, noDescription: 0, unchecked: 0 };
  it("says what SAM.gov sent and how many are open", () => {
    expect(scoutSearchFunnel(counts, false, 1000)).toBe("SAM.gov sent 412 notices: 250 open solicitations once amendments are folded and awards and closed notices left out.");
  });
  it("with keywords as the filter, says how many mention one", () => {
    expect(scoutSearchFunnel({ ...counts, matched: 3, notMentioned: 240, noDescription: 5, unchecked: 2 }, true, 1000)).toBe(
      "SAM.gov sent 412 notices: 250 open solicitations once amendments are folded and awards and closed notices left out, 3 mention a keyword and 245 don't, 2 not checked yet.",
    );
  });
  it("says when SAM.gov held more than it sends", () => {
    expect(scoutSearchFunnel({ ...counts, samTotal: 1450, received: 1000, truncated: true }, false, 1000)).toContain(
      'SAM.gov holds 1,450 notices for this search but sends at most 1,000 per code: shorten "Posted in the last" so every one is read.',
    );
  });
});

describe("BL-SCOUT-ONEPAGE — the finds list's filters", () => {
  const find = (id: string, recommendation: "pursue" | "watch" | "skip" | null, fitScore: number) => ({ id, recommendation, fitScore }) as unknown as ScoutCandidateView;
  const finds = [find("s", "skip", 90), find("u1", null, 30), find("w", "watch", 60), find("p", "pursue", 40), find("u2", null, 50)];
  const ids = (f: ScoutListFilter) => filterFinds(finds, f).map((c) => c.id);

  it("orders Pursue, Watch, not yet reviewed, then Skip, best fit first", () => {
    expect(ids("recommended")).toEqual(["p", "w"]);
    expect(ids("unreviewed")).toEqual(["u2", "u1"]);
    expect(ids("all")).toEqual(["p", "w", "u2", "u1"]);
    expect(ids("skipped")).toEqual(["s"]);
  });

  it("opens on Recommended when the AI recommends something, else on All", () => {
    expect(defaultFindsFilter(finds)).toBe("recommended");
    expect(defaultFindsFilter([find("u", null, 10), find("s", "skip", 5)])).toBe("all");
  });
});

describe("BL-SCOUT-FIT — weak-fit finds are kept, counted and set aside", () => {
  const find = (id: string, recommendation: "pursue" | "watch" | "skip" | null, fitScore: number, capabilityBand: "strong" | "related" | "weak" | null) =>
    ({ id, recommendation, fitScore, capabilityBand }) as unknown as ScoutCandidateView;
  const finds = [find("w1", null, 40, "weak"), find("w2", null, 10, "weak"), find("r", null, 30, "related"), find("n", null, 20, null), find("wp", "pursue", 50, "weak")];
  const ids = (f: ScoutListFilter) => filterFinds(finds, f).map((c) => c.id);

  it("leaves weak, unreviewed finds out of every default view and lists them under Weak fit, best first", () => {
    expect(ids("weak")).toEqual(["w1", "w2"]);
    expect(ids("all")).toEqual(["wp", "r", "n"]);
    expect(ids("unreviewed")).toEqual(["r", "n"]);
  });

  it("trusts the AI over the band: a weak find it recommended stays visible", () => {
    expect(ids("recommended")).toEqual(["wp"]);
  });
});
