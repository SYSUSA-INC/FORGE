/**
 * BL-AIX Phase 0b — how much AI text a team keeps, measured so common
 * words can't inflate it and graded only once the draft was reviewed.
 */
import { describe, expect, it } from "vitest";
import { aiSuggestionAcceptance, MIN_DRAFT_AGE_MS, shingleRetention, shouldResolveDraft } from "@/lib/ai-acceptance";

describe("shingleRetention", () => {
  const draft = "Our transition plan retains every incumbent technician and completes knowledge transfer within thirty days of award.";

  it("is 1 when the draft survives intact and 0 for empty input", () => {
    expect(shingleRetention(draft, `Intro paragraph. ${draft} Closing paragraph.`).fraction).toBe(1);
    expect(shingleRetention("", draft)).toEqual({ fraction: 0, keptWords: 0 });
  });

  it("does not count common words the rewrite happens to share", () => {
    // The old bag-of-words measure scored this rewrite highly: "the", "and", "of", "within", "days" all appear.
    const rewrite = "The incumbent staff of the program office and the new team will train within ninety days of the start.";
    expect(shingleRetention(draft, rewrite).fraction).toBeLessThan(0.15);
  });

  it("scores a partly kept draft in between", () => {
    const kept = "Our transition plan retains every incumbent technician. We will finish handover in two weeks.";
    const r = shingleRetention(draft, kept);
    expect(r.fraction).toBeGreaterThan(0.2);
    expect(r.fraction).toBeLessThan(0.6);
    expect(r.keptWords).toBeGreaterThan(0);
  });

  it("handles drafts shorter than a four-word run", () => {
    expect(shingleRetention("Firm fixed price", "Pricing is firm fixed price.").fraction).toBe(1);
    expect(shingleRetention("Firm fixed price", "Cost plus fixed fee.").fraction).toBe(0);
  });
});

describe("shouldResolveDraft", () => {
  const created = new Date("2026-10-04T12:00:00Z");
  it("waits for the owner to finish reviewing and for the draft to age", () => {
    const later = new Date(created.getTime() + MIN_DRAFT_AGE_MS);
    expect(shouldResolveDraft({ draftCreatedAt: created, now: later, savedHasPendingChanges: false })).toBe(true);
    expect(shouldResolveDraft({ draftCreatedAt: created, now: later, savedHasPendingChanges: true })).toBe(false);
    expect(shouldResolveDraft({ draftCreatedAt: created, now: new Date(created.getTime() + 60_000), savedHasPendingChanges: false })).toBe(false);
  });
});

describe("aiSuggestionAcceptance", () => {
  it("weights by words and halves bulk decisions", () => {
    expect(aiSuggestionAcceptance([])).toBeNull();
    const r = aiSuggestionAcceptance([
      { decision: "accept", bulk: false, wordCount: 10 },
      { decision: "reject", bulk: false, wordCount: 30 },
      { decision: "accept", bulk: true, wordCount: 20 },
    ])!;
    expect(r.decided).toBe(3);
    expect(r.rate).toBeCloseTo((10 + 10) / (10 + 30 + 10));
  });

  it("counts a zero-word decision as one word", () => {
    expect(aiSuggestionAcceptance([{ decision: "accept", bulk: false, wordCount: 0 }])!.rate).toBe(1);
  });
});
