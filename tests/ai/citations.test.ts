/**
 * BL-FB-GEN-CITE — tests for the citation contract.
 *
 * Pure: marker parsing, and the draft prompt's citation block. The
 * markers are the whole interface between prompt, route and panel, so
 * their syntax is pinned here.
 */

import { describe, expect, it } from "vitest";
import {
  extractCitationStats,
  NEEDS_CITATION_MARKER,
  sourceMarker,
} from "@/lib/citations";
import {
  buildSectionDraftPrompt,
  type SectionDraftSnapshot,
} from "@/lib/ai-prompts";

const baseSnapshot: SectionDraftSnapshot = {
  organizationName: "Acme Federal",
  proposal: {
    title: "Tower Ops",
    agency: "FAA",
    solicitationNumber: "FAA-26-001",
    naicsCode: "541512",
    setAside: "",
    incumbent: "",
    opportunityDescription: "Operate towers.",
  },
  section: {
    title: "Past Performance",
    kind: "past_performance",
    pageLimit: 2,
    currentBodyPlain: "",
    currentWordCount: 0,
  },
  pastPerformance: [
    { customer: "USAF", contract: "FA8-123", description: "Tower ops 2021-2024." },
  ],
};

describe("BL-FB-GEN-CITE — marker parsing", () => {
  it("counts distinct cited sources, total markers and needs-citation flags", () => {
    const text =
      "We ran 14 towers [S2]. Uptime was 99.98% [S2][S3]. We hold ISO 27001 [NEEDS CITATION]. " +
      "Contract FA8-123 [S1]. Staff of 40 [needs citation].";
    const s = extractCitationStats(text);
    expect(s.citedSources).toEqual([1, 2, 3]);
    expect(s.citationCount).toBe(4);
    expect(s.needsCitation).toBe(2);
  });

  it("is quiet on text without markers", () => {
    expect(extractCitationStats("Plain prose.")).toEqual({
      citedSources: [],
      citationCount: 0,
      needsCitation: 0,
    });
  });

  it("marker helper matches the regex the parser expects", () => {
    expect(sourceMarker(7)).toBe("[S7]");
    expect(extractCitationStats(`x ${sourceMarker(7)} y ${NEEDS_CITATION_MARKER}`)).toEqual({
      citedSources: [7],
      citationCount: 1,
      needsCitation: 1,
    });
  });
});

describe("BL-FB-GEN-CITE — draft prompt", () => {
  it("omits the citation block when no sources are attached", () => {
    const { messages } = buildSectionDraftPrompt("draft", baseSnapshot);
    const user = messages[0]!.content;
    expect(user).not.toContain("CITATION MODE IS ON");
    expect(user).not.toContain("[NEEDS CITATION]");
  });

  it("emits numbered sources, the rules, and keeps sources out of the JSON snapshot", () => {
    const { messages } = buildSectionDraftPrompt("draft", {
      ...baseSnapshot,
      sources: [
        {
          index: 1,
          kind: "corpus",
          label: "proposal · Submitted: Tower Ops FY24",
          excerpt: "We operated 14 towers with 99.98% uptime.",
          outcomeLabel: "won",
        },
        {
          index: 2,
          kind: "past_performance",
          label: "past performance · USAF",
          excerpt: "USAF — FA8-123 — Tower ops 2021-2024.",
        },
      ],
    });
    const user = messages[0]!.content;
    expect(user).toContain("CITATION MODE IS ON");
    expect(user).toContain("[S1] proposal · Submitted: Tower Ops FY24 · outcome: won");
    expect(user).toContain("We operated 14 towers with 99.98% uptime.");
    expect(user).toContain("[S2] past performance · USAF");
    expect(user).toContain('"[NEEDS CITATION]"');
    expect(user).toContain('Keep the "[Sn]" and "[NEEDS CITATION]" markers inline');
    // Sources are rendered once, in the block, not duplicated in the JSON.
    const jsonStart = user.indexOf("```json");
    expect(user.slice(jsonStart)).not.toContain("Tower Ops FY24");
  });
});
