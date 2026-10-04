/**
 * BL-PACKAGES add-ons Slice 1 — the pure half: what live grants do to a
 * tier's quotas and flags, when a grant counts, and the catalogue
 * input rules.
 */

import { describe, expect, it } from "vitest";
import type { TierFeatureFlags, TierQuotas } from "@/db/schema";
import {
  addonIsLive,
  applyAddonEffects,
  describeAddon,
  formatMonthlyPrice,
  formatTokenCount,
  sanitizeAddonInput,
  sanitizeAddonQuantity,
} from "@/lib/addons-logic";

const flags: TierFeatureFlags = { aiAutoDraft: true, winnerAnalysis: false, complianceMatrix: false, bulkExport: false, apiAccess: false, customTemplates: false };
const quotas: TierQuotas = { aiRequestsPerMonth: 100, aiTokensPerMonth: 1_000_000, seatsIncluded: 5, storageGb: 10, proposalsPerMonth: 0 };

describe("applyAddonEffects", () => {
  it("adds token top-ups by quantity and turns features on, counting only what the tier had off", () => {
    const out = applyAddonEffects({
      quotas,
      flags,
      effects: [
        { kind: "ai_tokens", aiTokensPerMonth: 500_000, featureFlag: null, quantity: 2 },
        { kind: "ai_tokens", aiTokensPerMonth: 250_000, featureFlag: null, quantity: 1 },
        { kind: "feature", aiTokensPerMonth: 0, featureFlag: "winnerAnalysis", quantity: 1 },
        { kind: "feature", aiTokensPerMonth: 0, featureFlag: "aiAutoDraft", quantity: 1 },
      ],
    });
    expect(out.extraTokens).toBe(1_250_000);
    expect(out.quotas.aiTokensPerMonth).toBe(2_250_000);
    expect(out.quotas.aiRequestsPerMonth).toBe(100);
    expect(out.flags.winnerAnalysis).toBe(true);
    expect(out.flags.aiAutoDraft).toBe(true);
    expect(out.flags.bulkExport).toBe(false);
    expect(out.unlockedFlags).toEqual(["winnerAnalysis"]);
    // Inputs untouched.
    expect(quotas.aiTokensPerMonth).toBe(1_000_000);
    expect(flags.winnerAnalysis).toBe(false);
  });

  it("leaves an unlimited cap unlimited and reports no extra tokens", () => {
    const out = applyAddonEffects({ quotas: { ...quotas, aiTokensPerMonth: 0 }, flags, effects: [{ kind: "ai_tokens", aiTokensPerMonth: 500_000, featureFlag: null, quantity: 3 }] });
    expect(out.quotas.aiTokensPerMonth).toBe(0);
    expect(out.extraTokens).toBe(0);
  });

  it("is a no-op without effects and ignores unknown flags and bad quantities", () => {
    expect(applyAddonEffects({ quotas, flags, effects: [] })).toEqual({ quotas, flags, extraTokens: 0, unlockedFlags: [] });
    const out = applyAddonEffects({
      quotas,
      flags,
      effects: [
        { kind: "feature", aiTokensPerMonth: 0, featureFlag: "notAFlag" as keyof TierFeatureFlags, quantity: 1 },
        { kind: "ai_tokens", aiTokensPerMonth: 100, featureFlag: null, quantity: 0 },
        { kind: "ai_tokens", aiTokensPerMonth: -5, featureFlag: null, quantity: 2 },
      ],
    });
    expect(out.flags).toEqual(flags);
    expect(out.extraTokens).toBe(100);
  });
});

