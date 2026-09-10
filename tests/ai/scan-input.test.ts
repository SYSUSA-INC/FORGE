/**
 * BL-AI-SCAN-FULLTEXT — tests for the shared scan input builder.
 *
 * Pure module, no DB. Pins: full bodies under budget, the per-section
 * cap with a visible truncation marker, proportional scaling with a
 * floor when the total budget is exceeded, EMPTY/THIN/OK flags, and the
 * prompt layout both scan paths now share.
 */

import { describe, expect, it } from "vitest";
import {
  allocateScanAllowances,
  buildScanSectionBlocks,
  buildScanUserPrompt,
  DEFAULT_SCAN_BUDGET,
  SCAN_SYSTEM,
  scanSectionFlag,
  type ScanSectionSource,
} from "@/lib/proposal-scan-input";

function words(n: number, seed = "lorem"): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(`${seed}${i % 7}`);
  return out.join(" ");
}

function section(
  id: string,
  content: string,
  extra: Partial<ScanSectionSource> = {},
): ScanSectionSource {
  return {
    id,
    title: `Section ${id}`,
    kind: "technical",
    status: "drafting",
    wordCount: content.split(/\s+/).filter(Boolean).length,
    pageLimit: null,
    bodyDoc: null,
    content,
    ...extra,
  };
}

describe("BL-AI-SCAN-FULLTEXT — flags", () => {
  it("EMPTY under 30 words, THIN under 60% of page expectation, else OK", () => {
    expect(scanSectionFlag(10, null).flag).toBe("EMPTY");
    expect(scanSectionFlag(100, null).flag).toBe("OK");
    // 2 pages × 350 × 0.6 = 420 expected minimum
    expect(scanSectionFlag(300, 2)).toEqual({ flag: "THIN", expectedMin: 420 });
    expect(scanSectionFlag(500, 2).flag).toBe("OK");
  });
});

describe("BL-AI-SCAN-FULLTEXT — allowances", () => {
  it("returns full lengths (capped per section) when under the total budget", () => {
    const out = allocateScanAllowances([500, 3000, 12_000], DEFAULT_SCAN_BUDGET);
    expect(out).toEqual([500, 3000, 10_000]);
  });

  it("scales proportionally and holds the floor when over the total budget", () => {
    // 12 sections × 9k = 108k capped, budget 80k → ~6.7k each.
    const out = allocateScanAllowances(
      Array.from({ length: 12 }, () => 9_000),
      DEFAULT_SCAN_BUDGET,
    );
    const sum = out.reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(DEFAULT_SCAN_BUDGET.totalBodyBudgetChars * 1.05);
    for (const n of out) {
      expect(n).toBeGreaterThanOrEqual(DEFAULT_SCAN_BUDGET.floorChars);
      expect(n).toBeLessThan(9_000);
    }
  });

  it("a short section keeps its floor while long ones absorb the cut", () => {
    const out = allocateScanAllowances(
      [1_200, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000],
      DEFAULT_SCAN_BUDGET,
    );
    expect(out[0]).toBe(1_200); // shorter than the floor: kept whole
    expect(out.slice(1).every((n) => n < 10_000)).toBe(true);
  });

  it("halves the floor when floors alone exceed the budget", () => {
    const out = allocateScanAllowances(
      Array.from({ length: 5 }, () => 5_000),
      { perSectionCapChars: 10_000, totalBodyBudgetChars: 3_000, floorChars: 1_500 },
    );
    const sum = out.reduce((a, b) => a + b, 0);
    // Floors 5 × 1500 = 7500 > 3000; halving to 750 gives 3750 (> 3150),
    // halving again to 375 gives 1875, which fits.
    expect(sum).toBeLessThanOrEqual(3_150);
    expect(out.every((n) => n >= 250)).toBe(true);
  });

  it("empty sections get zero, never a floor", () => {
    expect(allocateScanAllowances([0, 50_000, 50_000], DEFAULT_SCAN_BUDGET)[0]).toBe(0);
  });
});

