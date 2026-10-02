/**
 * BL-AIP-2 — the A/B alternative draft is a first draft, not a tighten.
 */

import { describe, expect, it } from "vitest";
import { buildSectionDraftPrompt, type SectionDraftSnapshot } from "@/lib/ai-prompts";

const snapshot: SectionDraftSnapshot = {
  organizationName: "Acme Federal",
  proposal: {
    title: "Cloud migration support",
    agency: "GSA",
    solicitationNumber: "47QT-26-R-0001",
    naicsCode: "541512",
    setAside: "8(a)",
    incumbent: "",
    opportunityDescription: "Migrate legacy workloads.",
  },
  section: {
    title: "Technical Approach",
    kind: "technical",
    pageLimit: 5,
    currentBodyPlain: "",
    currentWordCount: 0,
  },
  pastPerformance: [],
};

describe("buildSectionDraftPrompt output instruction", () => {
  const userText = (mode: Parameters<typeof buildSectionDraftPrompt>[0]) =>
    buildSectionDraftPrompt(mode, snapshot).messages[0]!.content as string;

  it("asks both first-draft modes for a section body", () => {
    expect(userText("draft")).toContain("Produce the section body.");
    expect(userText("draft_alt")).toContain("Produce the section body.");
    expect(userText("draft_alt")).not.toContain("tightened body");
  });

  it("keeps the improve and tighten instructions", () => {
    expect(userText("improve")).toContain("Return the improved body.");
    expect(userText("tighten")).toContain("Return the tightened body.");
  });

  // BL-FB-SCAN-TONE — click-to-fix guidance travels in the snapshot and
  // the system prompt says how to treat it.
  it("carries the author's guidance when present and not otherwise", () => {
    const guided = buildSectionDraftPrompt("improve", {
      ...snapshot,
      section: {
        ...snapshot.section,
        currentBodyPlain: "We leverage a robust approach.",
        currentWordCount: 5,
        authorGuidance: 'Replace "leverage" (×1 — use).',
      },
    });
    expect(guided.messages[0]!.content).toContain('"authorGuidance": "Replace \\"leverage\\" (×1 — use)."');
    expect(guided.system).toContain("section.authorGuidance");
    expect(userText("improve")).not.toContain("authorGuidance");
  });
});
