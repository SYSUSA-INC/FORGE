/**
 * Phase 14d — pattern intel gatherer for the section drafter.
 *
 * Collects four signals at draft time:
 *
 *   1. winningPatterns — top corpus chunks from won proposals that
 *      align with this section's title/kind. Pulls embeddings via
 *      cosine similarity, filtered by knowledge_artifact.outcome_label
 *      = 'won' (Phase 14a).
 *
 *   2. lostPatterns — small sample from lost proposals so the prompt
 *      can warn the model away from known-bad shapes.
 *
 *   3. complianceGaps — pre-flight (Phase 14c) verdicts for items
 *      mapped to this section that landed at 'partial' or
 *      'not_addressed'. The drafter MUST address these.
 *
 *   4. sectionSignal — Phase 14b reviewer pass-rate deltas for this
 *      section kind, so the model knows where the bar sits.
 *
 * All four are best-effort. Any missing signal returns empty/null
 * and the drafter still works — pattern intel is additive context.
 */
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceItems,
  proposalSections,
  type ProposalSectionKind,
} from "@/db/schema";
import { embedBatch, vectorToPgLiteral } from "@/lib/embeddings";
import { getSectionSignals } from "@/lib/section-signals";
import type {
  SectionDraftPatternIntel,
} from "@/lib/ai-prompts";

const TOP_WIN = 4;
const TOP_LOSS = 2;
const EXCERPT_CAP = 700;

export async function gatherPatternIntelForSection(input: {
  sectionId: string;
  organizationId: string;
  sectionTitle: string;
  sectionKind: ProposalSectionKind;
  agency: string;
  naicsCode: string;
  opportunityDescription: string;
}): Promise<SectionDraftPatternIntel> {
  // Compose a query string broadly equivalent to brain-suggest, but
  // weighted toward "what does a winning section of this kind look
  // like". We deliberately omit the reviewer's free text — this isn't
  // search, it's pattern retrieval.
  const composed = [
    `Section: ${input.sectionTitle} (${input.sectionKind.replace(/_/g, " ")})`,
    input.agency ? `Agency: ${input.agency}` : "",
    input.naicsCode ? `NAICS ${input.naicsCode}` : "",
    input.opportunityDescription
      ? `Opportunity: ${input.opportunityDescription.slice(0, 600)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Run the three queries in parallel. None of them block draft
  // generation — failures degrade silently to empty arrays.
  const [winningPatterns, lostPatterns, complianceGaps, sectionSignal] =
    await Promise.all([
      retrieveCorpusByOutcome(input.organizationId, composed, "won", TOP_WIN),
      retrieveCorpusByOutcome(input.organizationId, composed, "lost", TOP_LOSS),
      gatherComplianceGapsForSection(input.sectionId),
      gatherSectionSignal(input.organizationId, input.sectionKind),
    ]);

  return {
    winningPatterns,
    lostPatterns,
    complianceGaps,
    sectionSignal,
  };
}

async function retrieveCorpusByOutcome(
  organizationId: string,
  query: string,
  outcomeLabel: "won" | "lost",
  limit: number,
): Promise<{ excerpt: string; provenance: string }[]> {
  if (query.trim().length < 6) return [];
  let queryVec: number[];
  try {
    const r = await embedBatch([query]);
    if (r.stubbed) return []; // no signal in stub vectors
    queryVec = r.vectors[0]!;
  } catch (err) {
    console.warn("[14d] embedding failed", err);
    return [];
  }
  const literal = vectorToPgLiteral(queryVec);
  try {
    const r = await db.execute(sql`
      SELECT
        c.content                 AS content,
        a.title                   AS artifact_title,
        a.kind                    AS artifact_kind,
        1 - (c.embedding <=> ${literal}::vector) AS similarity
      FROM knowledge_artifact_chunk c
      INNER JOIN knowledge_artifact a ON a.id = c.artifact_id
      WHERE c.organization_id = ${organizationId}
        AND a.archived_at IS NULL
        AND c.embedding IS NOT NULL
        AND a.outcome_label = ${outcomeLabel}
      ORDER BY c.embedding <=> ${literal}::vector
      LIMIT ${limit}
    `);
    type Row = {
      content: string;
      artifact_title: string;
      artifact_kind: string;
      similarity: number | string;
    };
    const rows = ((r as unknown as { rows?: Row[] }).rows ??
      (r as unknown as Row[])) as Row[];
    return rows.map((row) => ({
      excerpt: (row.content ?? "").slice(0, EXCERPT_CAP),
      provenance: `${row.artifact_kind ?? "artifact"} · ${row.artifact_title ?? "(untitled)"}`,
    }));
  } catch (err) {
    console.warn(`[14d] ${outcomeLabel} retrieval failed`, err);
    return [];
  }
}

async function gatherComplianceGapsForSection(
  sectionId: string,
): Promise<SectionDraftPatternIntel["complianceGaps"]> {
  // Pull all compliance items mapped to this section. Surface gaps
  // for items the human marked as not_addressed/partial, OR for
  // items where the AI pre-flight (Phase 14c) flagged the same.
  // Items already 'complete' are skipped.
  type Row = {
    id: string;
    number: string;
    requirementText: string;
    status: string;
    aiAssessment: {
      suggestedStatus?: string;
      gap?: string;
      suggestion?: string;
    } | null;
  };
  const rows = (await db
    .select({
      id: complianceItems.id,
      number: complianceItems.number,
      requirementText: complianceItems.requirementText,
      status: complianceItems.status,
      aiAssessment: complianceItems.aiAssessment,
    })
    .from(complianceItems)
    .where(eq(complianceItems.proposalSectionId, sectionId))) as Row[];

  const gaps: SectionDraftPatternIntel["complianceGaps"] = [];
  for (const r of rows) {
    if (r.status === "complete" || r.status === "not_applicable") continue;
    const ai = r.aiAssessment;
    gaps.push({
      requirementNumber: r.number || "(unset)",
      requirementText: r.requirementText.slice(0, 600),
      gap:
        ai?.gap?.toString().slice(0, 400) ||
        (r.status === "partial"
          ? "Marked partial — strengthen the response."
          : "Not yet addressed."),
      suggestion: ai?.suggestion?.toString().slice(0, 400) || "",
    });
  }
  return gaps.slice(0, 12);
}

async function gatherSectionSignal(
  organizationId: string,
  sectionKind: ProposalSectionKind,
): Promise<SectionDraftPatternIntel["sectionSignal"]> {
  try {
    const { rows } = await getSectionSignals(organizationId);
    const row = rows.find((r) => r.kind === sectionKind);
    if (!row || row.totalSignals === 0) return null;
    const won = row.byOutcome.won;
    const lost = row.byOutcome.lost;
    if (won.total === 0 && lost.total === 0) return null;
    return {
      wonPassRate: won.total > 0 ? won.passRate : null,
      lostPassRate: lost.total > 0 ? lost.passRate : null,
      sampleSize: row.totalSignals,
    };
  } catch (err) {
    console.warn("[14d] section signal lookup failed", err);
    return null;
  }
}

/**
 * Helper to load just the section row needed by gatherPatternIntelForSection
 * — keeps the action site lean.
 */
export async function loadSectionForPatternIntel(sectionId: string) {
  const [row] = await db
    .select({
      id: proposalSections.id,
      title: proposalSections.title,
      kind: proposalSections.kind,
      proposalId: proposalSections.proposalId,
    })
    .from(proposalSections)
    .where(eq(proposalSections.id, sectionId))
    .limit(1);
  return row ?? null;
}