describe("BL-AI-SCAN-FULLTEXT — section blocks", () => {
  it("includes full bodies and marks nothing when under budget", () => {
    const body = words(400);
    const scan = buildScanSectionBlocks([section("a", body), section("b", "")]);
    expect(scan.truncatedSections).toBe(0);
    expect(scan.sections[0]!.included).toBe(body.length);
    expect(scan.blocks[0]).toContain(body);
    expect(scan.blocks[0]).not.toContain("truncated");
    expect(scan.blocks[0]!.startsWith('=== SECTION id=a | "Section a" |')).toBe(true);
    expect(scan.blocks[0]!.endsWith("=== END SECTION ===")).toBe(true);
    expect(scan.blocks[1]).toContain("(no content)");
    expect(scan.blocks[1]).toContain("| EMPTY ===");
  });

  it("applies the per-section cap, cuts at a word boundary and marks the cut", () => {
    const body = words(5_000); // well over 10k chars
    const scan = buildScanSectionBlocks([section("big", body)]);
    const line = scan.sections[0]!;
    expect(line.truncated).toBe(true);
    expect(line.included).toBeLessThanOrEqual(DEFAULT_SCAN_BUDGET.perSectionCapChars);
    expect(line.included).toBeGreaterThan(DEFAULT_SCAN_BUDGET.perSectionCapChars * 0.9);
    expect(scan.blocks[0]).toContain(
      `[… truncated: showing ${line.included} of ${body.length} characters]`,
    );
    // Included text is a prefix ending on a whole word.
    const includedText = body.slice(0, line.included);
    expect(body.startsWith(includedText)).toBe(true);
    expect(body[line.included]).toBe(" ");
    expect(scan.truncatedSections).toBe(1);
  });

  it("uses bodyDoc over content when present", () => {
    const scan = buildScanSectionBlocks([
      section("d", "fallback content", {
        bodyDoc: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Rich body wins." }] },
          ],
        },
      }),
    ]);
    expect(scan.blocks[0]).toContain("Rich body wins.");
    expect(scan.blocks[0]).not.toContain("fallback content");
  });
});

describe("BL-AI-SCAN-FULLTEXT — prompt", () => {
  it("lays out header, themes, requirements, coverage note and blocks", () => {
    const { prompt, input } = buildScanUserPrompt({
      proposalTitle: "Tower Ops",
      agency: "FAA",
      solicitationNumber: "FAA-26-001",
      naicsCode: "541512",
      setAside: null,
      winThemes: [{ title: "Zero downtime", statement: "We keep towers up." }],
      sectionMSummary: "Best value.",
      requirements: [{ kind: "shall", text: "Provide 24/7 coverage.", ref: "L.5" }],
      sections: [section("s1", words(50)), section("s2", words(60))],
    });
    expect(prompt).toContain("Proposal: Tower Ops");
    expect(prompt).toContain("Agency: FAA");
    expect(prompt).toContain("Set-aside: (unrestricted)");
    expect(prompt).toContain("1. Zero downtime: We keep towers up.");
    expect(prompt).toContain("Evaluation criteria (Section M): Best value.");
    expect(prompt).toContain("1. [L.5] shall: Provide 24/7 coverage.");
    expect(prompt).toContain("Sections (2 total). Section bodies follow in full.");
    expect(prompt).toContain("=== SECTION id=s1 |");
    expect(prompt).toContain("=== SECTION id=s2 |");
    expect(input.truncatedSections).toBe(0);
  });

  it("announces truncation in the coverage note", () => {
    const { prompt, input } = buildScanUserPrompt({
      proposalTitle: "P",
      agency: null,
      solicitationNumber: null,
      naicsCode: null,
      setAside: null,
      winThemes: [],
      sectionMSummary: "",
      requirements: [],
      sections: [section("huge", words(6_000)), section("ok", words(40))],
    });
    expect(input.truncatedSections).toBe(1);
    expect(prompt).toContain("1 of 2 were truncated for length");
    expect(prompt).not.toContain("Win themes");
  });

  it("system prompt describes the block format and full-body contradiction rule", () => {
    expect(SCAN_SYSTEM).toContain("=== SECTION id=");
    expect(SCAN_SYSTEM).toContain("truncated: showing X of Y characters");
    expect(SCAN_SYSTEM).toContain("across ALL section bodies");
  });
});
