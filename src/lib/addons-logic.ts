/**
 * BL-PACKAGES add-ons Slice 1 — the pure half of à la carte add-ons.
 *
 * An add-on is one of two things: extra AI tokens per month (stackable
 * by quantity) or one feature flag turned on. This module decides what
 * a set of live grants does to a tier's quotas and flags, validates the
 * catalogue inputs a platform admin types, and words the effects for
 * the UI. No I/O; tested in tests/ai/addons-logic.test.ts.
 */

import type { TierFeatureFlags, TierQuotas } from "@/db/schema";

export const ADDON_KINDS = ["ai_tokens", "feature", "seats", "storage"] as const;
export type AddonKind = (typeof ADDON_KINDS)[number];

export const ADDON_KIND_LABELS: Record<AddonKind, string> = {
  ai_tokens: "AI token top-up",
  feature: "Feature unlock",
  seats: "Extra seats",
  storage: "Extra storage",
};

/** Kinds a tenant can hold several of (quantity); a feature unlock is on or off. */
export function addonStacks(kind: AddonKind): boolean {
  return kind !== "feature";
}

export const ADDON_FLAG_KEYS = [
  "aiAutoDraft",
  "winnerAnalysis",
  "complianceMatrix",
  "bulkExport",
  "apiAccess",
  "customTemplates",
  "advancedReporting",
] as const satisfies readonly (keyof TierFeatureFlags)[];

export const ADDON_FLAG_LABELS: Record<keyof TierFeatureFlags, string> = {
  aiAutoDraft: "AI auto-draft",
  winnerAnalysis: "Winner analysis",
  complianceMatrix: "Compliance matrix",
  bulkExport: "Bulk export",
  apiAccess: "API access",
  customTemplates: "Custom templates",
  advancedReporting: "Advanced reporting",
};

export const ADDON_LIMITS = {
  slug: /^[a-z0-9][a-z0-9-]{1,31}$/,
  nameMax: 64,
  descriptionMax: 500,
  tokensMax: 1_000_000_000,
  priceCentsMax: 10_000_000,
  quantity: { min: 1, max: 100 },
  /** Seats or GB per unit for the seats / storage kinds. */
  amountMax: 100_000,
  noteMax: 300,
} as const;

/** A catalogue entry as the UI sees it. */
export type AddonCatalogRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: AddonKind;
  aiTokensPerMonth: number;
  featureFlag: keyof TierFeatureFlags | null;
  amountPerUnit: number;
  priceMonthlyCents: number;
  stripePriceId: string | null;
  sortOrder: number;
  active: boolean;
};

/** A tenant's grant as the UI sees it. */
export type TenantAddonRow = {
  id: string;
  addonId: string;
  slug: string;
  name: string;
  kind: AddonKind;
  aiTokensPerMonth: number;
  featureFlag: keyof TierFeatureFlags | null;
  amountPerUnit: number;
  priceMonthlyCents: number;
  quantity: number;
  status: "active" | "canceled";
  source: "manual" | "stripe";
  stripeSubscriptionId: string | null;
  stripeSubscriptionItemId: string | null;
  note: string;
  startsAt: string;
  endsAt: string | null;
  canceledAt: string | null;
  /** Counts right now (active, started, not ended, catalogue entry active). */
  live: boolean;
};

/** What one live grant contributes. */
export type AddonEffect = {
  kind: AddonKind;
  aiTokensPerMonth: number;
  featureFlag: keyof TierFeatureFlags | null;
  /** Seats / GB per unit for the seats and storage kinds. */
  amountPerUnit?: number;
  quantity: number;
};

export type AddonEffectsApplied = {
  quotas: TierQuotas;
  flags: TierFeatureFlags;
  /** Tokens the live top-ups add per month (0 when the tier is already unlimited or there are none). */
  extraTokens: number;
  /** Seats / GB the live seat and storage add-ons add (0 when that quota is already unlimited). */
  extraSeats: number;
  extraStorageGb: number;
  /** Flags the live unlocks turned on that the tier and overrides had off. */
  unlockedFlags: (keyof TierFeatureFlags)[];
};

function isFlagKey(key: unknown): key is keyof TierFeatureFlags {
  return typeof key === "string" && (ADDON_FLAG_KEYS as readonly string[]).includes(key);
}

/**
 * Add the live grants' effects on top of a tier's merged quotas and
 * flags. A quota of 0 means unlimited and stays 0 (tokens, seats and
 * storage alike); a feature already on stays on and is not counted as
 * unlocked.
 */
