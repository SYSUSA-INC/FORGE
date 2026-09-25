/**
 * BL-AIP-5 — pure text mechanics of the requirements-first pipeline.
 */
import { describe, expect, it } from "vitest";
import {
  categoryFromRef,
  chunkText,
  dedupeRequirements,
  jaccard,
  MAX_CHUNKS_PER_DOCUMENT,
  mergeRequirementLists,
  normalizeRequirementList,
  requirementKey,
} from "@/lib/requirements-text";

describe("BL-AIP-5 — chunkText", () => {
  it("returns one chunk for short text and nothing for blank text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n ")).toEqual([]);
    const one = chunkText("The contractor shall deliver.", { chunkChars: 5_000, overlapChars: 100 });
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ index: 0, start: 0, end: 29 });
  });

  it("covers the whole text with overlapping windows cut at paragraph breaks", () => {
    const para = "The offeror shall provide a staffing plan covering all task areas. ";
    const text = Array.from({ length: 120 }, (_, i) => `${i}. ${para}`).join("\n\n");
    const chunks = chunkText(text, { chunkChars: 2_000, overlapChars: 200 });
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks[0]!.start).toBe(0);
    expect(chunks[chunks.length - 1]!.end).toBe(text.length);
    for (let i = 1; i < chunks.length; i++) {
      // Each window starts inside the previous one (overlap) and moves forward.
      expect(chunks[i]!.start).toBeLessThan(chunks[i - 1]!.end);
      expect(chunks[i]!.start).toBeGreaterThan(chunks[i - 1]!.start);
      // Boundaries land on a paragraph break, not mid-sentence.
      expect(text[chunks[i - 1]!.end - 1]).toBe("\n");
    }
  });

  it("caps the number of windows", () => {
    const text = "x".repeat(2_000 * (MAX_CHUNKS_PER_DOCUMENT + 5));
    expect(chunkText(text, { chunkChars: 2_000, overlapChars: 0 })).toHaveLength(MAX_CHUNKS_PER_DOCUMENT);
  });
});

describe("BL-AIP-5 — de-duplication", () => {
  it("jaccard is 1 for identical text and low for unrelated text", () => {
    expect(jaccard("The contractor shall provide monthly reports", "the contractor shall provide monthly reports")).toBe(1);
    expect(jaccard("Provide monthly status reports", "Key personnel resumes are limited to two pages")).toBeLessThan(0.2);
  });

  it("drops near-duplicates across lists and keeps first sighting", () => {
    const a = [{ kind: "shall" as const, text: "The contractor shall provide monthly status reports to the COR.", ref: "C.3" }];
    const b = [
      { kind: "shall" as const, text: "Contractor shall provide monthly status reports to the COR", ref: "PWS 3" },
      { kind: "should" as const, text: "Offerors should identify key personnel by name.", ref: "L.5" },
    ];
    const merged = mergeRequirementLists([a, b]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.ref).toBe("C.3");
    expect(merged[1]!.ref).toBe("L.5");
    expect(dedupeRequirements(merged, b)).toHaveLength(2);
  });
});

describe("BL-AIP-5 — normalizeRequirementList", () => {
  it("coerces kinds, trims, collapses whitespace and caps", () => {
    const out = normalizeRequirementList(
      [
        { kind: "MUST", text: "  The offeror   must submit\nthree volumes. ", ref: " L.2 " },
        { kind: "may", text: "", ref: "" },
        { kind: "bogus", text: "Weird kind", ref: "x".repeat(100) },
        "not an object",
        { kind: "should", text: "Third", ref: "" },
      ],
      { maxItems: 2 },
    );
    expect(out).toEqual([
      { kind: "shall", text: "The offeror must submit three volumes.", ref: "L.2" },
      { kind: "shall", text: "Weird kind", ref: "x".repeat(64) },
    ]);
    expect(normalizeRequirementList(null)).toEqual([]);
  });
});

describe("BL-AIP-5 — categoryFromRef", () => {
  it("maps RFP references to compliance categories", () => {
    expect(categoryFromRef("L.5.2.1")).toBe("section_l");
    expect(categoryFromRef("Section L")).toBe("section_l");
    expect(categoryFromRef("M-3")).toBe("section_m");
    expect(categoryFromRef("C.3.1")).toBe("section_c");
    expect(categoryFromRef("PWS 2.1.4")).toBe("section_c");
    expect(categoryFromRef("FAR 52.204-21")).toBe("far_clause");
    expect(categoryFromRef("52.212-4")).toBe("far_clause");
    expect(categoryFromRef("", "Proposals will be evaluated on technical factor 1")).toBe("section_m");
    expect(categoryFromRef("", "Submit Volume I within a 30 page limit")).toBe("section_l");
    expect(categoryFromRef("", "The contractor shall maintain the system")).toBe("other");
  });

  it("requirementKey normalises case and whitespace", () => {
    expect(requirementKey("  The Offeror  SHALL\tsubmit ")).toBe("the offeror shall submit");
  });
});
