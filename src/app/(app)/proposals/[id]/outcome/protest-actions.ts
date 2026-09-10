"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  opportunities,
  proposalDebriefs,
  proposalOutcomes,
  proposalProtestChecks,
  proposals,
  solicitations,
  type ProtestGround,
  type ProtestRiskTier,
} from "@/db/schema";
import { completeStructuredForTenant } from "@/lib/ai";
import {
  buildProtestViabilityPrompt,
  protestViabilitySchema,
} from "@/lib/ai-prompts";
import { recordAudit } from "@/lib/audit-log";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";
import { log } from "@/lib/log";

export type ProtestCheckRow = {
  riskTier: ProtestRiskTier;
  summary: string;
  grounds: ProtestGround[];
  model: string;
  stubbed: boolean;
  createdAt: string;
};

export type GetProtestCheckResult =
  | { ok: true; check: ProtestCheckRow | null }
  | { ok: false; error: string };

export async function getProtestCheckAction(
  proposalId: string,
): Promise<GetProtestCheckResult> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const [row] = await db
    .select()
    .from(proposalProtestChecks)
    .where(
      and(
        eq(proposalProtestChecks.proposalId, proposalId),
        eq(proposalProtestChecks.organizationId, organizationId),
      ),
    )
    .limit(1);
  return {
    ok: true,
    check: row
      ? {
          riskTier: row.riskTier,
          summary: row.summary,
          grounds: (row.grounds ?? []) as ProtestGround[],
          model: row.model,
          stubbed: row.stubbed,
          createdAt: row.createdAt.toISOString(),
        }
      : null,
  };
}

export type RunProtestCheckResult =
  | { ok: true; check: ProtestCheckRow }
  | { ok: false; error: string };

/**
 * BL-FB-WIN-PROTEST — protest viability check for lost proposals.
 *
 * Loads debrief + solicitation eval criteria, sends to AI, writes
 * a risk-tiered assessment with specific GAO grounds and citations.
 * Calibrated to surface grounds only when debrief evidence supports them.
 *
 * Idempotent — re-runs UPDATE the existing row.
 */