describe("addonIsLive", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const base = { status: "active", startsAt: new Date("2026-10-01T00:00:00Z"), endsAt: null as Date | null, addonActive: true };
  it("counts an active, started, open-ended grant on an active catalogue entry", () => {
    expect(addonIsLive(base, now)).toBe(true);
    expect(addonIsLive({ ...base, endsAt: new Date("2026-12-31T00:00:00Z") }, now)).toBe(true);
  });
  it("stops counting when cancelled, retired, not started yet, or past its end", () => {
    expect(addonIsLive({ ...base, status: "canceled" }, now)).toBe(false);
    expect(addonIsLive({ ...base, addonActive: false }, now)).toBe(false);
    expect(addonIsLive({ ...base, startsAt: new Date("2026-10-05T00:00:00Z") }, now)).toBe(false);
    expect(addonIsLive({ ...base, endsAt: new Date("2026-10-04T12:00:00Z") }, now)).toBe(false);
    expect(addonIsLive({ ...base, endsAt: new Date("2026-10-04T12:00:01Z") }, now)).toBe(true);
  });
});

describe("sanitizeAddonInput", () => {
  const good = { slug: "AI-Tokens-500K", name: "500K AI token top-up", description: "x", kind: "ai_tokens", aiTokensPerMonth: 500_000, featureFlag: null, priceMonthlyCents: 4900, stripePriceId: " price_123 ", sortOrder: 2, active: true };
  it("accepts and normalises a token top-up", () => {
    const r = sanitizeAddonInput(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.slug).toBe("ai-tokens-500k");
    expect(r.value.stripePriceId).toBe("price_123");
    expect(r.value.featureFlag).toBeNull();
  });
  it("accepts a feature unlock and zeroes its tokens", () => {
    const r = sanitizeAddonInput({ ...good, slug: "winner", kind: "feature", featureFlag: "winnerAnalysis", aiTokensPerMonth: 999, stripePriceId: "" });
    expect(r).toEqual({ ok: true, value: expect.objectContaining({ kind: "feature", featureFlag: "winnerAnalysis", aiTokensPerMonth: 0, stripePriceId: null }) });
  });
  it("refuses bad slugs, kinds, amounts and missing features", () => {
    expect(sanitizeAddonInput({ ...good, slug: "-bad" }).ok).toBe(false);
    expect(sanitizeAddonInput({ ...good, slug: "a" }).ok).toBe(false);
    expect(sanitizeAddonInput({ ...good, name: "" }).ok).toBe(false);
    expect(sanitizeAddonInput({ ...good, kind: "seats" }).ok).toBe(false);
    expect(sanitizeAddonInput({ ...good, aiTokensPerMonth: 0 }).ok).toBe(false);
    expect(sanitizeAddonInput({ ...good, aiTokensPerMonth: 1.5 }).ok).toBe(false);
    expect(sanitizeAddonInput({ ...good, priceMonthlyCents: -1 }).ok).toBe(false);
    expect(sanitizeAddonInput({ ...good, kind: "feature", featureFlag: "nope" }).ok).toBe(false);
    expect(sanitizeAddonInput(null).ok).toBe(false);
  });
  it("bounds grant quantities", () => {
    expect(sanitizeAddonQuantity(1)).toBe(1);
    expect(sanitizeAddonQuantity(100)).toBe(100);
    expect(sanitizeAddonQuantity(0)).toBeNull();
    expect(sanitizeAddonQuantity(101)).toBeNull();
    expect(sanitizeAddonQuantity(2.5)).toBeNull();
    expect(sanitizeAddonQuantity("3")).toBeNull();
  });
});

describe("wording", () => {
  it("describes add-ons and prices", () => {
    expect(describeAddon({ kind: "ai_tokens", aiTokensPerMonth: 500_000, featureFlag: null })).toBe("+500K AI tokens / month");
    expect(describeAddon({ kind: "ai_tokens", aiTokensPerMonth: 500_000, featureFlag: null }, 3)).toBe("+1.5M AI tokens / month (3 × 500K)");
    expect(describeAddon({ kind: "feature", aiTokensPerMonth: 0, featureFlag: "bulkExport" })).toBe("Unlocks Bulk export");
    expect(formatTokenCount(950)).toBe("950");
    expect(formatTokenCount(1_200_000)).toBe("1.2M");
    expect(formatMonthlyPrice(0)).toBe("Included");
    expect(formatMonthlyPrice(4900)).toBe("$49/mo");
    expect(formatMonthlyPrice(4950)).toBe("$49.50/mo");
  });
});
