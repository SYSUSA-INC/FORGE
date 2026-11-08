import "server-only";

import { completeStructuredForTenant } from "@/lib/ai";
import { recordRead } from "@/lib/audit-log";
import { loadCapabilityMatrix, loadOwnedOpportunity } from "@/lib/capability-matrix-build";
import { listPartnerAnswerSheets } from "@/lib/capture-store";
import { log } from "@/lib/log";
import { buildPartnerRatePrompt, partnerRateSchema, scorePartners, validateRating, type RatedPartner } from "@/lib/partner-compare-logic";
import { enforceRateLimit } from "@/lib/rate-limit";
import { enforceQuota, ensureFeature, FeatureGateError, QuotaExceededError, refundQuota } from "@/lib/subscription-gates";

/**
 * BL-NAV-LIFECYCLE phase 3c-2 (C-7) — FORGE AI's rating of the partners
 * that answered the capability questions on one opportunity. The score
 * is computed first (`scorePartners`: gaps closed weighted like coverage,
 * evidence, certifications) and fixes the order; the AI writes one
 * reason per partner from numbered facts, and `validateRating` keeps
 * only the reasons that rest on them. Recorded as the read
 * `opportunity.partner.rate`. Callers own auth.
 */
type Actor = { userId: string; email?: string | null };

export type PartnerRateResult =
  | {
      ok: true;
      rated: RatedPartner[];
      gaps: number;
      /** Reasons the AI gave that didn't rest on the facts, and were left out. */
      dropped: number;
    }
  | { ok: false; error: string };

const RATE = { limit: 10, windowSeconds: 3600 };

export async function ratePartners(input: { organizationId: string; opportunityId: string; actor: Actor }): Promise<PartnerRateResult> {
  const { organizationId, opportunityId } = input;
  try {
    await ensureFeature(organizationId, "aiAutoDraft");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) return { ok: false, error: err.message };
    throw err;
  }
  // From here the quota is spent: every way out that isn't an AI answer refunds it.
  const fail = async (error: string): Promise<PartnerRateResult> => {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return { ok: false, error };
  };

  const limit = await enforceRateLimit({ key: `partner-rate:${organizationId}`, ...RATE });
  if (!limit.ok) return fail(`Rating limit reached (${RATE.limit}/hour). Retry in ${Math.ceil(limit.retryAfter / 60)} min.`);

  try {
    const [opp, matrix, partners] = await Promise.all([loadOwnedOpportunity(opportunityId, organizationId), loadCapabilityMatrix(opportunityId, organizationId), listPartnerAnswerSheets(organizationId, opportunityId)]);
    if (!opp) return fail("Opportunity not found.");
    if (!matrix || matrix.questions.length === 0) return fail("Build the capability questions under Evaluate first.");
    if (partners.length === 0) return fail("No partner has answered the questions yet.");
    const scored = scorePartners(matrix.questions, matrix.answers, partners);
    const gaps = scored[0]?.gaps ?? 0;
    const prompt = buildPartnerRatePrompt({ opportunity: { title: opp.title, agency: opp.agency }, gaps, scored });
    const res = await completeStructuredForTenant({
      organizationId,
      feature: "partner_rate",
      schema: partnerRateSchema,
      toolName: "record_partner_rating",
      toolDescription: "Record one reason per partner, in the given order, with the numbers of the facts each reason rests on.",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 2500,
      temperature: 0.2,
      cacheSystem: true,
    });
    if (res.stubbed) return fail("AI provider is in stub mode. Configure a provider to rate partners.");
    if (!res.data) {
      log.warn("[partner-rate]", "structured parse failed", { parseError: res.parseError, viaTool: res.viaTool });
      return fail("FORGE AI returned an unexpected format. Try again.");
    }
    const { rated, dropped } = validateRating(res.data, scored);
    await recordRead({
      organizationId,
      actor: input.actor,
      action: "opportunity.partner.rate",
      resourceType: "opportunity",
      resourceId: opportunityId,
      metadata: { gaps, partners: scored.length, reasons: rated.filter((r) => r.reason).length, dropped, order: scored.map((s) => s.id) },
    });
    if (!rated.some((r) => r.reason)) return fail("FORGE AI's reasons didn't rest on the partners' answers, so none were kept. Try again.");
    return { ok: true, rated, gaps, dropped };
  } catch (err) {
    log.error("[partner-rate]", "failed", { opportunityId, error: err });
    return fail(err instanceof Error ? err.message : "FORGE AI couldn't rate the partners.");
  }
}
