"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { setAiBudget, setAiFeatureRouting, type AiControlResult } from "@/lib/ai-engine-control";
import type { AiModelClass } from "@/lib/ai-routing";
import { runGoldenEval } from "@/lib/golden-eval";
import { runRetrievalEval } from "@/lib/retrieval-eval";
import { recordAudit } from "@/lib/audit-log";
import { rateGoldenDraft } from "@/lib/eval-ratings";
import type { JudgeScores } from "@/lib/draft-judge-logic";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";
import { log } from "@/lib/log";

/**
 * BL-AIP-7c — route one AI feature to a model class (or back to the tier
 * default). Org admins only; the lib refuses a platform-pinned model.
 */
export async function setAiFeatureRoutingAction(
  feature: string,
  value: "default" | AiModelClass,
): Promise<AiControlResult> {
  const { organizationId } = await requireCurrentOrg();
  const actor = await requireOrgAdmin(organizationId);
  const res = await setAiFeatureRouting({
    organizationId,
    feature,
    value,
    actor: { userId: actor.id, email: actor.email },
  });
  if (res.ok) revalidatePath("/settings/ai-engine");
  return res;
}

/**
 * BL-AIP-7c — set the organization's own monthly AI ceiling. Blank or a
 * value at or above the tier cap means the tier cap applies. Org admins
 * only.
 */
export async function setAiBudgetAction(input: {
  tokensPerMonth: number | null;
  requestsPerMonth: number | null;
}): Promise<AiControlResult> {
  const { organizationId } = await requireCurrentOrg();
  const actor = await requireOrgAdmin(organizationId);
  const res = await setAiBudget({
    organizationId,
    budget: {
      tokensPerMonth: input.tokensPerMonth ?? undefined,
      requestsPerMonth: input.requestsPerMonth ?? undefined,
    },
    actor: { userId: actor.id, email: actor.email },
  });
  if (res.ok) revalidatePath("/settings/ai-engine");
  return res.ok ? { ok: true } : res;
}

/**
 * BL-AIP-5b — run the golden eval for this org: re-draft up to
 * `maxCases` sections of won proposals and score each against the text
 * that won. Org admins only. Two requests per case against the monthly
 * AI quota: the draft and (BL-AIX Phase 1h-2) the rubric judge; slots
 * not used are refunded.
 */
export async function runGoldenEvalAction(
  maxCases = 3,
): Promise<
  | { ok: true; runId: string; caseCount: number; meanScore: number; stubbed: boolean }
  | { ok: false; error: string }
> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const cases = Math.max(1, Math.min(5, Math.floor(maxCases)));
  let reserved = 0;
  try {
    await ensureFeature(organizationId, "aiAutoDraft");
    for (let i = 0; i < cases * 2; i++) {
      await enforceQuota(organizationId, "aiRequestsPerMonth");
      reserved += 1;
    }
  } catch (err) {
    for (let i = 0; i < reserved; i++) await refundQuota(organizationId, "aiRequestsPerMonth");
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  try {
    const res = await runGoldenEval({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      maxCases: cases,
    });
    if (!res.ok) {
      for (let i = 0; i < reserved; i++) await refundQuota(organizationId, "aiRequestsPerMonth");
      return res;
    }
    // Drafts and judgements that never reached the model give their slot back.
    for (let i = res.run.caseCount + res.judged; i < reserved; i++) {
      await refundQuota(organizationId, "aiRequestsPerMonth");
    }
    revalidatePath("/settings/ai-engine");
    return {
      ok: true,
      runId: res.run.id,
      caseCount: res.run.caseCount,
      meanScore: res.run.meanScore,
      stubbed: res.run.stubbed,
    };
  } catch (err) {
    for (let i = 0; i < reserved; i++) await refundQuota(organizationId, "aiRequestsPerMonth");
    log.error("[runGoldenEvalAction]", "error", { error: err });
    return { ok: false, error: err instanceof Error ? err.message : "Eval failed." };
  }
}

/**
 * BL-AIX Phase 1h-1 — run the Brain retrieval eval for this org: search
 * for sections of its own won proposals the way the drafter does and
 * score whether their winning text comes back. Org admins only. No model
 * call: one query embedding per search, metered like any search.
 */
export async function runRetrievalEvalAction(): Promise<
  { ok: true; runId: string; caseCount: number } | { ok: false; error: string }
> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);
  try {
    const res = await runRetrievalEval({ organizationId, actor: { userId: actor.id, email: actor.email } });
    if (!res.ok) return res;
    revalidatePath("/settings/ai-engine");
    return { ok: true, runId: res.run.id, caseCount: res.run.caseCount };
  } catch (err) {
    log.error("[runRetrievalEvalAction]", "error", { error: err });
    return { ok: false, error: err instanceof Error ? err.message : "Retrieval eval failed." };
  }
}

/**
 * BL-AIX Phase 1h-2 — an expert rates one golden-eval draft on the
 * judge's rubric; the judge is trusted once enough ratings agree with
 * it. Any member of the organization may rate; the run must be its own.
 */
export async function rateGoldenDraftAction(input: {
  runId: string;
  sectionId: string;
  scores: Partial<JudgeScores>;
  note: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await rateGoldenDraft({ organizationId, raterUserId: actor.id, ...input });
  if (!res.ok) return res;
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "ai.eval.rate",
    resourceType: "ai_eval_run",
    resourceId: input.runId,
    metadata: { sectionId: input.sectionId, overall: input.scores.overall },
  });
  revalidatePath("/settings/ai-engine");
  return { ok: true };
}
