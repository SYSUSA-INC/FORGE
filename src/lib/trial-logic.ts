/**
 * BL-AUTH-ABUSE Slice 2a — trials, the pure half.
 *
 * A trial is `tenant_subscription.status = 'trial'` with `trial_until`.
 * Decisions (2026-10-04): 14 days; at expiry without a plan the
 * workspace keeps full editing — reading, writing, creating proposals,
 * inviting, uploading and exporting all carry on — while AI pauses (AI
 * calls and the AI-powered features) until a plan is chosen or a
 * platform admin extends the trial.
 *
 * No I/O; tested in tests/ai/trial-logic.test.ts.
 */

import type { TierFeatureFlags } from "@/db/schema";

export const TRIAL_DAYS = 14;

/**
 * The feature flags that switch on AI-powered actions (auto-draft and
 * chat, winner / protest analysis, compliance preflight and auto-map).
 * They pause when a trial ends; every other flag keeps the tier's value.
 */
export const TRIAL_PAUSED_FLAGS = ["aiAutoDraft", "winnerAnalysis", "complianceMatrix"] as const satisfies readonly (keyof TierFeatureFlags)[];

/** The flags with the AI ones switched off. */
export function pauseAiFlags(flags: TierFeatureFlags): TierFeatureFlags {
  const out = { ...flags };
  for (const k of TRIAL_PAUSED_FLAGS) out[k] = false;
  return out;
}
export const TRIAL_EXTEND_LIMITS = { min: 1, max: 90 } as const;
const DAY_MS = 86_400_000;

export type TrialState =
  | { kind: "none" }
  /** `endsAt` null = a trial row with no end date (set by hand); it never expires on its own. */
  | { kind: "active"; endsAt: Date | null; daysLeft: number | null }
  | { kind: "expired"; endedAt: Date };

/** What a subscription's status and `trial_until` mean right now. */
export function trialState(status: string | null | undefined, trialUntil: Date | null | undefined, now: Date = new Date()): TrialState {
  if (status !== "trial") return { kind: "none" };
  if (!trialUntil) return { kind: "active", endsAt: null, daysLeft: null };
  if (trialUntil.getTime() <= now.getTime()) return { kind: "expired", endedAt: trialUntil };
  return { kind: "active", endsAt: trialUntil, daysLeft: Math.ceil((trialUntil.getTime() - now.getTime()) / DAY_MS) };
}

/** When a trial started now for `days` days ends. */
export function trialEndFrom(start: Date, days: number = TRIAL_DAYS): Date {
  return new Date(start.getTime() + days * DAY_MS);
}

/**
 * The new end of an extended trial: `days` more from the later of now
 * and the current end, so extending an expired trial gives the full
 * `days` from today and extending a live one adds to what is left.
 */
export function extendedTrialEnd(current: Date | null | undefined, days: number, now: Date = new Date()): Date {
  const from = current && current.getTime() > now.getTime() ? current : now;
  return new Date(from.getTime() + days * DAY_MS);
}

/** Whole days inside the extension limits, or null. */
export function sanitizeTrialDays(raw: unknown): number | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= TRIAL_EXTEND_LIMITS.min && raw <= TRIAL_EXTEND_LIMITS.max ? raw : null;
}

function day(d: Date): string {
  return d.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
}

/** The refusal every gate gives once a trial has ended. */
export function trialExpiredMessage(endedAt: Date): string {
  return `Your FORGE trial ended on ${day(endedAt)}. Editing carries on as usual; AI features are paused until a plan is chosen under Settings → Billing.`;
}

/** The banner line for a workspace on trial, or null when there is nothing to say. */
export function trialBannerText(state: TrialState): { tone: "info" | "warn" | "ended"; text: string } | null {
  if (state.kind === "none") return null;
  if (state.kind === "expired") {
    return { tone: "ended", text: `Your trial ended on ${day(state.endedAt)}. Editing carries on; AI features are paused until a plan is chosen.` };
  }
  if (!state.endsAt || state.daysLeft === null) return { tone: "info", text: "You're on a FORGE trial." };
  const left = state.daysLeft === 1 ? "1 day" : `${state.daysLeft} days`;
  return { tone: state.daysLeft <= 3 ? "warn" : "info", text: `Trial: ${left} left (ends ${day(state.endsAt)}).` };
}
