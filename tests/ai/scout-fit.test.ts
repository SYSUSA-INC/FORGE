import { describe, expect, it } from "vitest";
import {
  applyCapabilityBand,
  buildFitCards,
  capabilityFitFor,
  capabilitySignal,
  cosine,
  withoutCapabilitySignal,
  type FitCard,
} from "@/lib/scout-fit";

// Unit vectors on two axes: x is "cloud work", y is "janitorial".
const X = [1, 0];
const Y = [0, 1];
const near = (sim: number) => [sim, Math.sqrt(1 - sim * sim)];

const cards: FitCard[] = [
  { name: "Cloud migration", text: "cloud migration", kind: "proven" },
  { name: "Help desk", text: "help desk", kind: "claimed" },
];

describe("BL-SCOUT-FIT — bands", () => {
  it("cosine", () => {
    expect(cosine(X, X)).toBeCloseTo(1);
    expect(cosine(X, Y)).toBeCloseTo(0);
    expect(cosine([0, 0], X)).toBe(0);
  });

  it("a find close to a proven capability is strong", () => {
    const r = capabilityFitFor(near(0.8), cards, [X, Y])!;
    expect(r.band).toBe("strong");
    expect(r.basis).toContain("Cloud migration (proven)");
    expect(r.score).toBe(80);
  });

  it("close only to a claimed capability is related, however close", () => {
    expect(capabilityFitFor(Y, cards, [X, Y])!.band).toBe("related");
  });

  it("close to nothing is weak", () => {
    expect(capabilityFitFor(near(0.1), [cards[0]!], [X])!.band).toBe("weak");
  });

  it("a find closer to a named gap than to a capability is held to related", () => {
    const gap: FitCard = { name: "No classified work", text: "no classified work", kind: "gap" };
    const r = capabilityFitFor([0.6, 0.8], [cards[0]!, gap], [X, [0.2, 0.98]])!;
    expect(cosine([0.6, 0.8], X)).toBeGreaterThanOrEqual(0.55);
    expect(r.band).toBe("related");
    expect(r.basis).toContain("gap you named");
  });

  it("returns null with nothing to compare", () => {
    expect(capabilityFitFor(X, [], [])).toBeNull();
    expect(capabilityFitFor(X, [{ name: "g", text: "gap", kind: "gap" }], [X])).toBeNull();
  });

  it("moves the score by the band within 0..100; unscored finds are untouched", () => {
    expect(applyCapabilityBand(50, "strong")).toBe(70);
    expect(applyCapabilityBand(50, "related")).toBe(55);
    expect(applyCapabilityBand(50, "weak")).toBe(30);
    expect(applyCapabilityBand(10, "weak")).toBe(0);
    expect(applyCapabilityBand(95, "strong")).toBe(100);
    expect(applyCapabilityBand(50, null)).toBe(50);
  });

  it("re-scoring replaces the capability line, never doubles it", () => {
    const line = capabilitySignal(capabilityFitFor(near(0.8), cards, [X, Y])!);
    expect(withoutCapabilitySignal(["NAICS 541512 is your primary code", line])).toEqual(["NAICS 541512 is your primary code"]);
  });
});

describe("BL-SCOUT-FIT — capability cards", () => {
  const model = {
    summary: "We build cloud systems for civilian agencies.",
    capabilities: [
      { name: "Cloud migration", description: "Moves agency workloads to the cloud", strength: "proven" as const },
      { name: "AI triage", description: "Claimed, no evidence", strength: "unproven" as const },
    ],
    naicsWork: [{ code: "541512", whatWeDo: "Systems design for health agencies" }],
    gaps: ["No classified facility"],
  };

  it("uses the model, past performance and won pursuits, with proven and won as the strong evidence", () => {
    const c = buildFitCards({ model, entries: [{ title: "ignored", text: "ignored ignored" }], pastPerformance: [{ customer: "VA", contract: "EHR", description: "Hosting" }], won: [{ title: "Portal rebuild", agency: "HHS" }] });
    expect(c.map((x) => x.kind)).toEqual(["claimed", "proven", "claimed", "claimed", "gap", "proven", "won"]);
    expect(c.some((x) => x.name === "ignored")).toBe(false);
  });

  it("falls back to capability entries when there is no model, and is empty with nothing", () => {
    const c = buildFitCards({ model: null, entries: [{ title: "Capability statement", text: "We do cloud" }], pastPerformance: [], won: [] });
    expect(c).toHaveLength(1);
    expect(buildFitCards({ model: null, entries: [], pastPerformance: [], won: [] })).toEqual([]);
  });
});
