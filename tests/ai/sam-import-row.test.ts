/**
 * BL-AIP-1 — the SAM.gov import now takes the rows the user ticked; the
 * server sanitises them instead of re-searching an unfiltered feed.
 */

import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ROWS, sanitizeSamImportRows } from "@/lib/sam-import-row";

function row(noticeId: string, extra: Record<string, unknown> = {}) {
  return {
    noticeId,
    title: "Cloud migration support",
    solicitationNumber: "W91-26-R-0001",
    department: "Department of Defense",
    subTier: "Army",
    office: "ACC-APG",
    postedDate: "2026-09-01",
    type: "Solicitation",
    typeOfSetAsideDescription: "8(a)",
    responseDeadLine: "2026-10-01T17:00:00-04:00",
    naicsCode: "541512",
    classificationCode: "D302",
    placeOfPerformance: { city: { name: "Aberdeen" }, state: { name: "MD" } },
    description: "Migrate workloads.",
    uiLink: "https://sam.gov/opp/abc/view",
    ...extra,
  };
}

describe("sanitizeSamImportRows", () => {
  it("rejects non-arrays, non-objects and rows without a notice id", () => {
    expect(sanitizeSamImportRows(null)).toEqual([]);
    expect(sanitizeSamImportRows("abc")).toEqual([]);
    expect(sanitizeSamImportRows([null, 42, {}, { noticeId: "  " }])).toEqual([]);
  });

  it("keeps well-formed rows, dedupes by notice id (first wins) and ignores extra fields", () => {
    const out = sanitizeSamImportRows([
      row("n1", { alreadyImported: false, recompete: null }),
      row("n1", { title: "duplicate" }),
      row("n2"),
    ]);
    expect(out.map((r) => r.noticeId)).toEqual(["n1", "n2"]);
    expect(out[0]!.title).toBe("Cloud migration support");
    expect("alreadyImported" in out[0]!).toBe(false);
    expect(out[0]!.placeOfPerformance).toEqual({ city: { name: "Aberdeen" }, state: { name: "MD" }, country: undefined });
  });

  it("caps strings, nulls empty deadlines and drops malformed place-of-performance", () => {
    const out = sanitizeSamImportRows([
      row("n1", {
        title: "x".repeat(600),
        description: "y".repeat(30_000),
        responseDeadLine: "",
        placeOfPerformance: "Aberdeen, MD",
        naicsCode: 541512,
      }),
    ]);
    expect(out[0]!.title).toHaveLength(500);
    expect(out[0]!.description).toHaveLength(20_000);
    expect(out[0]!.responseDeadLine).toBeNull();
    expect(out[0]!.placeOfPerformance).toBeNull();
    expect(out[0]!.naicsCode).toBe("");
  });

  it("caps the batch size", () => {
    const many = Array.from({ length: MAX_IMPORT_ROWS + 25 }, (_, i) => row(`n${i}`));
    expect(sanitizeSamImportRows(many)).toHaveLength(MAX_IMPORT_ROWS);
  });
});
