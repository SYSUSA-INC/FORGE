/**
 * BL-FB-SCAN-CONTINUOUS — background scan runner for the Vercel cron.
 *
 * Scans proposals that have been dirty for at least 5 minutes — a generous
 * window that avoids racing with the 65-second client-side debounce timer.
 * Respects per-org feature gates and quota so the cron never burns slots
 * for orgs that have opted out or exhausted their monthly allowance.
 *
 * BL-AIP-4 — failures back off exponentially (5 min doubling to 6 h) and
 * a proposal is dropped from the queue after SCAN_MAX_ATTEMPTS, so one
 * proposal whose scan keeps failing no longer blocks the five-per-run
 * batch forever and burns a request slot every tick.
 *
 * Called from /api/cron/proposal-scan. Not a server action (no "use server"
 * — this is an internal server-only lib function). Cross-org queries here
 * are intentional: the cron is an admin-level background worker, not a
 * user request, so org-scoped filtering would be wrong.
 */
import "server-only";

import { and, asc, eq, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  proposalScanResults,
  proposalSections,
  proposals,
} from "@/db/schema";
import { loadOpportunityRequirements } from "@/lib/solicitation-requirements";
import { completeStructuredForTenant } from "@/lib/ai";
import { proposalScanSchema } from "@/lib/ai-prompts";
import { nextScanAttempt } from "@/lib/proposal-scan-backoff";
import {
  buildScanUserPrompt,
  SCAN_MAX_TOKENS,
  SCAN_SYSTEM,
  SCAN_TEMPERATURE,
} from "@/lib/proposal-scan-input";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";
import { log } from "@/lib/log";

// SCAN_SYSTEM and the prompt layout live in src/lib/proposal-scan-input.ts
// (BL-AI-SCAN-FULLTEXT), shared with the on-demand scan action.

export type CronScanSummary = {
  scanned: number;
  skipped: number;
  errors: number;
  /** BL-AIP-4 — failures that were re-queued with a backoff. */
  retriesScheduled: number;
  /** BL-AIP-4 — proposals dropped after SCAN_MAX_ATTEMPTS failures. */
  abandoned: number;
};

/** Thrown when the AI provider is in stub mode: not a failure, skip. */
class StubSkipError extends Error {}

/**
 * Find proposals dirty for ≥ 5 minutes whose backoff (if any) has
 * elapsed and run a health scan for each, up to `maxBatch` per
 * invocation. Oldest-dirty-first so no proposal is perpetually skipped
 * when the batch cap is hit.
 */
export async function runStaleProposalScans(
  maxBatch = 5,
): Promise<CronScanSummary> {
  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

  const staleRows = await db
    .select({
      id: proposals.id,
      organizationId: proposals.organizationId,
      scanAttempts: proposals.scanAttempts,
    })
    .from(proposals)
    .where(
      and(
        isNotNull(proposals.scanDirtySince),
        lt(proposals.scanDirtySince, fiveMinutesAgo),
        or(isNull(proposals.scanNextAttemptAt), lte(proposals.scanNextAttemptAt, now)),
      ),
    )
    .orderBy(asc(proposals.scanDirtySince))
    .limit(maxBatch);

  const summary: CronScanSummary = {
    scanned: 0,
    skipped: 0,
    errors: 0,
    retriesScheduled: 0,
    abandoned: 0,
  };

  for (const row of staleRows) {
    // Feature + quota gates — skip silently, don't refund (nothing was charged yet).
    let gated = false;
    try {
      await ensureFeature(row.organizationId, "aiAutoDraft");
      await enforceQuota(row.organizationId, "aiRequestsPerMonth");
    } catch (err) {
      if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
        gated = true;
        log.info("[proposal-scan-cron]", "skipped (gate/quota)", {
          proposalId: row.id,
          reason: err instanceof Error ? err.message : String(err),
        });
      } else {
        throw err;
      }
    }

    if (gated) {
      summary.skipped++;
      continue;
    }

    try {
      await runSingleProposalScan(row.id, row.organizationId);
      summary.scanned++;
    } catch (err) {
      // Refund the quota slot — the user got no value from this scan.
      await refundQuota(row.organizationId, "aiRequestsPerMonth").catch(
        () => {},
      );
      if (err instanceof StubSkipError) {
        summary.skipped++;
        continue;
      }
      summary.errors++;
      log.error("[proposal-scan-cron]", "scan failed", {
        proposalId: row.id,
        error: err,
      });

      // BL-AIP-4 — schedule the retry, or give up.
      const attempts = (row.scanAttempts ?? 0) + 1;
      const next = nextScanAttempt(attempts, new Date());
      try {
        if (next.giveUp) {
          await db
            .update(proposals)
            .set({ scanDirtySince: null, scanAttempts: 0, scanNextAttemptAt: null })
            .where(and(eq(proposals.id, row.id), eq(proposals.organizationId, row.organizationId)));
          summary.abandoned++;
          log.error("[proposal-scan-cron]", "giving up after repeated failures", {
            proposalId: row.id,
            attempts,
          });
        } else {
          await db
            .update(proposals)
            .set({ scanAttempts: attempts, scanNextAttemptAt: next.nextAttemptAt })
            .where(and(eq(proposals.id, row.id), eq(proposals.organizationId, row.organizationId)));
          summary.retriesScheduled++;
        }
      } catch (bookkeepingErr) {
        log.error("[proposal-scan-cron]", "retry bookkeeping failed", {
          proposalId: row.id,
          error: bookkeepingErr,
        });
      }
    }
  }

  return summary;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: run one proposal scan (no auth gate — caller verifies org access).
