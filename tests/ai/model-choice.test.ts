/**
 * BL-AIX Phase 1i-2 — choosing a candidate model for an eval run. The
 * platform's extraction check takes any well-formed id; an organization's
 * golden eval takes only the listed models, on Anthropic, and never
 * routes around a model a platform admin pinned.
 */
import { describe, expect, it } from "vitest";
import { CANDIDATE_MODELS, cleanModelChoice, goldenCandidateRefusal } from "@/lib/model-choice";

describe("BL-AIX Phase 1i-2 — candidate model ids", () => {
  it("treats blank and 'default' as the routed default and trims an id", () => {
    expect(cleanModelChoice(undefined)).toBe("");
    expect(cleanModelChoice("   ")).toBe("");
    expect(cleanModelChoice("Default")).toBe("");
    expect(cleanModelChoice("  claude-opus-5-5 ")).toBe("claude-opus-5-5");
    expect(cleanModelChoice("meta-llama/Llama-3.3-70B-Instruct")).toBe("meta-llama/Llama-3.3-70B-Instruct");
    expect(cleanModelChoice("anthropic.claude-sonnet-4-6:0")).toBe("anthropic.claude-sonnet-4-6:0");
  });

  it("refuses what cannot be a model id", () => {
    expect(cleanModelChoice("x")).toBeNull();
    expect(cleanModelChoice("claude opus")).toBeNull();
    expect(cleanModelChoice("-rf")).toBeNull();
    expect(cleanModelChoice("a".repeat(101))).toBeNull();
  });
});

describe("BL-AIX Phase 1i-2 — golden eval candidates", () => {
  const ok = { model: "claude-sonnet-5-5", provider: "anthropic", aiModels: {} };

  it("lets an organization draft on a listed model when nothing is pinned", () => {
    for (const model of CANDIDATE_MODELS) expect(goldenCandidateRefusal({ ...ok, model }), model).toBeNull();
    expect(goldenCandidateRefusal({ ...ok, aiModels: null })).toBeNull();
    // A class the tenant chose is routing, not a pin.
    expect(goldenCandidateRefusal({ ...ok, aiModels: { section_draft: "fast", strong: "standard" } })).toBeNull();
  });

  it("refuses an unlisted model and a provider that cannot serve the list", () => {
    expect(goldenCandidateRefusal({ ...ok, model: "claude-mythos-5-1" })).toBe("Pick one of the listed models.");
    expect(goldenCandidateRefusal({ ...ok, provider: "stub" })).toMatch(/Anthropic provider/);
    expect(goldenCandidateRefusal({ ...ok, provider: "azure" })).toMatch(/Anthropic provider/);
  });

  it("never routes around a platform pin on the drafter or its class", () => {
    const pinned = /pinned by a platform admin/;
    expect(goldenCandidateRefusal({ ...ok, aiModels: { section_draft: "claude-sonnet-4-6" } })).toMatch(pinned);
    expect(goldenCandidateRefusal({ ...ok, aiModels: { strong: "claude-sonnet-4-6" } })).toMatch(pinned);
    // The drafter routed to a class follows that class's pin instead of strong's.
    expect(goldenCandidateRefusal({ ...ok, aiModels: { section_draft: "standard", standard: "claude-sonnet-4-6" } })).toMatch(pinned);
    expect(goldenCandidateRefusal({ ...ok, aiModels: { section_draft: "standard", strong: "claude-sonnet-4-6" } })).toBeNull();
  });
});
