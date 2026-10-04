/**
 * BL-AUTH-ABUSE Slice 2a — trial state, ends, extensions and wording.
 */

import { describe, expect, it } from "vitest";
import {
  TRIAL_DAYS,
  TRIAL_PAUSED_FLAGS,
  extendedTrialEnd,
  pauseAiFlags,
  sanitizeTrialDays,
  trialBannerText,
  trialEndFrom,
  trialExpiredMessage,
  trialState,
} from "@/lib/trial-logic";

const now = new Date("2026-10-04T12:00:00Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(now.getTime() + days * DAY);

describe("trialState", () => {
  it("is none unless the status says trial", () => {
    expect(trialState("active", at(5), now)).toEqual({ kind: "none" });
    expect(trialState("past_due", null, now)).toEqual({ kind: "none" });
    expect(trialState(null, null, now)).toEqual({ kind: "none" });
  });
  it("counts whole days left, rounding up, and expires at the end instant", () => {
    expect(trialState("trial", at(14), now)).toEqual({ kind: "active", endsAt: at(14), daysLeft: 14 });
    expect(trialState("trial", at(0.2), now)).toEqual({ kind: "active", endsAt: at(0.2), daysLeft: 1 });
    expect(trialState("trial", now, now)).toEqual({ kind: "expired", endedAt: now });
    expect(trialState("trial", at(-3), now)).toEqual({ kind: "expired", endedAt: at(-3) });
  });
  it("treats a trial with no end date as open", () => {
    expect(trialState("trial", null, now)).toEqual({ kind: "active", endsAt: null, daysLeft: null });
  });
});

describe("ends and extensions", () => {
  it("starts 14 days by default", () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(trialEndFrom(now)).toEqual(at(14));
    expect(trialEndFrom(now, 30)).toEqual(at(30));
  });
  it("adds to what is left, or to today once ended", () => {
    expect(extendedTrialEnd(at(5), 7, now)).toEqual(at(12));
    expect(extendedTrialEnd(at(-10), 7, now)).toEqual(at(7));
    expect(extendedTrialEnd(null, 7, now)).toEqual(at(7));
  });
  it("bounds the extension", () => {
    expect(sanitizeTrialDays(1)).toBe(1);
    expect(sanitizeTrialDays(90)).toBe(90);
    expect(sanitizeTrialDays(0)).toBeNull();
    expect(sanitizeTrialDays(91)).toBeNull();
    expect(sanitizeTrialDays(2.5)).toBeNull();
    expect(sanitizeTrialDays("7")).toBeNull();
  });
});

describe("pauseAiFlags", () => {
  it("switches off only the AI-powered flags", () => {
    const all = { aiAutoDraft: true, winnerAnalysis: true, complianceMatrix: true, bulkExport: true, apiAccess: true, customTemplates: true, advancedReporting: true };
    expect(pauseAiFlags(all)).toEqual({ aiAutoDraft: false, winnerAnalysis: false, complianceMatrix: false, bulkExport: true, apiAccess: true, customTemplates: true, advancedReporting: true });
    expect(all.aiAutoDraft).toBe(true);
    expect([...TRIAL_PAUSED_FLAGS].sort()).toEqual(["aiAutoDraft", "complianceMatrix", "winnerAnalysis"]);
  });
});

describe("wording", () => {
  it("tells people where they stand", () => {
    expect(trialBannerText({ kind: "none" })).toBeNull();
    expect(trialBannerText(trialState("trial", at(10), now))).toEqual({ tone: "info", text: "Trial: 10 days left (ends Oct 14, 2026)." });
    expect(trialBannerText(trialState("trial", at(1), now))).toEqual({ tone: "warn", text: "Trial: 1 day left (ends Oct 5, 2026)." });
    expect(trialBannerText(trialState("trial", null, now))).toEqual({ tone: "info", text: "You're on a FORGE trial." });
    expect(trialBannerText(trialState("trial", at(-1), now))?.tone).toBe("ended");
    expect(trialExpiredMessage(new Date("2026-10-18T00:00:00Z"))).toMatch(/^Your FORGE trial ended on Oct 18, 2026\. Editing carries on as usual; AI features are paused .*Settings → Billing\.$/);
  });
});
