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

export const ADDON_KINDS = ["ai_tokens", "feature"] as const;
export type AddonKind = (typeof ADDON_KINDS)[number];

export const ADDON_KIND_LABELS: Record<AddonKind, string> = {
  ai_tokens: "AI token top-up",
  feature: "Feature unlock",
};

export const ADDON_FLAG_KEYS = [
  "aiAutoDraft",
  "winnerAnalysis",
  "complianceMatrix",
  "bulkExport",
  "apiAccess",
  "customTemplates",
] as const satisfies readonly (keyof TierFeatureFlags)[];

export const ADDON_FLAG_LABELS: Record<keyof TierFeatureFlags, string> = {
  aiAutoDraft: "AI auto-draft",
  winnerAnalysis: "Winner analysis",
  complianceMatrix: "Compliance matrix",
  bulkExport: "Bulk export",
  apiAccess: "API access",
  customTemplates: "Custom templates",
};

export const ADDON_LIMITS = {
  slug: /^[a-z0-9][a-z0-9-]{1,31}$/,
  nameMax: 64,
  descriptionMax: 500,
  tokensMax: 1_000_000_000,
  priceCentsMax: 10_000_000,
  quantity: { min: 1, max: 100 },
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
  priceMonthlyCents: number;
  quantity: number;
  status: "active" | "canceled";
  source: "manual" | "stripe";
  stripeSubscriptionId: string | null;
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
  quantity: number;
};

export type AddonEffectsApplied = {
  quotas: TierQuotas;
  flags: TierFeatureFlags;
  /** Tokens the live top-ups add per month (0 when the tier is already unlimited or there are none). */
  extraTokens: number;
  /** Flags the live unlocks turned on that the tier and overrides had off. */
  unlockedFlags: (keyof TierFeatureFlags)[];
};

function isFlagKey(key: unknown): key is keyof TierFeatureFlags {
  return typeof key === "string" && (ADDON_FLAG_KEYS as readonly string[]).includes(key);
}

/**
 * Add the live grants' effects on top of a tier's merged quotas and
 * flags. A tier cap of 0 means unlimited and stays 0; a feature already
 * on stays on and is not counted as unlocked.
 */
export function applyAddonEffects(input: {
  quotas: TierQuotas;
  flags: TierFeatureFlags;
  effects: AddonEffect[];
}): AddonEffectsApplied {
  let extraTokens = 0;
  const flags: TierFeatureFlags = { ...input.flags };
  const unlockedFlags: (keyof TierFeatureFlags)[] = [];
  for (const e of input.effects) {
    const qty = Math.max(1, Math.floor(e.quantity || 1));
    if (e.kind === "ai_tokens") {
      extraTokens += Math.max(0, Math.floor(e.aiTokensPerMonth || 0)) * qty;
    } else if (e.kind === "feature" && isFlagKey(e.featureFlag)) {
      if (!flags[e.featureFlag]) {
        flags[e.featureFlag] = true;
        unlockedFlags.push(e.featureFlag);
      }
    }
  }
  const unlimited = input.quotas.aiTokensPerMonth === 0;
  const quotas: TierQuotas = unlimited || extraTokens === 0 ? input.quotas : { ...input.quotas, aiTokensPerMonth: input.quotas.aiTokensPerMonth + extraTokens };
  return { quotas, flags, extraTokens: unlimited ? 0 : extraTokens, unlockedFlags };
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
  const kind = r.kind;
  if (kind !== "ai_tokens" && kind !== "feature") return { ok: false, error: "Kind: AI token top-up or feature unlock." };
  const whole = (v: unknown, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null);
  const aiTokensPerMonth = kind === "ai_tokens" ? whole(r.aiTokensPerMonth, ADDON_LIMITS.tokensMax) : 0;
  if (aiTokensPerMonth === null) return { ok: false, error: `Tokens per month: a whole number up to ${ADDON_LIMITS.tokensMax.toLocaleString()}.` };
  if (kind === "ai_tokens" && aiTokensPerMonth === 0) return { ok: false, error: "A token top-up must add at least one token per month." };
  const featureFlag = kind === "feature" ? (isFlagKey(r.featureFlag) ? r.featureFlag : null) : null;
  if (kind === "feature" && !featureFlag) return { ok: false, error: "A feature unlock needs a feature." };
  const priceMonthlyCents = whole(r.priceMonthlyCents, ADDON_LIMITS.priceCentsMax);
  if (priceMonthlyCents === null) return { ok: false, error: "Price: a whole number of cents." };
  const stripeRaw = typeof r.stripePriceId === "string" ? r.stripePriceId.trim() : "";
  if (stripeRaw.length > 128) return { ok: false, error: "Stripe Price id: 128 characters at most." };
  const sortOrder = typeof r.sortOrder === "number" && Number.isInteger(r.sortOrder) ? r.sortOrder : 0;
  const active = r.active !== false;
  return {
    ok: true,
    value: { slug, name, description, kind, aiTokensPerMonth, featureFlag, priceMonthlyCents, stripePriceId: stripeRaw || null, sortOrder, active },
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

/** "+500K AI tokens / month" or "Unlocks Winner analysis". */
export function describeAddon(a: { kind: AddonKind; aiTokensPerMonth: number; featureFlag: keyof TierFeatureFlags | null }, quantity = 1): string {
  if (a.kind === "feature") return `Unlocks ${a.featureFlag ? ADDON_FLAG_LABELS[a.featureFlag] : "a feature"}`;
  const qty = Math.max(1, quantity);
  return `+${formatTokenCount(a.aiTokensPerMonth * qty)} AI tokens / month${qty > 1 ? ` (${qty} × ${formatTokenCount(a.aiTokensPerMonth)})` : ""}`;
}

export function formatMonthlyPrice(cents: number): string {
  if (cents === 0) return "Included";
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars.toLocaleString() : dollars.toFixed(2)}/mo`;
}
