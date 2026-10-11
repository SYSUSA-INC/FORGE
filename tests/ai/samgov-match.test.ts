/**
 * BL-STAB-10 — keyword matching for SAM.gov searches (pure), including the
 * owner's report (NAICS 541519 + "ServiceNow"): a match only in text FORGE read.
 */
import { describe, expect, it } from "vitest";
import {
  OPEN_NOTICE_TYPES,
  collapseBySolicitation,
  describeKeyword,
  hasKeyword,
  keywordLabel,
  findTerm,
  isWantedType,
  matchNotice,
  noticeTypeCode,
  parseKeyword,
  parseNoticeTypes,
  plainText,
  searchSummary,
} from "@/lib/samgov-match";

const row = (title: string, agency = "VETERANS AFFAIRS, DEPARTMENT OF") => ({ title, agency });

describe("BL-STAB-10 — notice types", () => {
  it("reads SAM.gov's type text, defaults to the open types, and keeps a type it doesn't know", () => {
    expect(["Solicitation", "Combined Synopsis/Solicitation", "Presolicitation", "Sources Sought", "Special Notice"].map(noticeTypeCode)).toEqual(OPEN_NOTICE_TYPES);
    expect(["Award Notice", "Justification", "Intent to Bundle Requirements (DoD-Funded)", "Sale of Surplus Property"].map(noticeTypeCode)).toEqual(["a", "u", "i", "g"]);
    expect(parseNoticeTypes(undefined)).toEqual(OPEN_NOTICE_TYPES);
    expect(parseNoticeTypes(["a", "x", "a", 3])).toEqual(["a"]);
    expect(isWantedType({ type: "Award Notice" }, OPEN_NOTICE_TYPES)).toBe(false);
    expect(isWantedType({ type: "Sources Sought" }, OPEN_NOTICE_TYPES)).toBe(true);
    expect(isWantedType({ type: "Some New Type" }, OPEN_NOTICE_TYPES)).toBe(true);
  });
});

