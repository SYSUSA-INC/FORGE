/**
 * BL-FB-GEN-BLOCKS — content blocks, pure parts: the version delta, the
 * changelog line and the picker's filter.
 */
import { describe, expect, it } from "vitest";
import {
  collectTags,
  countWords,
  describeDelta,
  filterBlocks,
  versionDelta,
} from "@/lib/content-blocks-logic";

describe("versionDelta", () => {
  it("counts words added and removed as a multiset difference", () => {
    const prev = { title: "Cyber capability", body: "We run a SOC. We run a SOC.", tags: ["cyber"] };
    const next = { title: "Cyber capability", body: "We run a SOC and a NOC.", tags: ["Cyber"] };
    const d = versionDelta(prev, next);
    // "and" and "noc" added ("a" stays at two); the second "we", "run" and "soc" removed.
    expect(d.wordsAdded).toBe(2);
    expect(d.wordsRemoved).toBe(3);
    expect(d).toMatchObject({ titleChanged: false, bodyChanged: true, tagsChanged: false, changed: true });
  });

  it("notices title and tag changes, ignoring case and order of tags", () => {
    const base = { title: "A", body: "same text", tags: ["x", "y"] };
    expect(versionDelta(base, { ...base, tags: ["Y", "x"] }).changed).toBe(false);
    expect(versionDelta(base, { ...base, title: "B" })).toMatchObject({ titleChanged: true, changed: true, wordsAdded: 0 });
    expect(versionDelta(base, { ...base, tags: ["x"] })).toMatchObject({ tagsChanged: true, changed: true });
    expect(countWords("Twenty-one FY26 contracts, zero findings.")).toBe(5);
  });

  it("describes a delta for the changelog row", () => {
    expect(describeDelta({ wordsAdded: 12, wordsRemoved: 4, titleChanged: true, tagsChanged: false })).toBe("+12 / −4 words · title");
    expect(describeDelta({ wordsAdded: 0, wordsRemoved: 0, titleChanged: false, tagsChanged: true })).toBe("tags");
    expect(describeDelta({ wordsAdded: 0, wordsRemoved: 0, titleChanged: false, tagsChanged: false })).toBe("");
  });
});

describe("filterBlocks / collectTags", () => {
  const blocks = [
    { id: "1", title: "Company overview", body: "Founded in 2009, we deliver cloud migration.", tags: ["overview", "Corporate"] },
    { id: "2", title: "Cyber capability v3", body: "Zero-trust architecture and a 24x7 SOC.", tags: ["cyber", "corporate"] },
    { id: "3", title: "Transition risk methodology", body: "Phased transition with a named lead.", tags: ["transition"] },
  ];

  it("matches every token across title, tags and body, case-insensitively", () => {
    expect(filterBlocks(blocks, { query: "cloud" }).map((b) => b.id)).toEqual(["1"]);
    expect(filterBlocks(blocks, { query: "CYBER soc" }).map((b) => b.id)).toEqual(["2"]);
    expect(filterBlocks(blocks, { query: "corporate" }).map((b) => b.id)).toEqual(["1", "2"]);
    expect(filterBlocks(blocks, { query: "nothing here" })).toEqual([]);
    expect(filterBlocks(blocks, {}).length).toBe(3);
  });

  it("filters by tag exactly and combines with the query", () => {
    expect(filterBlocks(blocks, { tag: "Corporate" }).map((b) => b.id)).toEqual(["1", "2"]);
    expect(filterBlocks(blocks, { tag: "corporate", query: "soc" }).map((b) => b.id)).toEqual(["2"]);
    expect(filterBlocks(blocks, { tag: "transition" }).map((b) => b.id)).toEqual(["3"]);
  });

  it("collects tags most used first, then alphabetical, de-duplicated by case", () => {
    expect(collectTags(blocks)).toEqual(["Corporate", "cyber", "overview", "transition"]);
    expect(collectTags(blocks, 2)).toEqual(["Corporate", "cyber"]);
    expect(collectTags([])).toEqual([]);
  });
});
