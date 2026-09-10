/**
 * BL-FB-SCAN-CONTINUOUS — background scan runner for the Vercel cron.
 *
 * Scans proposals that have been dirty for at least 5 minutes — a generous
 * window that avoids racing with the 65-second client-side debounce timer.
 * Respects per-org feature gates and quota so the cron never burns slots
 * for orgs that have opted out or exhausted their monthly allowance.
 *
 * Called from /api/cron/proposal-scan. Not a server action (no "use server"
 * — this is an internal server-only lib function). Cross-org queries here
 * are intentional: the cron is an admin-level background worker, not a
 * user request, so org-scoped filtering would be wrong.
 */
import "server-only";

import { and, asc, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  proposalScanResults,
  proposalSections,
  proposals,
  solicitations,
  type ProposalScanContradiction,
  type SectionThemeCoverage,
  type TipTapDoc,
} from "@/db/schema";
import { completeForTenant } from "@/lib/ai";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";
import { projectToPlain } from "@/lib/tiptap-doc";
import { log } from "@/lib/log";

// Synced with SCAN_SYSTEM in scan-actions.ts — update both if the prompt changes.
const SCAN_SYSTEM = `You are a proposal quality analyst inside FORGE reviewing an in-progress federal proposal. Your job is an honest health check: flag what's missing, thin, or off-target so the team knows exactly what to fix before submission.

Output ONLY a single JSON object:
{
  "overallScore": "strong" | "needs_work" | "critical",
  "summary": "<2-3 sentences — overall health and the single most important gap to close>",
  "sectionIssues": [
    {
      "sectionId": "<echo the id from input>",
      "sectionTitle": "<echo the title>",
      "issue": "<1-2 sentences describing the specific problem>",
      "severity": "high" | "medium" | "low"
    }
  ],
  "topRecommendations": ["<specific next action>", ...],
  "sectionThemeCoverage": [
    {
      "sectionId": "<echo the id from input>",
      "sectionTitle": "<echo the title>",
      "reinforced": ["<theme title that this section clearly reinforces>"],
      "missing": ["<theme title not reinforced or contradicted in this section>"]
    }
  ],
  "contradictions": [
    {
      "section1Id": "<id of first section>",
      "section1Title": "<title of first section>",
      "section2Id": "<id of second section>",
      "section2Title": "<title of second section>",
      "claim1": "<the specific claim made in section 1>",
      "claim2": "<the specific claim made in section 2 that contradicts claim 1>",
      "explanation": "<1-2 sentences explaining why these claims are mutually incompatible>",
      "severity": "high" | "medium" | "low"
    }
  ]
}

Score calibration:
- strong: most sections drafted and on-target, minor gaps only
- needs_work: key sections empty or thin, deadline risk if not addressed soon
- critical: majority empty or compliance is at risk, immediate action required

Rules:
- Only include sections with genuine issues in sectionIssues. Skip sections that look good.
- topRecommendations: 3-5 specific actions for the next 48 hours.
- Echo sectionId and sectionTitle exactly from the input.
- Be direct. No flattery.
- sectionThemeCoverage: include ALL sections when win themes are provided. For empty/thin sections put all themes in missing. When no win themes are in the prompt, return "sectionThemeCoverage": [].
- contradictions: only include pairs where two sections make specific, mutually incompatible factual claims (e.g., Technical Volume claims 24/7 operations while Management Volume staffs only business hours). Skip empty/thin sections. Max 5 entries. Return [] when none found.`;

export type CronScanSummary = {
  scanned: number;
  skipped: number;
  errors: number;
};

/**
 * Find proposals dirty for ≥ 5 minutes and run a health scan for each,
 * up to `maxBatch` per invocation. Processes oldest-dirty-first so no
 * proposal is perpetually skipped when the batch cap is hit.
 */