describe("BL-STAB-10 — keywords", () => {
  it("parses words, phrases, required and excluded terms; a comma list means any of its items", () => {
    const shape = (input: string, vehicles: string[] = []) => {
      const q = parseKeyword(input, vehicles);
      return { terms: q.terms, anyOf: q.anyOf, excluded: q.excluded };
    };
    // No comma: every word or quoted phrase must appear (unchanged).
    expect(shape(`"zero trust" +cloud -hardware OASIS+`)).toEqual({ terms: ["zero trust", "cloud", "oasis+"], anyOf: [], excluded: ["hardware"] });
    expect(shape("zero trust cloud")).toEqual({ terms: ["zero", "trust", "cloud"], anyOf: [], excluded: [] });
    expect(shape('"zero trust').terms).toEqual(["zero", "trust"]);
    expect(shape("8(a) OASIS+").terms).toEqual(["8(a)", "oasis+"]);
    // BL-STAB-10b — the owner's search: any of three phrases.
    expect(shape("Servicenow, ITSM, Enterprise Service Management")).toEqual({ terms: [], anyOf: [["servicenow", "itsm", "enterprise service management"]], excluded: [] });
    expect(shape("zero trust cloud, ServiceNow").anyOf).toEqual([["zero trust cloud", "servicenow"]]);
    expect(shape(`"Smith, Jones", ITSM`).anyOf).toEqual([["smith, jones", "itsm"]]);
    expect(shape("ServiceNow, ITSM -hardware +federal")).toEqual({ terms: ["federal"], anyOf: [["servicenow", "itsm"]], excluded: ["hardware"] });
    expect(shape("Enterprise Service Management,").anyOf).toEqual([["enterprise service management"]]);
    expect(shape("“zero trust”, ServiceNow; ITSM").anyOf).toEqual([["zero trust", "servicenow", "itsm"]]);
    expect(hasKeyword(parseKeyword(", ;"))).toBe(false);
    expect(hasKeyword(parseKeyword("-"))).toBe(false);
    // GSA vehicles are one more group; both must be met.
    expect(shape("ServiceNow, ITSM", ["Multiple Award Schedule", "OASIS+"]).anyOf).toEqual([["servicenow", "itsm"], ["multiple award schedule", "oasis+"]]);
    // Long lists are cut to 10, risky items are named, the user's spelling is kept for display.
    const many = parseKeyword(Array.from({ length: 12 }, (_, i) => `term${i}`).join(", "));
    expect(many.anyOf[0]).toHaveLength(10);
    expect(many.notes[0]).toBe("Only the first 10 of 12 keywords are used.");
    expect(parseKeyword("Smith & Jones, Inc.").notes).toEqual(["“Inc.” is in almost every notice."]);
    expect(parseKeyword("over 1,000 seats").notes).toEqual(["A number like 1,000 is split at the comma: put it in quotes to keep it whole."]);
    // Review fixes: acronyms aren't "everywhere"; a quoted number isn't split; a term and its vehicle count once.
    expect(parseKeyword("AI, 5G, IT").notes).toEqual(["“IT” is in almost every notice."]);
    expect(parseKeyword(`"over 1,000 seats", ITSM`).notes).toEqual([]);
    const oasis = parseKeyword("OASIS+", ["OASIS+"]);
    expect([oasis.terms, oasis.anyOf, keywordLabel(oasis)]).toEqual([["oasis+"], [], "“OASIS+”"]);
    expect(matchNotice(row("OASIS+ task order"), parseKeyword("OASIS+, Polaris", ["OASIS+"]), null)).toMatchObject({ matched: [{ term: "OASIS+", where: "title" }] });
    expect(keywordLabel(parseKeyword("-hardware"))).toBe("none of “hardware”");
    expect(keywordLabel(parseKeyword("ServiceNow, ITSM -hardware"))).toBe("any of “ServiceNow” or “ITSM” but not “hardware”");
    const owner = parseKeyword("Servicenow, ITSM, Enterprise Service Management");
    expect(describeKeyword(owner)).toBe("Any of: Servicenow · ITSM · Enterprise Service Management");
    expect(keywordLabel(owner)).toBe("any of “Servicenow”, “ITSM” or “Enterprise Service Management”");
    expect(describeKeyword(parseKeyword("zero trust -hardware"))).toBe("All of: zero · trust; Not: hardware");
    // A saved scout keyword is one phrase.
    expect(shape("").anyOf).toEqual([]);
    expect(parseKeyword("zero trust -hardware", [], { asList: true }).anyOf).toEqual([["zero trust"]]);
  });

  it("matches whole words and phrases only", () => {
    expect(findTerm("plan to maintain the system", "ai")).toBe(-1);
    expect(findTerm("ai/ml tooling", "ai")).toBe(0);
    expect(findTerm("buy on oasis+ now", "oasis+")).toBe(7);
    expect(findTerm("servicenow itsm", "servicenow")).toBe(0);
    expect(findTerm("service now", "servicenow")).toBe(-1);
    expect(findTerm("software licenses renewal", "license")).toBe(9);
    expect(findTerm("counter-uas for drones.", "drone")).toBe(16);
    expect(findTerm("licensed vendors", "license")).toBe(-1);
    expect(plainText("<p>ServiceNow&nbsp;&amp; ITSM</p>")).toBe("ServiceNow & ITSM");
  });

  it("a title or agency match needs no description; a description match quotes it", () => {
    const q = parseKeyword("ServiceNow");
    expect(matchNotice(row("ServiceNow ITSM licenses"), q, null)).toMatchObject({ status: "match", where: "title", snippet: "ServiceNow ITSM licenses" });
    const desc = { text: `${"x ".repeat(60)}The platform is <b>ServiceNow</b> with ITOM.` };
    const m = matchNotice(row("ERP SI discovery session"), q, desc);
    expect(m).toMatchObject({ status: "match", where: "description" });
    if (m.status === "match") expect(m.snippet).toMatch(/^….*ServiceNow with ITOM\.$/);
  });

  it("never calls an unread notice a match or a non-match; reads decide", () => {
    const q = parseKeyword("ServiceNow");
    expect(matchNotice(row("Multiple Award Schedule"), q, null)).toEqual({ status: "unchecked" });
    expect(matchNotice(row("Multiple Award Schedule"), q, { unread: true })).toEqual({ status: "unchecked" });
    expect(matchNotice(row("Multiple Award Schedule"), q, { none: true })).toEqual({ status: "no_description" });
    expect(matchNotice(row("Multiple Award Schedule"), q, { text: "IT hardware" })).toEqual({ status: "not_mentioned" });
    // Every term is required; an excluded term can only be ruled out in read text.
    const both = parseKeyword("ServiceNow -hardware");
    expect(matchNotice(row("ServiceNow renewal"), both, null)).toEqual({ status: "unchecked" });
    expect(matchNotice(row("ServiceNow renewal"), both, { text: "Licenses only." })).toMatchObject({ status: "match", where: "title" });
    expect(matchNotice(row("ServiceNow renewal"), both, { text: "Includes hardware." })).toEqual({ status: "not_mentioned" });
    expect(matchNotice(row("ServiceNow renewal"), parseKeyword("ServiceNow ITOM"), { text: "ITSM only" })).toEqual({ status: "not_mentioned" });
    // Any of a list; each item is a phrase, and every item found is reported with where.
    const list = parseKeyword("Servicenow, ITSM, Enterprise Service Management");
    expect(matchNotice(row("ITSM tooling"), list, { text: "Migrating to ServiceNow." })).toMatchObject({
      status: "match",
      matched: [
        { term: "Servicenow", where: "description" },
        { term: "ITSM", where: "title" },
      ],
    });
    expect(matchNotice(row("Enterprise asset service"), list, { text: "Management services." })).toEqual({ status: "not_mentioned" });
    // A vehicle filter: one of them must appear.
    const mas = parseKeyword("", ["Multiple Award Schedule"]);
    expect(matchNotice(row("Multiple Award Schedule"), mas, null)).toMatchObject({ status: "match", where: "title" });
    expect(matchNotice(row("Help desk"), mas, { text: "Under OASIS+." })).toEqual({ status: "not_mentioned" });
  });
});

