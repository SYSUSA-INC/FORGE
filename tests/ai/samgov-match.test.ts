/**
 * BL-STAB-10 — keyword matching for SAM.gov searches (pure): a notice is a
 * match only when the keyword was found in text FORGE read; an unread
 * description is "unchecked", never a match; open notice types by
 * default; one row per solicitation; and the results line says what was
 * searched. Includes the owner's report (NAICS 541519 + "ServiceNow").
 */
import { describe, expect, it } from "vitest";
import {
  OPEN_NOTICE_TYPES,
  collapseBySolicitation,
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
  it("parses words, phrases, required and excluded terms", () => {
    expect(parseKeyword(`"zero trust" +cloud -hardware OASIS+`)).toEqual({ terms: ["zero trust", "cloud", "oasis+"], excluded: ["hardware"], anyOf: [] });
    expect(parseKeyword("  ", ["Multiple Award Schedule"])).toEqual({ terms: [], excluded: [], anyOf: ["multiple award schedule"] });
  });

  it("matches whole words and phrases only", () => {
    expect(findTerm("plan to maintain the system", "ai")).toBe(-1);
    expect(findTerm("ai/ml tooling", "ai")).toBe(0);
    expect(findTerm("buy on oasis+ now", "oasis+")).toBe(7);
    expect(findTerm("servicenow itsm", "servicenow")).toBe(0);
    expect(findTerm("service now", "servicenow")).toBe(-1);
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
    const counts = { samTotal: 412, received: 412, otherTypes: 120, folded: 37, matched: 1, notMentioned: 230, noDescription: 20, unchecked: 4 };
    expect(searchSummary(counts, { keyword: "ServiceNow", codes: ["541519"], days: 30 })).toBe(
      "1 notice mentions “ServiceNow” · out of 412 notices SAM.gov has for NAICS 541519, posted in the last 30 days (230 don't mention it, 20 have no description, 4 not checked yet) · 120 notices of other types left out · 37 earlier notices of the same solicitations folded in.",
    );
    expect(searchSummary({ ...counts, samTotal: 2412, received: 1000 }, { keyword: null, codes: [], days: 7 })).toBe(
      "1 notice for all NAICS codes, posted in the last 7 days · 120 notices of other types left out · 37 earlier notices of the same solicitations folded in · FORGE read the first 1,000 of 2,412; narrow the codes or the window to see the rest.",
    );
  });
});