export async function runProtestCheckAction(
  proposalId: string,
): Promise<RunProtestCheckResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  try {
    await ensureFeature(organizationId, "winnerAnalysis");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  const limit = await enforceRateLimit({
    key: `protest-check:proposal:${proposalId}`,
    limit: 5,
    windowSeconds: 3600,
  });
  if (!limit.ok) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return {
      ok: false,
      error: `Protest check limit (5/hour) reached for this proposal. Retry in ${Math.ceil(limit.retryAfter / 60)} min.`,
    };
  }

  // Load proposal + opportunity for solicitation context.
  const [propRow] = await db
    .select({
      proposal: proposals,
      agency: opportunities.agency,
      solicitationNumber: opportunities.solicitationNumber,
      naicsCode: opportunities.naicsCode,
      setAside: opportunities.setAside,
      opportunityId: opportunities.id,
    })
    .from(proposals)
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .where(
      and(
        eq(proposals.id, proposalId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!propRow) return { ok: false, error: "Proposal not found." };

  const [outcome] = await db
    .select()
    .from(proposalOutcomes)
    .where(eq(proposalOutcomes.proposalId, proposalId))
    .limit(1);
  if (!outcome) {
    return {
      ok: false,
      error: "Record a loss outcome first — protest analysis requires it.",
    };
  }
  if (outcome.outcomeType !== "lost") {
    return { ok: false, error: "Protest check only runs on lost proposals." };
  }

  const [debrief] = await db
    .select()
    .from(proposalDebriefs)
    .where(eq(proposalDebriefs.proposalId, proposalId))
    .limit(1);

  // Pull solicitation eval criteria from the linked opportunity's solicitation.
  let sectionMSummary = "";
  let sectionLSummary = "";
  if (propRow.opportunityId) {
    const [sol] = await db
      .select({
        sectionMSummary: solicitations.sectionMSummary,
        sectionLSummary: solicitations.sectionLSummary,
      })
      .from(solicitations)
      .where(
        and(
          eq(solicitations.opportunityId, propRow.opportunityId),
          eq(solicitations.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (sol) {
      sectionMSummary = sol.sectionMSummary ?? "";
      sectionLSummary = sol.sectionLSummary ?? "";
    }
  }

  const prompt = buildProtestViabilityPrompt({
    proposalTitle: propRow.proposal.title,
    agency: propRow.agency ?? "",
    solicitationNumber: propRow.solicitationNumber ?? "",
    naicsCode: propRow.naicsCode ?? "",
    setAside: propRow.setAside ?? "",
    sectionMSummary,
    sectionLSummary,
    outcome: {
      awardedToCompetitor: outcome.awardedToCompetitor ?? "",
      decisionDate: outcome.decisionDate
        ? outcome.decisionDate.toISOString().slice(0, 10)
        : "",
      summary: outcome.summary ?? "",
    },
    debrief: debrief
      ? {
          strengths: debrief.strengths ?? "",
          weaknesses: debrief.weaknesses ?? "",
          improvements: debrief.improvements ?? "",
          pastPerformanceCitation: debrief.pastPerformanceCitation ?? "",
          notes: debrief.notes ?? "",
        }
      : null,
  });

  let model = "stub";
  let stubbed = true;
  let structured;
  try {
    structured = await completeStructuredForTenant({
      organizationId,
      feature: "protest_viability",
      schema: protestViabilitySchema,
      toolName: "record_protest_viability",
      toolDescription:
        "Record the protest viability assessment: verdict, grounds, deadlines and recommendation.",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 3000,
      temperature: 0.1,
      cacheSystem: true,
    });
    model = `${structured.provider}:${structured.model}`;
    stubbed = structured.stubbed;
  } catch (err) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    log.error("[protest-check]", "AI call failed", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "AI call failed.",
    };
  }

  if (!structured.data) {
    log.warn("[protest-check]", "structured parse failed", {
      parseError: structured.parseError,
      viaTool: structured.viaTool,
      rawSnippet: structured.text.slice(0, 240),
    });
    return {
      ok: false,
      error: `${structured.parseError ?? "AI response did not match the expected shape."} Re-run, or check the API key.`,
    };
  }
  const parsed = structured.data;

  const now = new Date();
  const checkValues = {
    organizationId,
    proposalId,
    riskTier: parsed.riskTier as ProtestRiskTier,
    summary: parsed.summary.slice(0, 2000),
    grounds: parsed.grounds as ProtestGround[],
    model,
    stubbed,
    createdByUserId: user.id,
    updatedAt: now,
  };

  // Sequential upsert per Neon-pgbouncer rule.
  const [existing] = await db
    .select({ id: proposalProtestChecks.id })
    .from(proposalProtestChecks)
    .where(eq(proposalProtestChecks.proposalId, proposalId))
    .limit(1);

  let createdAt = now;
  if (existing) {
    const { createdByUserId: _ignored, ...update } = checkValues;
    void _ignored;
    await db
      .update(proposalProtestChecks)
      .set(update)
      .where(eq(proposalProtestChecks.id, existing.id));
    const [refreshed] = await db
      .select({ createdAt: proposalProtestChecks.createdAt })
      .from(proposalProtestChecks)
      .where(eq(proposalProtestChecks.id, existing.id))
      .limit(1);
    if (refreshed) createdAt = refreshed.createdAt;
  } else {
    const [inserted] = await db
      .insert(proposalProtestChecks)
      .values(checkValues)
      .returning({ createdAt: proposalProtestChecks.createdAt });
    if (inserted) createdAt = inserted.createdAt;
  }

  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "proposal.protest_check.run",
    resourceType: "proposal_protest_check",
    resourceId: proposalId,
    metadata: {
      proposalId,
      riskTier: parsed.riskTier,
      groundCount: parsed.grounds.length,
      stubbed,
      model,
    },
  });

  revalidatePath(`/proposals/${proposalId}/outcome`);

  return {
    ok: true,
    check: {
      riskTier: checkValues.riskTier,
      summary: checkValues.summary,
      grounds: checkValues.grounds,
      model,
      stubbed,
      createdAt: createdAt.toISOString(),
    },
  };
}