export async function runStaleProposalScans(
  maxBatch = 5,
): Promise<CronScanSummary> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  const staleRows = await db
    .select({
      id: proposals.id,
      organizationId: proposals.organizationId,
    })
    .from(proposals)
    .where(
      and(
        isNotNull(proposals.scanDirtySince),
        lt(proposals.scanDirtySince, fiveMinutesAgo),
      ),
    )
    .orderBy(asc(proposals.scanDirtySince))
    .limit(maxBatch);

  let scanned = 0;
  let skipped = 0;
  let errors = 0;

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
      skipped++;
      continue;
    }

    try {
      await runSingleProposalScan(row.id, row.organizationId);
      scanned++;
    } catch (err) {
      log.error("[proposal-scan-cron]", "scan failed", {
        proposalId: row.id,
        error: err,
      });
      // Refund the quota slot — the user got no value from this scan.
      await refundQuota(row.organizationId, "aiRequestsPerMonth").catch(
        () => {},
      );
      errors++;
    }
  }

  return { scanned, skipped, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: run one proposal scan (no auth gate — caller verifies org access).
// ─────────────────────────────────────────────────────────────────────────────

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
    .where(eq(proposals.id, proposalId))
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

  const wordsPerPage = 350;
  const sectionLines = sections.map((s) => {
    const plain = (
      projectToPlain(s.bodyDoc as TipTapDoc | null) ||
      s.content ||
      ""
    ).slice(0, 500);
    const expectedMin = s.pageLimit ? s.pageLimit * wordsPerPage * 0.6 : 80;
    const flag =
      s.wordCount < 30
        ? "EMPTY"
        : s.pageLimit && s.wordCount < expectedMin
          ? "THIN"
          : "OK";
    return [
      `id=${s.id} | "${s.title}" | kind=${s.kind} | status=${s.status} | words=${s.wordCount}${s.pageLimit ? `/${Math.round(expectedMin)}min` : ""} | ${flag}`,
      plain ? `  excerpt: ${plain}` : "  (no content)",
    ].join("\n");
  });

  const requirementsBlock =
    solRequirements.length > 0
      ? `\nEvaluation criteria (Section M): ${sectionMSummary.slice(0, 400)}\n` +
        `Requirements (top ${Math.min(solRequirements.length, 20)}):\n` +
        solRequirements
          .slice(0, 20)
          .map(
            (r, i) =>
              `${i + 1}. [${r.ref || "?"}] ${r.kind}: ${r.text.slice(0, 200)}`,
          )
          .join("\n")
      : "";

  const winThemes = (propRow.proposal.winThemes ?? []).slice(0, 3);
  const themesBlock =
    winThemes.length > 0
      ? `\nWin themes (flag any section that doesn't reinforce them):\n${winThemes
          .map((t, i) => `  ${i + 1}. ${t.title}: ${t.statement}`)
          .join("\n")}`
      : "";

  const userPrompt = [
    `Proposal: ${propRow.proposal.title}`,
    `Agency: ${propRow.agency || "(unknown)"}`,
    `Solicitation: ${propRow.solicitationNumber || "(none)"}`,
    `NAICS: ${propRow.naicsCode || "(unknown)"}`,
    `Set-aside: ${propRow.setAside || "(unrestricted)"}`,
    themesBlock,
    requirementsBlock,
    ``,
    `Sections (${sections.length} total):`,
    ...sectionLines,
    ``,
    `Return strict JSON per the schema in the system prompt. Echo each sectionId and sectionTitle exactly.`,
  ]
    .filter(Boolean)
    .join("\n");

  let raw = "";
  let stubbed = true;
  const res = await completeForTenant({
    organizationId,
    feature: "proposal_scan_background",
    system: SCAN_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
    maxTokens: 2000,
    temperature: 0.2,
    cacheSystem: true,
  });
  raw = res.text;
  stubbed = res.stubbed;

  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  const parsed = JSON.parse(cleaned) as {
    overallScore: "strong" | "needs_work" | "critical";
    summary: string;
    sectionIssues: Array<{
      sectionId: string;
      sectionTitle: string;
      issue: string;
      severity: "high" | "medium" | "low";
    }>;
    topRecommendations: string[];
    sectionThemeCoverage?: SectionThemeCoverage[];
    contradictions?: ProposalScanContradiction[];
  };

  const result = {
    overallScore: (["strong", "needs_work", "critical"] as const).includes(
      parsed.overallScore,
    )
      ? parsed.overallScore
      : ("needs_work" as const),
    summary: (parsed.summary ?? "").slice(0, 1200),
    sectionIssues: (parsed.sectionIssues ?? []).slice(0, 20),
    topRecommendations: (parsed.topRecommendations ?? []).slice(0, 5),
    sectionThemeCoverage: (parsed.sectionThemeCoverage ?? []).slice(0, 40) as SectionThemeCoverage[],
    contradictions: (parsed.contradictions ?? []).slice(0, 5) as ProposalScanContradiction[],
    stubbed,
    generatedAt: new Date(),
  };

  // Sequential UPSERT per Neon-pgbouncer rule.
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

  // Clear the dirty flag.
  await db
    .update(proposals)
    .set({ scanDirtySince: null })
    .where(eq(proposals.id, proposalId));
}