export function applyAddonEffects(input: {
  quotas: TierQuotas;
  flags: TierFeatureFlags;
  effects: AddonEffect[];
}): AddonEffectsApplied {
  let extraTokens = 0;
  let extraSeats = 0;
  let extraStorageGb = 0;
  const flags: TierFeatureFlags = { ...input.flags };
  const unlockedFlags: (keyof TierFeatureFlags)[] = [];
  for (const e of input.effects) {
    const qty = Math.max(1, Math.floor(e.quantity || 1));
    const amount = Math.max(0, Math.floor(e.amountPerUnit || 0)) * qty;
    if (e.kind === "ai_tokens") {
      extraTokens += Math.max(0, Math.floor(e.aiTokensPerMonth || 0)) * qty;
    } else if (e.kind === "seats") {
      extraSeats += amount;
    } else if (e.kind === "storage") {
      extraStorageGb += amount;
    } else if (e.kind === "feature" && isFlagKey(e.featureFlag)) {
      if (!flags[e.featureFlag]) {
        flags[e.featureFlag] = true;
        unlockedFlags.push(e.featureFlag);
      }
    }
  }
  // 0 = unlimited: an add-on can't raise what has no ceiling.
  const raise = (base: number, extra: number) => (base === 0 ? 0 : extra);
  const tokens = raise(input.quotas.aiTokensPerMonth, extraTokens);
  const seats = raise(input.quotas.seatsIncluded, extraSeats);
  const storage = raise(input.quotas.storageGb, extraStorageGb);
  const quotas: TierQuotas =
    tokens + seats + storage === 0
      ? input.quotas
      : {
          ...input.quotas,
          aiTokensPerMonth: input.quotas.aiTokensPerMonth + tokens,
          seatsIncluded: input.quotas.seatsIncluded + seats,
          storageGb: input.quotas.storageGb + storage,
        };
  return { quotas, flags, extraTokens: tokens, extraSeats: seats, extraStorageGb: storage, unlockedFlags };
}

/** Whether a grant counts right now: active, started, not ended, and its catalogue entry still on sale or honoured. */
export function addonIsLive(
  grant: { status: string; startsAt: Date; endsAt: Date | null; addonActive: boolean },
  now: Date = new Date(),
): boolean {
  if (grant.status !== "active" || !grant.addonActive) return false;
  if (grant.startsAt.getTime() > now.getTime()) return false;
  if (grant.endsAt && grant.endsAt.getTime() <= now.getTime()) return false;
  return true;
}

export type AddonInput = {
  slug: string;
  name: string;
  description: string;
  kind: AddonKind;
  aiTokensPerMonth: number;
  featureFlag: keyof TierFeatureFlags | null;
  amountPerUnit: number;
  priceMonthlyCents: number;
  stripePriceId: string | null;
  sortOrder: number;
  active: boolean;
};

/**
 * Validate what the catalogue form sends. Whole numbers inside the
 * limits; a token top-up needs tokens, a feature unlock needs a flag.
 */
export function sanitizeAddonInput(raw: unknown): { ok: true; value: AddonInput } | { ok: false; error: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const slug = typeof r.slug === "string" ? r.slug.trim().toLowerCase() : "";
  if (!ADDON_LIMITS.slug.test(slug)) return { ok: false, error: "Slug: 2–32 lower-case letters, digits or hyphens, starting with a letter or digit." };
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name || name.length > ADDON_LIMITS.nameMax) return { ok: false, error: `Name: 1–${ADDON_LIMITS.nameMax} characters.` };
  const description = typeof r.description === "string" ? r.description.trim().slice(0, ADDON_LIMITS.descriptionMax) : "";
  const kind = r.kind as AddonKind;
  if (!(ADDON_KINDS as readonly unknown[]).includes(kind)) return { ok: false, error: "Kind: AI token top-up, feature unlock, extra seats or extra storage." };
  const whole = (v: unknown, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null);
  const aiTokensPerMonth = kind === "ai_tokens" ? whole(r.aiTokensPerMonth, ADDON_LIMITS.tokensMax) : 0;
  if (aiTokensPerMonth === null) return { ok: false, error: `Tokens per month: a whole number up to ${ADDON_LIMITS.tokensMax.toLocaleString()}.` };
  if (kind === "ai_tokens" && aiTokensPerMonth === 0) return { ok: false, error: "A token top-up must add at least one token per month." };
  const featureFlag = kind === "feature" ? (isFlagKey(r.featureFlag) ? r.featureFlag : null) : null;
  if (kind === "feature" && !featureFlag) return { ok: false, error: "A feature unlock needs a feature." };
  const sized = kind === "seats" || kind === "storage";
  const amountPerUnit = sized ? whole(r.amountPerUnit, ADDON_LIMITS.amountMax) : 0;
  if (amountPerUnit === null || (sized && amountPerUnit === 0)) {
    return { ok: false, error: `${kind === "seats" ? "Seats" : "GB"} per unit: a whole number from 1 to ${ADDON_LIMITS.amountMax.toLocaleString()}.` };
  }
  const priceMonthlyCents = whole(r.priceMonthlyCents, ADDON_LIMITS.priceCentsMax);
  if (priceMonthlyCents === null) return { ok: false, error: "Price: a whole number of cents." };
  const stripeRaw = typeof r.stripePriceId === "string" ? r.stripePriceId.trim() : "";
  if (stripeRaw.length > 128) return { ok: false, error: "Stripe Price id: 128 characters at most." };
  const sortOrder = typeof r.sortOrder === "number" && Number.isInteger(r.sortOrder) ? r.sortOrder : 0;
  const active = r.active !== false;
  return {
    ok: true,
    value: { slug, name, description, kind, aiTokensPerMonth, featureFlag, amountPerUnit, priceMonthlyCents, stripePriceId: stripeRaw || null, sortOrder, active },
  };
}

