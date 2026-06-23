"use server";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
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

  const userPrompt = [
    `Proposal: ${propRow.proposal.title}`,
    `Agency: ${propRow.agency || "(unknown)"}`,
    `Solicitation: ${propRow.solicitationNumber || "(none)"}`,
    `NAICS: ${propRow.naicsCode || "(unknown)"}`,
    `Set-aside: ${propRow.setAside || "(unrestricted)"}`,
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
    return {
      ok: true,
      overallScore: ["strong", "needs_work", "critical"].includes(
        parsed.overallScore,
      )
        ? parsed.overallScore
        : "needs_work",
      summary: (parsed.summary ?? "").slice(0, 1200),
      sectionIssues: (parsed.sectionIssues ?? []).slice(0, 20),
      topRecommendations: (parsed.topRecommendations ?? []).slice(0, 5),
      stubbed,
      generatedAt: new Date().toISOString(),
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
