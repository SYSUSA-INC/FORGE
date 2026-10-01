/**
 * BL-FB-SCAN-PAGE-REALTIME — live page budget, pure parts.
 */
import { describe, expect, it } from "vitest";
import {
  WORDS_PER_PAGE,
  estimatePages,
  normalizePageCap,
  pageBudget,
  ringFill,
  wordsForPages,
} from "@/lib/page-budget";

describe("page budget", () => {
  it("estimates pages at the shared density", () => {
    expect(WORDS_PER_PAGE).toBe(350);
    expect(estimatePages(0)).toBe(0);
    expect(estimatePages(350)).toBe(1);
    expect(estimatePages(1470)).toBe(4.2);
    expect(estimatePages(-5)).toBe(0);
    expect(wordsForPages(3)).toBe(1050);
  });

  it("reads the editor's cap input leniently", () => {
    expect(normalizePageCap(null)).toBeNull();
    expect(normalizePageCap("")).toBeNull();
    expect(normalizePageCap(" 3 ")).toBe(3);
    expect(normalizePageCap("abc")).toBeNull();
    expect(normalizePageCap(0)).toBeNull();
    expect(normalizePageCap(2.5)).toBe(2.5);
  });

  it("colours the ring by distance from the cap", () => {
    expect(pageBudget(400, null)).toMatchObject({ state: "none", cap: null, ratio: null, label: "1.1 pages" });
    expect(pageBudget(0, 3)).toMatchObject({ state: "empty", label: "0 / 3 pages", overBy: 0 });
    expect(pageBudget(350, 3)).toMatchObject({ state: "thin", pages: 1 });
    expect(pageBudget(800, 3)).toMatchObject({ state: "ok" });
    expect(pageBudget(980, 3)).toMatchObject({ state: "near" });
    const over = pageBudget(1470, 3);
    expect(over).toMatchObject({ state: "over", pages: 4.2, overBy: 1.2, label: "4.2 / 3 pages" });
    expect(over.description).toContain("Over the cap by 1.2 pages");
    expect(over.description).toContain("Tighten");
    expect(pageBudget(350, 1)).toMatchObject({ state: "near", label: "1 / 1 page" });
  });

  it("fills the ring to the cap and no further", () => {
    expect(ringFill(pageBudget(0, 3))).toBe(0);
    expect(ringFill(pageBudget(525, 3))).toBeCloseTo(0.5, 5);
    expect(ringFill(pageBudget(2000, 3))).toBe(1);
    expect(ringFill(pageBudget(2000, null))).toBe(0);
  });
});
