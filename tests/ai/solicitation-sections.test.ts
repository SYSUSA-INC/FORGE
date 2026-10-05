/**
 * BL-AIX Phase 0 — Sections L and M are found where they really start
 * (Part IV, at the end of a Uniform Contract Format RFP), not in the
 * table of contents or a later cross-reference, and the front-matter
 * excerpt carries them even when the document is long.
 */
import { describe, expect, it } from "vitest";
import { frontPassExcerpt, locateSection } from "@/lib/solicitation-sections";

const filler = (label: string, chars: number) => {
  const line = `${label} The contractor shall perform the work described in this part of the contract in accordance with the terms herein.\n`;
  return line.repeat(Math.ceil(chars / line.length));
};

const contents = [
  "TABLE OF CONTENTS",
  "SECTION A SOLICITATION/CONTRACT FORM",
  "SECTION B SUPPLIES OR SERVICES AND PRICES",
  "SECTION C DESCRIPTION/SPECIFICATIONS",
  "SECTION L INSTRUCTIONS, CONDITIONS, AND NOTICES TO OFFERORS",
  "SECTION M EVALUATION FACTORS FOR AWARD",
  "",
].join("\n");

const sectionL = [
  "SECTION L - INSTRUCTIONS, CONDITIONS, AND NOTICES TO OFFERORS",
  "L.1 The offeror shall submit its proposal in three volumes.",
  "L.2 Volume I, Technical, shall not exceed 30 pages. Volume II, Management, shall not exceed 15 pages.",
  "L.3 Pages shall be 8.5 x 11 inches with one-inch margins; font shall be Times New Roman 12 point.",
  "L.4 Offerors shall submit one electronic copy of each volume. Proposals received late will not be considered.",
  "L.5 The offeror shall format tables in no smaller than 10 point font. Submit pricing in a separate volume.",
  "",
].join("\n");

const sectionM = [
  "SECTION M - EVALUATION FACTORS FOR AWARD",
  "M.1 Award will be made on a best value trade-off basis.",
  "M.2 Evaluation factors: Factor 1 Technical Approach; Factor 2 Management; Factor 3 Past Performance; Factor 4 Price.",
  "M.3 Factor 1 is more important than Factor 2; the non-price factors combined are significantly more important than price.",
  "M.4 Each factor will be evaluated and given an adjectival rating.",
  "",
].join("\n");

function rfp(middleChars: number) {
  return [
    "SOLICITATION W912-26-R-0001\n",
    contents,
    filler("C.", middleChars),
    "SECTION C continued: see Section L for submission instructions and Section M for evaluation.\n",
    filler("I.", 20_000),
    sectionL,
    sectionM,
  ].join("");
}

describe("locateSection", () => {
  it("finds the real Section L and M starts, skipping the table of contents and cross-references", () => {
    const text = rfp(150_000);
    const l = locateSection(text, "L");
    const m = locateSection(text, "M");
    expect(l).toBe(text.indexOf("SECTION L - INSTRUCTIONS"));
    expect(m).toBe(text.indexOf("SECTION M - EVALUATION"));
  });

  it("returns null when the document has no such section", () => {
    expect(locateSection(filler("RFQ", 50_000), "L")).toBeNull();
    expect(locateSection("", "M")).toBeNull();
  });
});

describe("frontPassExcerpt", () => {
  it("returns short documents whole", () => {
    const text = rfp(5_000);
    expect(text.length).toBeLessThan(90_000);
    expect(frontPassExcerpt(text)).toEqual({ text, sectionLAt: null, sectionMAt: null, partial: false });
  });

  it("carries Sections L and M from the end of a long document within budget", () => {
    const text = rfp(300_000);
    const out = frontPassExcerpt(text);
    expect(out.partial).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(90_000);
    expect(out.text).toContain("Volume II, Management, shall not exceed 15 pages");
    expect(out.text).toContain("Factor 1 is more important than Factor 2");
    expect(out.text).toContain("[Section L, instructions to offerors — from character");
    expect(out.sectionLAt).toBe(text.indexOf("SECTION L - INSTRUCTIONS"));
    // The old behaviour (first 80k characters) saw neither.
    expect(text.slice(0, 80_000)).not.toContain("Factor 1 is more important");
  });

  it("falls back to the beginning when neither section can be found", () => {
    const text = filler("SOW", 200_000);
    const out = frontPassExcerpt(text);
    expect(out).toMatchObject({ partial: true, sectionLAt: null, sectionMAt: null });
    expect(out.text).toBe(text.slice(0, 90_000));
  });

  it("finds a heading even when PDF extraction lost the line break before it", () => {
    const text = `${filler("C.", 120_000).trimEnd()} ${sectionL}${sectionM}`;
    expect(locateSection(text, "L")).toBe(text.indexOf("SECTION L - INSTRUCTIONS"));
  });
});
