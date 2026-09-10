"use server";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  proposalScanResults,
  proposalSections,
  proposals,
  solicitations,
  type SectionThemeCoverage,
  type ProposalScanContradiction,
} from "@/db/schema";
import { completeStructuredForTenant } from "@/lib/ai";
import { proposalScanSchema } from "@/lib/ai-prompts";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import {
  buildScanUserPrompt,
  SCAN_MAX_TOKENS,
  SCAN_SYSTEM,
  SCAN_TEMPERATURE,
} from "@/lib/proposal-scan-input";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";
import { log } from "@/lib/log";

export type ProposalScanIssue = {
  sectionId: string;
  sectionTitle: string;
  issue: string;
  severity: "high" | "medium" | "low";
};

export type ProposalScanResult =
  | {
      ok: true;
      overallScore: "strong" | "needs_work" | "critical";
      summary: string;
      sectionIssues: ProposalScanIssue[];
      topRecommendations: string[];
      sectionThemeCoverage: SectionThemeCoverage[];
      contradictions: ProposalScanContradiction[];
      stubbed: boolean;
      generatedAt: string;
    }
  | { ok: false; error: string };

// SCAN_SYSTEM and the prompt layout live in src/lib/proposal-scan-input.ts
// (BL-AI-SCAN-FULLTEXT) so this action and the background cron cannot
// drift apart.

