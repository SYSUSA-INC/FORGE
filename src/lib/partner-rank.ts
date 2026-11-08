import "server-only";

import { completeStructuredForTenant } from "@/lib/ai";
import { recordRead } from "@/lib/audit-log";
import { capabilityGaps, buildPartnerRankPrompt, partnerRankSchema, PARTNER_RANK_CANDIDATES, validateRanking, type RankedPartner } from "@/lib/partner-rank-logic";
import { loadCapabilityMatrix, loadOwnedOpportunity } from "@/lib/capability-matrix-build";
import { log } from "@/lib/log";
import { searchPartners, type PartnerSearchResult } from "@/lib/partner-search";
import type { PartnerCert, PartnerHit } from "@/lib/partner-search-logic";
import { enforceRateLimit } from "@/lib/rate-limit";
import { enforceQuota, ensureFeature, FeatureGateError, QuotaExceededError, refundQuota } from "@/lib/subscription-gates";

/**
 * BL-NAV-LIFECYCLE phase 3b (C-3, C-4) — FORGE AI's ranked partner list for
 * one opportunity. Runs the partner database search (`searchPartners`:
 * `widen` is Find more), shows the AI the capability matrix's No and
 * Partial answers and the search's facts, and keeps only the picks whose
 * reasons rest on a fact the search returned (`validateRanking`). The
 * search is recorded as a read by `searchPartners`; the ranking is
 * recorded as `opportunity.partner.rank`. Callers own auth.
 */
type Actor = { userId: string; email?: string | null };

export type RankedHit = RankedPartner & { hit: PartnerHit };

export type PartnerRankResult =
  | {
      ok: true;
      ranked: RankedHit[];
      /** Every firm the search returned, for the plain list under the AI's picks. */
      hits: PartnerHit[];
      notes: string[];
      criteria: Extract<PartnerSearchResult, { ok: true }>["criteria"];
      /** Picks the AI made that didn't rest on a returned fact, and were left out. */
      dropped: number;
    }
  | { ok: false; error: string };

const RATE = { limit: 20, windowSeconds: 3600 };

export async function rankPartners(input: {
  organizationId: string;
  opportunityId: string;
  actor: Actor;
  state?: string;
  cert?: PartnerCert | "";
  widen?: boolean;
}): Promise<PartnerRankResult> {
  const { organizationId, opportunityId } = input;
  try {
    await ensureFeature(organizationId, "aiAutoDraft");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) return { ok: false, error: err.message };
    throw err;
  }
  // From here the quota is spent: every way out that isn't an AI answer refunds it.
  const fail = async (error: string): Promise<PartnerRankResult> => {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return { ok: false, error };
  };

  const limit = await enforceRateLimit({ key: `partner-rank:${organizationId}`, ...RATE });
  if (!limit.ok) return fail(`Ranking limit reached (${RATE.limit}/hour). Retry in ${Math.ceil(limit.retryAfter / 60)} min.`);

  try {
    const search = await searchPartners({ organizationId, opportunityId, actor: input.actor, state: input.state, cert: input.cert, widen: input.widen });
    if (!search.ok) return fail(search.error);
    if (search.hits.length === 0) return fail("The search found no firm to rank. Try without a state or certification, or Find more.");

    const [opp, matrix] = await Promise.all([loadOwnedOpportunity(opportunityId, organizationId), loadCapabilityMatrix(opportunityId, organizationId)]);
    if (!opp) return fail("Opportunity not found.");
    const gaps = matrix ? capabilityGaps(matrix.questions, matrix.answers) : [];
    const candidates = search.hits.slice(0, PARTNER_RANK_CANDIDATES);
    const prompt = buildPartnerRankPrompt({
      opportunity: { title: opp.title, agency: opp.agency, setAside: opp.setAside, placeOfPerformance: opp.placeOfPerformance },
      criteria: search.criteria,
      gaps,
      candidates,
      widened: search.criteria.widened,
    });
    const res = await completeStructuredForTenant({
      organizationId,
      feature: "partner_rank",
      schema: partnerRankSchema,
      toolName: "record_partner_ranking",
      toolDescription: "Record the best partners in order, each with a reason and the numbers of the facts the reason rests on.",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 2500,
      temperature: 0.2,
      cacheSystem: true,
    });
    if (res.stubbed) return fail("AI provider is in stub mode. Configure a provider to rank partners.");
    if (!res.data) {
      log.warn("[partner-rank]", "structured parse failed", { parseError: res.parseError, viaTool: res.viaTool });
      return fail("FORGE AI returned an unexpected format. Try again.");
    }

    const { ranked, dropped } = validateRanking(res.data, candidates, search.criteria);
    const byUei = new Map(candidates.map((h) => [h.uei.toUpperCase(), h]));
    const withHits: RankedHit[] = ranked.flatMap((r) => {
      const hit = byUei.get(r.uei);
      return hit ? [{ ...r, hit }] : [];
    });
    await recordRead({
      organizationId,
      actor: input.actor,
      action: "opportunity.partner.rank",
      resourceType: "opportunity",
      resourceId: opportunityId,
      metadata: { widened: search.criteria.widened, gaps: gaps.length, candidates: candidates.length, ranked: withHits.length, dropped },
    });
    if (withHits.length === 0) return fail("FORGE AI's reasons didn't rest on facts from the search, so none were kept. Try again, or use the plain list.");
    return { ok: true, ranked: withHits, hits: search.hits, notes: search.notes, criteria: search.criteria, dropped };
  } catch (err) {
    log.error("[partner-rank]", "failed", { opportunityId, error: err });
    return fail(err instanceof Error ? err.message : "FORGE AI couldn't rank the partners.");
  }
}
