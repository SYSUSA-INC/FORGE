/**
 * BL-AIX Phase 0d — the requirement sweep says what it didn't read.
 */
import { describe, expect, it } from "vitest";
import { coverageFromSweep, describeCoverage } from "@/lib/extraction-coverage";

describe("describeCoverage", () => {
  it("is silent for a document read in full, and for one parsed before coverage existed", () => {
    expect(describeCoverage(coverageFromSweep({ totalChars: 200_000, readChars: 200_000, windows: 4, failedWindows: 0, requirementsFound: 120, requirementsKept: 120 }))).toBeNull();
    expect(describeCoverage({})).toBeNull();
    expect(describeCoverage(null)).toBeNull();
  });

  it("says how much was read when the window cap stopped the sweep", () => {
    const notes = describeCoverage({ totalChars: 1_000_000, readChars: 700_000, windows: 12, failedWindows: 0, requirementsFound: 300, requirementsKept: 300 })!;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("first 70%");
    expect(notes[0]).toContain("700,000 of 1,000,000 characters");
    expect(notes[0]).toContain("companion documents");
  });

  it("reports failed windows and the requirement cap", () => {
    const notes = describeCoverage({ totalChars: 300_000, readChars: 300_000, windows: 5, failedWindows: 2, requirementsFound: 512, requirementsKept: 400 })!;
    expect(notes).toEqual([
      "2 parts of the document couldn't be read. Re-parse to try again.",
      "512 requirements were found and the first 400 were kept.",
    ]);
  });

  it("explains the scanned-document path", () => {
    expect(describeCoverage({ vision: true })![0]).toContain("scanned document");
  });
});
