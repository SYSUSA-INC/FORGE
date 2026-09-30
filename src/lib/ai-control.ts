/**
 * BL-AIP-7c — the AI Engine control panel, pure parts.
 *
 *   budget   — a tenant admin's own monthly ceiling on tokens and
 *              requests. It can only lower the tier's cap (a platform
 *              admin raises caps through `customOverrides.quotas`), and
 *              the existing gates enforce whatever is lower.
 *   burn-down — month-to-date use against a cap with the pace so far:
 *              projected month-end total and the day the cap is reached
 *              at that pace.
 *   routing  — every AI feature with its default class, the tenant's
 *              override (a class it chose, or a model a platform admin
 *              pinned) and the model the gateway will actually request.
 *
 * Unit-tested; no DB, no server-only.
 */
import type { TierQuotas } from "@/db/schema";
import { AI_FEATURES, aiFeatureLabel, type AiFeature } from "@/lib/ai-features";
import {
  AI_FEATURE_MODEL_CLASS,
  isModelClass,
  resolveModelForFeature,
  type AiModelClass,
  type ModelRouteSource,
} from "@/lib/ai-routing";
import type { AIProviderName } from "@/lib/ai";

export type AiBudget = { tokensPerMonth?: number; requestsPerMonth?: number };

function positiveInt(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/**
 * Keep only budget values that lower the tier's cap: a value at or
 * above the cap (or nothing at all) means "the tier cap applies".
 */
export function sanitizeBudget(
  input: { tokensPerMonth?: unknown; requestsPerMonth?: unknown },
  tierQuotas: Pick<TierQuotas, "aiTokensPerMonth" | "aiRequestsPerMonth">,
): AiBudget {
  const out: AiBudget = {};
  const tokens = positiveInt(input.tokensPerMonth);
  if (tokens !== null && (tierQuotas.aiTokensPerMonth === 0 || tokens < tierQuotas.aiTokensPerMonth)) {
    out.tokensPerMonth = tokens;
  }
  const requests = positiveInt(input.requestsPerMonth);
  if (
    requests !== null &&
    (tierQuotas.aiRequestsPerMonth === 0 || requests < tierQuotas.aiRequestsPerMonth)
  ) {
    out.requestsPerMonth = requests;
  }
  return out;
}

function lowerOf(cap: number, budget: number | undefined): number {
  if (!budget || budget <= 0) return cap;
  return cap === 0 || budget < cap ? budget : cap;
}

/** The effective quotas once the tenant's budget is applied (it only lowers). */
export function applyAiBudget(quotas: TierQuotas, budget: AiBudget | null | undefined): TierQuotas {
  if (!budget) return quotas;
  return {
    ...quotas,
    aiTokensPerMonth: lowerOf(quotas.aiTokensPerMonth, budget.tokensPerMonth),
    aiRequestsPerMonth: lowerOf(quotas.aiRequestsPerMonth, budget.requestsPerMonth),
  };
}

export type BurnStatus = "unlimited" | "healthy" | "approaching" | "at_cap";

export type BurnDown = {
  used: number;
  /** 0 = unlimited. */
  cap: number;
  /** Percent of the cap used, one decimal; null when unlimited. */
  percent: number | null;
  dayOfMonth: number;
  daysInMonth: number;
  /** Average use per elapsed day this month. */
  perDay: number;
  /** Month-end total at the current pace. */
  projected: number;
  /** Day of the month the cap is reached at the current pace; null when it is not reached this month. */
  capDay: number | null;
  status: BurnStatus;
};

/** Month-to-date use against a cap, with the pace so far. UTC calendar month. */
export function burnDown(input: { used: number; cap: number; now: Date }): BurnDown {
  const { now } = input;
  const used = Math.max(0, input.used);
  const cap = Math.max(0, input.cap);
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const dayOfMonth = now.getUTCDate();
  const elapsedDays = dayOfMonth - 1 + (now.getUTCHours() * 60 + now.getUTCMinutes()) / (24 * 60);
  const perDay = elapsedDays > 0 ? used / elapsedDays : used;
  const projected = Math.round(perDay * daysInMonth);
  const percent = cap > 0 ? Math.round((used / cap) * 1000) / 10 : null;

  let capDay: number | null = null;
  if (cap > 0 && used < cap && perDay > 0) {
    const day = Math.ceil(cap / perDay);
    capDay = day <= daysInMonth ? day : null;
  }

  let status: BurnStatus = "healthy";
  if (cap === 0) status = "unlimited";
  else if (used >= cap) status = "at_cap";
  else if ((percent ?? 0) >= 80 || capDay !== null) status = "approaching";

  return { used, cap, percent, dayOfMonth, daysInMonth, perDay, projected, capDay, status };
}

export type FeatureOverride =
  | { kind: "class"; cls: AiModelClass }
  | { kind: "model"; model: string }
  | null;

export type FeatureRoutingRow = {
  feature: AiFeature;
  label: string;
  defaultClass: AiModelClass;
  override: FeatureOverride;
  /** The class the request is routed as (the override's class, or the default). */
  effectiveClass: AiModelClass;
  /** What the gateway will request; null = the provider's default model. */
  effectiveModel: string | null;
  source: ModelRouteSource;
};

/** One row per AI feature, in registry order. */
export function featureRoutingRows(
  overrides: Record<string, string> | null | undefined,
  provider: AIProviderName,
): FeatureRoutingRow[] {
  const map = overrides ?? {};
  return (Object.keys(AI_FEATURES) as AiFeature[]).map((feature) => {
    const raw = map[feature];
    const override: FeatureOverride = isModelClass(raw)
      ? { kind: "class", cls: raw }
      : typeof raw === "string" && raw.trim()
        ? { kind: "model", model: raw.trim() }
        : null;
    const route = resolveModelForFeature({ feature, provider, tenantOverrides: map });
    return {
      feature,
      label: aiFeatureLabel(feature),
      defaultClass: AI_FEATURE_MODEL_CLASS[feature],
      override,
      effectiveClass: route.modelClass,
      effectiveModel: route.model,
      source: route.source,
    };
  });
}
