/**
 * BL-AIP-4 — ranking adjustments layered on Brain similarity.
 */

import { describe, expect, it } from "vitest";
import {
  CURATED_BOOST,
  kindBoost,
  outcomeBoost,
  qualityBoost,
  rankBoost,
  recencyBoost,
} from "@/lib/brain-rank";

const NOW = new Date("2026-09-25T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("individual boosts", () => {
  it("outcome: won rises, lost sinks, the rest neutral", () => {
    expect(outcomeBoost("won")).toBe(0.1);
    expect(outcomeBoost("lost")).toBe(-0.05);
    expect(outcomeBoost("no_bid")).toBe(0);
    expect(outcomeBoost(null)).toBe(0);
  });

  it("kind: proposals and performance evidence first", () => {
    expect(kindBoost("proposal")).toBeGreaterThan(kindBoost("cpars"));
    expect(kindBoost("cpars")).toBeGreaterThan(kindBoost("debrief"));
    expect(kindBoost("brochure")).toBe(0);
    expect(kindBoost(undefined)).toBe(0);
  });

  it("recency: within a year up, over three years down, invalid neutral", () => {
    expect(recencyBoost(daysAgo(10), NOW)).toBe(0.03);
    expect(recencyBoost(daysAgo(700), NOW)).toBe(0);
    expect(recencyBoost(daysAgo(1500), NOW)).toBe(-0.03);
    expect(recencyBoost(daysAgo(10).toISOString(), NOW)).toBe(0.03);
    expect(recencyBoost("not a date", NOW)).toBe(0);
    expect(recencyBoost(null, NOW)).toBe(0);
  });

  it("quality: proportional, clamped, absent is neutral", () => {
    expect(qualityBoost(1)).toBe(0.05);
    expect(qualityBoost(0.5)).toBeCloseTo(0.025);
    expect(qualityBoost(4)).toBe(0.05);
    expect(qualityBoost(-1)).toBe(0);
    expect(qualityBoost(null)).toBe(0);
    expect(qualityBoost(Number.NaN)).toBe(0);
  });
});

describe("rankBoost", () => {
  it("sums the parts and adds the curated tie-break", () => {
    const corpus = rankBoost(
      { outcomeLabel: "won", kind: "proposal", updatedAt: daysAgo(30) },
      NOW,
    );
    expect(corpus).toBeCloseTo(0.1 + 0.03 + 0.03);
    const entry = rankBoost(
      { outcomeLabel: "lost", updatedAt: daysAgo(2000), qualityScore: 0.8, curated: true },
      NOW,
    );
    expect(entry).toBeCloseTo(-0.05 - 0.03 + 0.04 + CURATED_BOOST);
  });

  it("stays small so semantic similarity dominates", () => {
    const max = rankBoost(
      { outcomeLabel: "won", kind: "proposal", updatedAt: NOW, qualityScore: 1, curated: true },
      NOW,
    );
    expect(max).toBeLessThan(0.3);
  });
});