// ─────────────────────────────────────────────────────────────────────────────

async function clearScanState(proposalId: string, organizationId: string): Promise<void> {
  await db
    .update(proposals)
    .set({ scanDirtySince: null, scanAttempts: 0, scanNextAttemptAt: null })
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)));
}

async function runSingleProposalScan(
  proposalId: string,
  organizationId: string,
): Promise<void> {
  const [propRow] = await db
    .select({
      proposal: proposals,
      agency: opportunities.agency,
      solicitationNumber: opportunities.solicitationNumber,
      naicsCode: opportunities.naicsCode,
      setAside: opportunities.setAside,
      opportunityId: proposals.opportunityId,
    })
    .from(proposals)
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)))
    .limit(1);

  if (!propRow) {
    log.warn("[proposal-scan-cron]", "proposal not found", { proposalId });
    return;
  }

  const sections = await db
    .select({
      id: proposalSections.id,
      title: proposalSections.title,
      kind: proposalSections.kind,
      status: proposalSections.status,
      wordCount: proposalSections.wordCount,
      pageLimit: proposalSections.pageLimit,
      bodyDoc: proposalSections.bodyDoc,
      content: proposalSections.content,
      ordering: proposalSections.ordering,
    })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId))
    .orderBy(asc(proposalSections.ordering));

  // BL-AIP-5 — every requirement across the opportunity's solicitations
  // (best-effort), not whichever row `.limit(1)` returned.
  let solRequirements: { kind: string; text: string; ref: string }[] = [];
  let sectionMSummary = "";
  try {
    const loaded = await loadOpportunityRequirements({
      organizationId,
      opportunityId: propRow.opportunityId,
    });
    solRequirements = loaded.requirements;
    sectionMSummary = loaded.sectionMSummary;
  } catch {
    // best effort
  }

  // BL-AI-SCAN-FULLTEXT — full section bodies under a shared budget,
  // same builder as the on-demand action.
  const { prompt: userPrompt, input: scanInput } = buildScanUserPrompt({
    proposalTitle: propRow.proposal.title,
    agency: propRow.agency,
    solicitationNumber: propRow.solicitationNumber,
    naicsCode: propRow.naicsCode,
    setAside: propRow.setAside,
    winThemes: propRow.proposal.winThemes ?? [],
    sectionMSummary,
    requirements: solRequirements,
    sections,
  });

  // BL-AI-TOOLS — forced tool call validated against proposalScanSchema.
  // A validation failure throws so runStaleProposalScans logs it and
  // refunds the quota slot, same as a provider error.
  const res = await completeStructuredForTenant({
    organizationId,
    feature: "proposal_scan_background",
    variant: scanInput.truncatedSections > 0 ? "truncated" : "full",
    schema: proposalScanSchema,
    toolName: "record_health_scan",
    toolDescription:
      "Record the proposal health check: overall score, per-section issues, recommendations, win-theme coverage and cross-section contradictions.",
    system: SCAN_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
    maxTokens: SCAN_MAX_TOKENS,
    temperature: SCAN_TEMPERATURE,
    cacheSystem: true,
  });
  if (res.stubbed) {
    // BL-AIP-2 — clear the dirty flag before bailing, otherwise the same
    // proposals are picked up again every run (oldest first, five per
    // run) and block everything behind them until a provider is set.
    await clearScanState(proposalId, organizationId).catch(() => undefined);
    throw new StubSkipError("AI provider is in stub mode — background scan skipped.");
  }
  if (!res.data) {
    throw new Error(
      `scan response did not match schema: ${res.parseError ?? "unknown"}`,
    );
  }
  const parsed = res.data;

  const result = {
    overallScore: parsed.overallScore,
    summary: parsed.summary.slice(0, 1200),
    sectionIssues: parsed.sectionIssues.slice(0, 20),
    topRecommendations: parsed.topRecommendations.slice(0, 5),
    sectionThemeCoverage: (parsed.sectionThemeCoverage ?? []).slice(0, 40),
    contradictions: (parsed.contradictions ?? []).slice(0, 5),
    stubbed: res.stubbed,
    generatedAt: new Date(),
  };

  // Sequential UPSERT per Neon-pgbouncer rule.
  const [existing] = await db
    .select({ id: proposalScanResults.id })
    .from(proposalScanResults)
    .where(
      and(
        eq(proposalScanResults.organizationId, organizationId),
        eq(proposalScanResults.proposalId, proposalId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(proposalScanResults)
      .set({
        overallScore: result.overallScore,
        summary: result.summary,
        sectionIssues: result.sectionIssues,
        topRecommendations: result.topRecommendations,
        sectionThemeCoverage: result.sectionThemeCoverage,
        contradictions: result.contradictions,
        stubbed: result.stubbed,
        generatedAt: result.generatedAt,
      })
      .where(
        and(
          eq(proposalScanResults.organizationId, organizationId),
          eq(proposalScanResults.id, existing.id),
        ),
      );
  } else {
    await db.insert(proposalScanResults).values({
      organizationId,
      proposalId,
      overallScore: result.overallScore,
      summary: result.summary,
      sectionIssues: result.sectionIssues,
      topRecommendations: result.topRecommendations,
      sectionThemeCoverage: result.sectionThemeCoverage,
      contradictions: result.contradictions,
      stubbed: result.stubbed,
      generatedAt: result.generatedAt,
    });
  }

  // Clear the dirty flag and any retry state.
  await clearScanState(proposalId, organizationId);
}