describe("BL-STAB-10 — one row per solicitation", () => {
  it("keeps the latest notice of each number and lists the earlier ones; no number, no grouping", () => {
    const rows = [
      { noticeId: "a1", solicitationNumber: "47QSMD20R0001", postedDate: "2026-09-01" },
      { noticeId: "a2", solicitationNumber: "47qsmd20r0001 ", postedDate: "2026-10-01" },
      { noticeId: "b1", solicitationNumber: "", postedDate: "2026-09-02" },
      { noticeId: "b2", solicitationNumber: "", postedDate: "2026-09-03" },
      { noticeId: "a3", solicitationNumber: "47QSMD20R0001", postedDate: "2026-09-15" },
    ];
    expect(collapseBySolicitation(rows).map((r) => [r.noticeId, r.earlierNoticeIds])).toEqual([
      ["a2", ["a1", "a3"]],
      ["b1", []],
      ["b2", []],
    ]);
    // The same placeholder number from two departments is two notices.
    const rfi = [
      { noticeId: "x", solicitationNumber: "N/A", postedDate: "2026-10-01", department: "DEPT OF THE ARMY" },
      { noticeId: "y", solicitationNumber: "N/A", postedDate: "2026-10-02", fullParentPathName: "VETERANS AFFAIRS, DEPARTMENT OF.VA" },
    ];
    expect(collapseBySolicitation(rfi).map((r) => r.noticeId)).toEqual(["x", "y"]);
  });
});

describe("BL-STAB-10 — the owner's search (NAICS 541519 + ServiceNow)", () => {
  // What SAM.gov returned (it ignored the keyword), as in the screenshot.
  const returned = [
    { noticeId: "e1", type: "Sources Sought", title: "DA01--Enterprise Resource Planning (ERP), System Integrator (SI) Information/Discovery Session", desc: { text: "VA intends to hold sessions… current ITSM is ServiceNow …" } as const },
    { noticeId: "m1", type: "Award Notice", title: "Multiple Award Schedule", desc: { none: true } as const },
    { noticeId: "d1", type: "Award Notice", title: "DA10--VISN21 DSS DATABRIDGE", desc: { none: true } as const },
    { noticeId: "l1", type: "Award Notice", title: "DA01--PACT Act - Open Text Micro Focus LoadRunner Maintenance", desc: null },
  ];

  it("shows only the notice that mentions the keyword; awards are off by default", () => {
    const q = parseKeyword("ServiceNow");
    const open = returned.filter((r) => isWantedType(r, OPEN_NOTICE_TYPES));
    expect(open.map((r) => r.noticeId)).toEqual(["e1"]);
    expect(matchNotice(row(open[0]!.title), q, open[0]!.desc)).toMatchObject({ status: "match", where: "description" });
    // With awards ticked on, they are checked too and none is a match.
    const awards = returned.filter((r) => r.type === "Award Notice").map((r) => matchNotice(row(r.title), q, r.desc).status);
    expect(awards).toEqual(["no_description", "no_description", "unchecked"]);
  });

  it("the results line says what was searched", () => {
    const counts = { samTotal: 412, received: 412, truncated: false, otherTypes: 120, folded: 37, matched: 2, notMentioned: 230, noDescription: 20, unchecked: 4 };
    const label = keywordLabel(parseKeyword("Servicenow, ITSM, Enterprise Service Management"));
    expect(searchSummary(counts, { keyword: label, codes: ["541519"], days: 30 })).toBe(
      "2 notices mention any of “Servicenow”, “ITSM” or “Enterprise Service Management” · out of 412 notices SAM.gov has for NAICS 541519, posted in the last 30 days (230 don't mention it, 20 have no description, 4 not checked yet) · 120 notices of other types left out · 37 earlier notices of the same solicitations folded in.",
    );
    expect(searchSummary({ ...counts, matched: 1, samTotal: 2412, received: 1000, truncated: true }, { keyword: null, codes: [], days: 7 })).toBe(
      "1 notice for all NAICS codes, posted in the last 7 days · 120 notices of other types left out · 37 earlier notices of the same solicitations folded in · SAM.gov sends at most 1,000 notices per request; FORGE read 1,000 of 2,412: narrow the search or the window to see the rest.",
    );
  });
});