/** A grant quantity inside the limits, or null. */
export function sanitizeAddonQuantity(raw: unknown): number | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= ADDON_LIMITS.quantity.min && raw <= ADDON_LIMITS.quantity.max ? raw : null;
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString();
}

/** "+500K AI tokens / month", "+5 seats", "+50 GB storage" or "Unlocks Winner analysis". */
export function describeAddon(
  a: { kind: AddonKind; aiTokensPerMonth: number; featureFlag: keyof TierFeatureFlags | null; amountPerUnit?: number },
  quantity = 1,
): string {
  if (a.kind === "feature") return `Unlocks ${a.featureFlag ? ADDON_FLAG_LABELS[a.featureFlag] : "a feature"}`;
  const qty = Math.max(1, quantity);
  if (a.kind === "seats" || a.kind === "storage") {
    const per = a.amountPerUnit ?? 0;
    const unit = a.kind === "seats" ? (n: number) => `${n.toLocaleString()} seat${n === 1 ? "" : "s"}` : (n: number) => `${n.toLocaleString()} GB storage`;
    return `+${unit(per * qty)}${qty > 1 ? ` (${qty} × ${per.toLocaleString()})` : ""}`;
  }
  return `+${formatTokenCount(a.aiTokensPerMonth * qty)} AI tokens / month${qty > 1 ? ` (${qty} × ${formatTokenCount(a.aiTokensPerMonth)})` : ""}`;
}

export function formatMonthlyPrice(cents: number): string {
  if (cents === 0) return "Included";
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars.toLocaleString() : dollars.toFixed(2)}/mo`;
}

// ── Slice 2a — add-ons on the plan's own Stripe subscription ──────────

/** The parts of a Stripe subscription item the billing code reads. */
export type StripeItemLite = { id: string; priceId: string | null; quantity: number | null; interval: string | null };

/**
 * Which item of a subscription bills the plan and which bill add-ons,
 * told apart by Price: an item whose Price is an add-on's is an add-on;
 * the first other item is the plan. A subscription can carry the plan
 * and several add-ons on one invoice, in any order.
 */
export function splitSubscriptionItems(
  items: StripeItemLite[],
  addonPriceIds: ReadonlySet<string>,
): { planItem: StripeItemLite | null; addonItems: StripeItemLite[] } {
  const isAddon = (i: StripeItemLite) => !!i.priceId && addonPriceIds.has(i.priceId);
  return { planItem: items.find((i) => !isAddon(i)) ?? null, addonItems: items.filter(isAddon) };
}

/**
 * Can an add-on be billed as an item on the plan's subscription (one
 * invoice, prorated)? Only on a live plan, and only when the add-on's
 * Price recurs on the plan's interval — Stripe refuses mixed intervals,
 * so a yearly plan with a monthly add-on keeps a separate subscription.
 */
export function canBillOnPlan(input: { planStatus: string | null; planInterval: string | null; addonInterval: string | null }): boolean {
  const live = input.planStatus === "active" || input.planStatus === "trialing";
  return live && !!input.planInterval && input.planInterval === input.addonInterval;
}

/**
 * Line up a plan subscription's add-on items with the grants recorded
 * for it: grants whose item is gone end; items with a different
 * quantity update; items with no grant are new.
 */
export function reconcilePlanItems(
  grants: { id: string; itemId: string; quantity: number }[],
  items: { id: string; quantity: number }[],
): { end: string[]; quantity: { grantId: string; quantity: number }[]; added: string[] } {
  const byItem = new Map(items.map((i) => [i.id, i]));
  const granted = new Set(grants.map((g) => g.itemId));
  return {
    end: grants.filter((g) => !byItem.has(g.itemId)).map((g) => g.id),
    quantity: grants
      .filter((g) => byItem.has(g.itemId) && byItem.get(g.itemId)!.quantity !== g.quantity)
      .map((g) => ({ grantId: g.id, quantity: byItem.get(g.itemId)!.quantity })),
    added: items.filter((i) => !granted.has(i.id)).map((i) => i.id),
  };
}
