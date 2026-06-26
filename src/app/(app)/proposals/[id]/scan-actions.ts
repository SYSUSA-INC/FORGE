"use server";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  proposalScanResults,
  proposalSections,
  proposals,
  solicitations,
  type TipTapDoc,
} from "@/db/schema";
import { completeForTenant } from "@/lib/ai";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";
import { projectToPlain } from "@/lib/tiptap-doc";
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
      stubbed: boolean;
      generatedAt: string;
    }
  | { ok: false; error: string };

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
  "topRecommendations": ["<specific next action>", ...]
}

Score calibration:
- strong: most sections drafted and on-target, minor gaps only
- needs_work: key sections empty or thin, deadline risk if not addressed soon
- critical: majority empty or compliance is at risk, immediate action required

Rules:
- Only include sections with genuine issues in sectionIssues. Skip sections that look good.
- topRecommendations: 3-5 specific actions for the next 48 hours.
- Echo sectionId and sectionTitle exactly from the input.
- Be direct. No flattery.`;

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

  const wordsPerPage = 350;
  const sectionLines = sections.map((s) => {
    const plain = (
      projectToPlain(s.bodyDoc as TipTapDoc | null) ||
      s.content ||
      ""
    ).slice(0, 500);
    const expectedMin = s.pageLimit ? s.pageLimit * wordsPerPage * 0.6 : 80;
    const flag = s.wordCount < 30 ? "EMPTY" : s.pageLimit && s.wordCount < expectedMin ? "THIN" : "OK";
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

  // BL-FB-GEN-THEMES — feed win themes into the scan so it can flag
  // sections that drift off-theme (e.g. a Technical Approach that
  // never mentions the proposal's headline differentiator).
  const winThemes = (propRow.proposal.winThemes ?? []).slice(0, 3);
  const themesBlock =
    winThemes.length > 0
      ? `\nWin themes (the proposal team committed to these — flag any section that doesn't reinforce them):\n${winThemes
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
  try {
    const res = await completeForTenant({
      organizationId,
      system: SCAN_SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 2000,
      temperature: 0.2,
      cacheSystem: true,
    });
    raw = res.text;
    stubbed = res.stubbed;
  } catch (err) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    log.error("[runProposalScanAction]", "AI call failed", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "AI scan failed.",
    };
  }

  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  try {
    const parsed = JSON.parse(cleaned) as {
      overallScore: "strong" | "needs_work" | "critical";
      summary: string;
      sectionIssues: ProposalScanIssue[];
      topRecommendations: string[];
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
      stubbed: result.stubbed,
      generatedAt: result.generatedAt.toISOString(),
    };
  } catch {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    log.warn("[runProposalScanAction]", "JSON parse failed", {
      rawSnippet: raw.slice(0, 240),
    });
    return {
      ok: false,
      error: "AI returned an unexpected format. Re-run the scan.",
    };
  }
}

// ────────────────────────────────────────────────────────────────────
// BL-FB-SCAN-CONTINUOUS — persisted scan + continuous-refresh helpers
// ────────────────────────────────────────────────────────────────────

export type StoredProposalScan = {
  overallScore: "strong" | "needs_work" | "critical";
  summary: string;
  sectionIssues: ProposalScanIssue[];
  topRecommendations: string[];
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
