/**
 * BL-PACKAGES add-ons Slice 1 — the pure half: what live grants do to a
 * tier's quotas and flags, when a grant counts, and the catalogue
 * input rules.
 */

import { describe, expect, it } from "vitest";
import type { TierFeatureFlags, TierQuotas } from "@/db/schema";
import {
  addonIsLive,
  addonStacks,
  applyAddonEffects,
  canBillOnPlan,
  reconcilePlanItems,
  splitSubscriptionItems,
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
    expect(applyAddonEffects({ quotas, flags, effects: [] })).toEqual({ quotas, flags, extraTokens: 0, extraSeats: 0, extraStorageGb: 0, unlockedFlags: [] });
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

describe("Slice 2a — add-ons on the plan's own subscription", () => {
  const addonPrices = new Set(["price_tokens", "price_export"]);
  const item = (id: string, priceId: string | null, quantity = 1, interval = "month") => ({ id, priceId, quantity, interval });

  it("tells the plan item from add-on items, whatever their order", () => {
    const split = splitSubscriptionItems([item("si_a", "price_tokens", 3), item("si_p", "price_gold"), item("si_b", "price_export")], addonPrices);
    expect(split.planItem?.id).toBe("si_p");
    expect(split.addonItems.map((i) => i.id)).toEqual(["si_a", "si_b"]);
    expect(splitSubscriptionItems([item("si_a", "price_tokens")], addonPrices).planItem).toBeNull();
    expect(splitSubscriptionItems([], addonPrices)).toEqual({ planItem: null, addonItems: [] });
  });

  it("bills on the plan only for a live plan on the same interval", () => {
    expect(canBillOnPlan({ planStatus: "active", planInterval: "month", addonInterval: "month" })).toBe(true);
    expect(canBillOnPlan({ planStatus: "trialing", planInterval: "year", addonInterval: "year" })).toBe(true);
    expect(canBillOnPlan({ planStatus: "active", planInterval: "year", addonInterval: "month" })).toBe(false);
    expect(canBillOnPlan({ planStatus: "past_due", planInterval: "month", addonInterval: "month" })).toBe(false);
    expect(canBillOnPlan({ planStatus: "canceled", planInterval: "month", addonInterval: "month" })).toBe(false);
    expect(canBillOnPlan({ planStatus: "active", planInterval: null, addonInterval: "month" })).toBe(false);
  });

  it("lines plan items up with recorded grants", () => {
    const grants = [
      { id: "g1", itemId: "si_a", quantity: 2 },
      { id: "g2", itemId: "si_b", quantity: 1 },
      { id: "g3", itemId: "si_gone", quantity: 1 },
    ];
    expect(reconcilePlanItems(grants, [{ id: "si_a", quantity: 5 }, { id: "si_b", quantity: 1 }, { id: "si_new", quantity: 1 }])).toEqual({
      end: ["g3"],
      quantity: [{ grantId: "g1", quantity: 5 }],
      added: ["si_new"],
    });
    expect(reconcilePlanItems([], [])).toEqual({ end: [], quantity: [], added: [] });
  });
});

describe("Slice 2b — seats and storage add-ons", () => {
  it("raises seats and storage by quantity, and never an unlimited quota", () => {
    const out = applyAddonEffects({
      quotas,
      flags,
      effects: [
        { kind: "seats", aiTokensPerMonth: 0, featureFlag: null, amountPerUnit: 5, quantity: 2 },
        { kind: "storage", aiTokensPerMonth: 0, featureFlag: null, amountPerUnit: 50, quantity: 1 },
      ],
    });
    expect(out.quotas).toMatchObject({ seatsIncluded: 15, storageGb: 60, aiTokensPerMonth: 1_000_000 });
    expect(out).toMatchObject({ extraSeats: 10, extraStorageGb: 50, extraTokens: 0 });
    const unlimited = applyAddonEffects({
      quotas: { ...quotas, seatsIncluded: 0, storageGb: 0 },
      flags,
      effects: [{ kind: "seats", aiTokensPerMonth: 0, featureFlag: null, amountPerUnit: 5, quantity: 1 }],
    });
    expect(unlimited.quotas.seatsIncluded).toBe(0);
    expect(unlimited.extraSeats).toBe(0);
  });

  it("validates the per-unit amount and describes the add-on", () => {
    const base = { slug: "seats-5", name: "5 seats", kind: "seats", priceMonthlyCents: 5000 };
    expect(sanitizeAddonInput({ ...base, amountPerUnit: 5 })).toMatchObject({ ok: true, value: { kind: "seats", amountPerUnit: 5, aiTokensPerMonth: 0, featureFlag: null } });
    expect(sanitizeAddonInput({ ...base, amountPerUnit: 0 }).ok).toBe(false);
    expect(sanitizeAddonInput({ ...base, kind: "storage", amountPerUnit: 1.5 }).ok).toBe(false);
    expect(sanitizeAddonInput({ ...base, kind: "storage", amountPerUnit: 100 })).toMatchObject({ ok: true, value: { kind: "storage", amountPerUnit: 100 } });
    expect(sanitizeAddonInput({ ...base, kind: "ai_tokens", aiTokensPerMonth: 1000, amountPerUnit: 9 })).toMatchObject({ ok: true, value: { amountPerUnit: 0 } });
    expect(describeAddon({ kind: "seats", aiTokensPerMonth: 0, featureFlag: null, amountPerUnit: 5 })).toBe("+5 seats");
    expect(describeAddon({ kind: "seats", aiTokensPerMonth: 0, featureFlag: null, amountPerUnit: 1 })).toBe("+1 seat");
    expect(describeAddon({ kind: "storage", aiTokensPerMonth: 0, featureFlag: null, amountPerUnit: 50 }, 3)).toBe("+150 GB storage (3 × 50)");
    expect(addonStacks("seats")).toBe(true);
    expect(addonStacks("feature")).toBe(false);
  });
});
