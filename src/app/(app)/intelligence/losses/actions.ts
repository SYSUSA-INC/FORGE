"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { completeStructuredForTenant } from "@/lib/ai";
import { buildLossNarrativePrompt, lossNarrativeSchema, type LossNarrative } from "@/lib/ai-prompts-loss";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { getLossIntelligence } from "@/lib/loss-intelligence";
import { LOSS_NARRATIVE_MIN_DECIDED } from "@/lib/loss-patterns";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";
import { log } from "@/lib/log";

export type LossNarrativeResult =
  | {
      ok: true;
      narrative: LossNarrative;
      provider: string;
      model: string;
      stubbed: boolean;
      generatedAt: string;
      patternsConsidered: number;
    }
  | { ok: false; error: string };

/**
 * BL-FB-WIN-CROSS-LOSS — explain the detected loss patterns and turn
 * them into next actions. Structured output; the model is told to cite
 * pattern ids and never to add patterns the detector did not find.
 */
export async function generateLossNarrativeAction(): Promise<LossNarrativeResult> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  try {
    await ensureFeature(organizationId, "aiAutoDraft");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  const limit = await enforceRateLimit({
    key: `loss-narrative:${organizationId}`,
    limit: 10,
    windowSeconds: 3600,
  });
  if (!limit.ok) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return {
      ok: false,
      error: `Narrative limit reached (10/hour). Retry in ${Math.ceil(limit.retryAfter / 60)} min.`,
    };
  }

  const intel = await getLossIntelligence(organizationId);
  if (intel.decided < LOSS_NARRATIVE_MIN_DECIDED) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return {
      ok: false,
      error: `Record at least ${LOSS_NARRATIVE_MIN_DECIDED} decided outcomes (won or lost) before generating a narrative.`,
    };
  }

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  try {
    const prompt = buildLossNarrativePrompt({
      organizationName: org?.name ?? "your organization",
      intel,
    });
    const res = await completeStructuredForTenant({
      organizationId,
      feature: "loss_intelligence",
      schema: lossNarrativeSchema,
      toolName: "record_loss_narrative",
      toolDescription:
        "Record the loss-intelligence narrative: headline, grounded insights with actions and cited pattern ids, and caveats.",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 1500,
      temperature: 0.3,
      cacheSystem: true,
    });

    if (res.stubbed) {
      await refundQuota(organizationId, "aiRequestsPerMonth");
      return {
        ok: false,
        error: "AI provider is in stub mode — configure a provider to generate narratives.",
      };
    }
    if (!res.data) {
      await refundQuota(organizationId, "aiRequestsPerMonth");
      log.warn("[generateLossNarrativeAction]", "structured parse failed", {
        parseError: res.parseError,
        viaTool: res.viaTool,
      });
      return { ok: false, error: "AI returned an unexpected format. Try again." };
    }

    // Drop any cited pattern id the detector did not produce, so the UI
    // never links to a pattern that does not exist.
    const known = new Set(intel.patterns.map((p) => p.id));
    const narrative: LossNarrative = {
      ...res.data,
      insights: res.data.insights.map((i) => ({
        ...i,
        patternIds: i.patternIds.filter((id) => known.has(id)),
      })),
    };

    return {
      ok: true,
      narrative,
      provider: res.provider,
      model: res.model,
      stubbed: res.stubbed,
      generatedAt: new Date().toISOString(),
      patternsConsidered: intel.patterns.length,
    };
  } catch (err) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    log.error("[generateLossNarrativeAction]", "AI call failed", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "AI request failed.",
    };
  }
}
