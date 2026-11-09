import "server-only";

import { completeStructuredForTenant } from "@/lib/ai";
import { recordRead } from "@/lib/audit-log";
import { loadCapabilityMatrix } from "@/lib/capability-matrix-build";
import { listOpportunityPartners } from "@/lib/capture-store";
import { log } from "@/lib/log";
import { latestDecisions } from "@/lib/opportunity-decision-store";
import { buildCharterPrompt, charterDraftSchema, charterFacts, validateCharterDraft } from "@/lib/plan-charter-logic";
import { keyDatesOf, loadCharterPanel, opportunityTitleOf, storeCharterDraft } from "@/lib/plan-charter-store";
import { enforceRateLimit } from "@/lib/rate-limit";
import { enforceQuota, ensureFeature, FeatureGateError, QuotaExceededError, refundQuota } from "@/lib/subscription-gates";

/**
 * BL-NAV-LIFECYCLE 4c-1 (P-2) — FORGE AI's draft of the bid charter,
 * from numbered facts in FORGE's own records: the decision, the
 * capability matrix, the chosen partners and the key dates. Every
 * claim cites the facts it rests on; `validateCharterDraft` keeps only
 * those that do and the cited facts are stored as the charter's sources.
 * Recorded as the read `opportunity.plan.charter.draft_ai`. Callers own auth.
 */
type Actor = { userId: string; email?: string | null };

export type CharterDraftResult = { ok: true; dropped: number; sources: number } | { ok: false; error: string };

const RATE = { limit: 10, windowSeconds: 3600 };

export async function draftCharter(input: { organizationId: string; opportunityId: string; actor: Actor }): Promise<CharterDraftResult> {
  const { organizationId, opportunityId } = input;
  try {
    await ensureFeature(organizationId, "aiAutoDraft");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) return { ok: false, error: err.message };
    throw err;
  }
  const fail = async (error: string): Promise<CharterDraftResult> => {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return { ok: false, error };
  };
  const limit = await enforceRateLimit({ key: `plan-charter-draft:${organizationId}`, ...RATE });
  if (!limit.ok) return fail(`Draft limit reached (${RATE.limit}/hour). Retry in ${Math.ceil(limit.retryAfter / 60)} min.`);

  try {
    const panel = await loadCharterPanel({ organizationId, opportunityId });
    const opp = await opportunityTitleOf(organizationId, opportunityId);
    if (!panel || !opp) return fail("Open the plan first.");
    if (panel.status === "signed") return fail("The charter is signed. Reopen it to redraft.");
    const [decision, matrix, partners] = await Promise.all([
      latestDecisions(organizationId, [opportunityId]).then((m) => m.get(opportunityId) ?? null),
      loadCapabilityMatrix(opportunityId, organizationId),
      listOpportunityPartners(organizationId, opportunityId),
    ]);
    const keyDates = await keyDatesOf(organizationId, panel.solicitationId);
    const answered: Record<string, number> = {};
    for (const a of Object.values(matrix?.answers ?? {})) answered[a.value] = (answered[a.value] ?? 0) + 1;
    const facts = charterFacts({
      decision,
      matrix: matrix ? { questions: matrix.questions.length, answered } : null,
      partners: partners.filter((p) => p.status === "chosen"),
      dates: keyDates.slice(0, 8).map((k) => `Key date ${k.label || k.type}: ${k.isoDate.slice(0, 10)}`),
      winThemes: panel.charter.winThemes?.length ? panel.charter.winThemes : panel.proposalThemes,
    });
    if (!decision && !matrix) return fail("Decide Go or Partner under Evaluate first: the draft rests on that record.");
    const prompt = buildCharterPrompt({ opportunity: opp, isPartner: panel.isPartner, facts });
    const res = await completeStructuredForTenant({
      organizationId,
      feature: "plan_charter_draft",
      schema: charterDraftSchema,
      toolName: "record_charter",
      toolDescription: "Record the bid charter: strategy, pricing posture, partner share and discriminators, each with the numbers of the facts it rests on.",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 2500,
      temperature: 0.2,
      cacheSystem: true,
    });
    if (res.stubbed) return fail("AI provider is in stub mode. Configure a provider to draft the charter.");
    if (!res.data) {
      log.warn("[plan-charter-draft]", "structured parse failed", { parseError: res.parseError, viaTool: res.viaTool });
      return fail("FORGE AI returned an unexpected format. Try again.");
    }
    const { charter, dropped } = validateCharterDraft(res.data, facts, new Date());
    await recordRead({
      organizationId,
      actor: input.actor,
      action: "opportunity.plan.charter.draft_ai",
      resourceType: "opportunity",
      resourceId: opportunityId,
      metadata: { facts: facts.length, dropped, kept: charter.sources?.length ?? 0 },
    });
    if (!charter.strategy && !charter.pricingPosture && !(charter.discriminators ?? []).length) return fail("FORGE AI's draft didn't rest on the records, so none of it was kept. Try again.");
    const saved = await storeCharterDraft({ organizationId, opportunityId, draft: charter, actor: input.actor, dropped });
    if (!saved.ok) return fail(saved.error);
    return { ok: true, dropped, sources: charter.sources?.length ?? 0 };
  } catch (err) {
    log.error("[plan-charter-draft]", "failed", { opportunityId, error: err });
    return fail(err instanceof Error ? err.message : "FORGE AI couldn't draft the charter.");
  }
}