export async function runProposalScanAction(
  proposalId: string,
): Promise<ProposalScanResult> {
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
    key: `proposal-scan:${proposalId}`,
    limit: 10,
    windowSeconds: 3600,
  });
  if (!limit.ok) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return {
      ok: false,
      error: `Scan limit reached. Try again in ${Math.ceil(limit.retryAfter / 60)} min.`,
    };
  }

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
    .where(
      and(
        eq(proposals.id, proposalId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!propRow) return { ok: false, error: "Proposal not found." };

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

  // Load solicitation requirements (best-effort).
  let solRequirements: { kind: string; text: string; ref: string }[] = [];
  let sectionMSummary = "";
  try {
    const [sol] = await db
      .select({
        extractedRequirements: solicitations.extractedRequirements,
        sectionMSummary: solicitations.sectionMSummary,
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
      solRequirements = sol.extractedRequirements ?? [];
      sectionMSummary = sol.sectionMSummary ?? "";
    }
  } catch {
    // best effort
  }

  // BL-AI-SCAN-FULLTEXT — full section bodies under a shared budget,
  // same builder as the background cron.
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

  // BL-AI-TOOLS — the scan answers through a forced tool call validated
  // against proposalScanSchema, so no fence-stripping or manual field
  // coercion is needed here.
  let parsed;
  let stubbed = true;
  try {
    const res = await completeStructuredForTenant({
      organizationId,
      feature: "proposal_scan",
      // Telemetry variant records whether the model saw every body in full.
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
    stubbed = res.stubbed;
    if (res.stubbed) {
      await refundQuota(organizationId, "aiRequestsPerMonth");
      return {
        ok: false,
        error:
          "AI provider is in stub mode — configure a provider to run scans.",
      };
    }
    if (!res.data) {
      await refundQuota(organizationId, "aiRequestsPerMonth");
      log.warn("[runProposalScanAction]", "structured parse failed", {
        parseError: res.parseError,
        viaTool: res.viaTool,
        rawSnippet: res.text.slice(0, 240),
      });
      return {
        ok: false,
        error: "AI returned an unexpected format. Re-run the scan.",
      };
    }
    parsed = res.data;
  } catch (err) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    log.error("[runProposalScanAction]", "AI call failed", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "AI scan failed.",
    };
  }

  const result = {
    overallScore: parsed.overallScore,
    summary: parsed.summary.slice(0, 1200),
    sectionIssues: parsed.sectionIssues.slice(0, 20),
    topRecommendations: parsed.topRecommendations.slice(0, 5),
    sectionThemeCoverage: (parsed.sectionThemeCoverage ?? []).slice(0, 40),
    contradictions: (parsed.contradictions ?? []).slice(0, 5),
    stubbed,
    generatedAt: new Date(),
  };

  // BL-FB-SCAN-CONTINUOUS — persist the scan and clear the dirty flag.
  // Sequential UPSERT pattern per Neon-pgbouncer rule (no transactions).
  try {
    const [existing] = await db
      .select({ id: proposalScanResults.id })
      .from(proposalScanResults)
      .where(eq(proposalScanResults.proposalId, proposalId))
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
        .where(eq(proposalScanResults.id, existing.id));
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

    // Clear the dirty flag — this scan covers all content as of now.
    await db
      .update(proposals)
      .set({ scanDirtySince: null })
      .where(eq(proposals.id, proposalId));
  } catch (err) {
    log.warn("[runProposalScanAction]", "persist failed", { error: err });
  }

  return {
    ok: true,
    overallScore: result.overallScore,
    summary: result.summary,
    sectionIssues: result.sectionIssues,
    topRecommendations: result.topRecommendations,
    sectionThemeCoverage: result.sectionThemeCoverage,
    contradictions: result.contradictions,
    stubbed: result.stubbed,
    generatedAt: result.generatedAt.toISOString(),
  };
}

// ────────────────────────────────────────────────────────────────────
// BL-FB-SCAN-CONTINUOUS — persisted scan + continuous-refresh helpers
// ────────────────────────────────────────────────────────────────────

export type StoredProposalScan = {
  overallScore: "strong" | "needs_work" | "critical";
  summary: string;
  sectionIssues: ProposalScanIssue[];
  topRecommendations: string[];
  sectionThemeCoverage: SectionThemeCoverage[];
  contradictions: ProposalScanContradiction[];
  stubbed: boolean;
  generatedAt: string;
  dirtySince: string | null;
};

/**
 * Read the latest persisted scan for a proposal (+ dirty flag). Used by
 * pages that want to render scan-driven UI without forcing a fresh AI
 * call. Returns `null` when no scan has ever been recorded.
 */
export async function getStoredProposalScanAction(
  proposalId: string,
): Promise<StoredProposalScan | null> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [own] = await db
    .select({
      id: proposals.id,
      scanDirtySince: proposals.scanDirtySince,
    })
    .from(proposals)
    .where(
      and(
        eq(proposals.id, proposalId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!own) return null;

  const [row] = await db
    .select()
    .from(proposalScanResults)
    .where(
      and(
        eq(proposalScanResults.proposalId, proposalId),
        eq(proposalScanResults.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) return null;

  return {
    overallScore: row.overallScore as "strong" | "needs_work" | "critical",
    summary: row.summary,
    sectionIssues: row.sectionIssues,
    topRecommendations: row.topRecommendations,
    sectionThemeCoverage: (row.sectionThemeCoverage ?? []) as SectionThemeCoverage[],
    contradictions: (row.contradictions ?? []) as ProposalScanContradiction[],
    stubbed: row.stubbed,
    generatedAt: row.generatedAt.toISOString(),
    dirtySince: own.scanDirtySince ? own.scanDirtySince.toISOString() : null,
  };
}

/**
 * Debounced auto-trigger. Page-load callers invoke this; if the proposal
 * is dirty AND the most recent edit is at least DEBOUNCE_SECONDS old AND
 * we're not currently within the rate-limit window, fire a fresh scan
 * in the background.
 *
 * Returns whether a scan was actually triggered so the UI can show a
 * "scan running" indicator.
 */
const SCAN_DEBOUNCE_SECONDS = 60;

export async function triggerProposalScanIfStaleAction(
  proposalId: string,
): Promise<{ triggered: boolean }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [own] = await db
    .select({
      id: proposals.id,
      scanDirtySince: proposals.scanDirtySince,
    })
    .from(proposals)
    .where(
      and(
        eq(proposals.id, proposalId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!own || !own.scanDirtySince) return { triggered: false };

  const dirtyAgeSeconds =
    (Date.now() - own.scanDirtySince.getTime()) / 1000;
  if (dirtyAgeSeconds < SCAN_DEBOUNCE_SECONDS) {
    return { triggered: false };
  }

  // Fire-and-forget — the user will see results on the next page load.
  // `runProposalScanAction` handles its own rate-limit + quota refund
  // path, so we don't need defensive logic here beyond catching to
  // keep the unhandled rejection clean.
  void runProposalScanAction(proposalId).catch((err) => {
    log.warn("[triggerProposalScanIfStaleAction]", "background scan failed", {
      error: err,
    });
  });

  return { triggered: true };
}
