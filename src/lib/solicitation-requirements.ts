/**
 * BL-AIP-5 — the one place that knows which requirements apply to an
 * opportunity, and how companion documents roll up into the parent.
 *
 * Before this, the drafter, the chat, the on-demand scan and the scan
 * cron each read `solicitations.extracted_requirements` with
 * `.limit(1)` and no ordering — whichever solicitation row Postgres
 * returned first — and the merge lived inside a "use server" file so
 * re-parsing the parent wiped every companion document's requirements.
 *
 * Server-only. Every query is scoped by the caller's organizationId.
 */
import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  solicitationDocuments,
  solicitations,
  type SolicitationRequirement,
} from "@/db/schema";
import { dedupeRequirements } from "@/lib/requirements-text";
import type { SourcedRequirement } from "@/lib/requirement-provenance";
import {
  activeRequirements,
  applyOpportunityVerdicts,
  mergeWithCorrections,
  type ReviewedRequirement,
} from "@/lib/requirement-review";
import { requirementCorrections } from "@/db/schema";

export type OpportunityRequirements = {
  /** Union across every parsed solicitation on the opportunity, de-duplicated. */
  requirements: SolicitationRequirement[];
  sectionLSummary: string;
  sectionMSummary: string;
  /** How many solicitation rows contributed. */
  solicitationCount: number;
  /** Newest contributing solicitation, for provenance. */
  primarySolicitationId: string | null;
};

/**
 * Every requirement the opportunity's solicitations carry — the parent
 * lists already include their companion documents' clauses. Newest
 * solicitation first, so an amendment's wording wins a near-duplicate.
 */
export async function loadOpportunityRequirements(input: {
  organizationId: string;
  opportunityId: string;
}): Promise<OpportunityRequirements> {
  const rows = await db
    .select({
      id: solicitations.id,
      sectionLSummary: solicitations.sectionLSummary,
      sectionMSummary: solicitations.sectionMSummary,
      extractedRequirements: solicitations.extractedRequirements,
      parseStatus: solicitations.parseStatus,
    })
    .from(solicitations)
    .where(
      and(
        eq(solicitations.opportunityId, input.opportunityId),
        eq(solicitations.organizationId, input.organizationId),
      ),
    )
    .orderBy(desc(solicitations.createdAt));

  let requirements: SolicitationRequirement[] = [];
  let sectionLSummary = "";
  let sectionMSummary = "";
  let contributed = 0;
  // BL-AIX Phase 2c — a requirement the team rejected reaches no reader,
  // even where an amendment on the same opportunity repeats it.
  const lists = applyOpportunityVerdicts(rows.map((row) => (row.extractedRequirements ?? []) as ReviewedRequirement[]));
  for (const [i, row] of rows.entries()) {
    const list = activeRequirements(lists[i]!);
    if (list.length === 0 && !row.sectionLSummary && !row.sectionMSummary) continue;
    contributed += 1;
    requirements = dedupeRequirements(requirements, list);
    if (!sectionLSummary && row.sectionLSummary) sectionLSummary = row.sectionLSummary;
    if (!sectionMSummary && row.sectionMSummary) sectionMSummary = row.sectionMSummary;
  }

  return {
    requirements,
    sectionLSummary,
    sectionMSummary,
    solicitationCount: contributed,
    primarySolicitationId: rows[0]?.id ?? null,
  };
}

/**
 * Recompute the parent solicitation's requirement list as its own
 * clauses plus every parsed companion document's, de-duplicated.
 *
 * The parent's own clauses are the entries with no `sourceDocId`.
 * Entries tagged with a document that no longer exists are dropped —
 * the old merge kept them, so deleting a PWS left its requirements in
 * the matrix for good.
 */
export async function mergeSolicitationRequirements(
  solicitationId: string,
  organizationId: string,
): Promise<{ merged: number } | null> {
  const [parentRow] = await db
    .select({
      id: solicitations.id,
      extractedRequirements: solicitations.extractedRequirements,
    })
    .from(solicitations)
    .where(
      and(
        eq(solicitations.id, solicitationId),
        eq(solicitations.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!parentRow) return null;

  const docRows = await db
    .select({
      id: solicitationDocuments.id,
      extractedRequirements: solicitationDocuments.extractedRequirements,
      parseStatus: solicitationDocuments.parseStatus,
    })
    .from(solicitationDocuments)
    .where(
      and(
        eq(solicitationDocuments.solicitationId, solicitationId),
        eq(solicitationDocuments.organizationId, organizationId),
      ),
    )
    // A fixed order, so the same document's copy of a shared clause wins every merge.
    .orderBy(asc(solicitationDocuments.createdAt), asc(solicitationDocuments.id));
  // The parent's own clauses are the untagged entries. Tagged entries are
  // rebuilt from the documents that still exist, so a deleted document's
  // clauses fall out here instead of persisting for good.
  // BL-AIX Phase 2a — each entry keeps its provenance (`source`); Phase
  // 2c — the team's verdicts are applied to each document's own clauses
  // before clauses repeated across documents are merged.
  const corrections = await db
    .select()
    .from(requirementCorrections)
    .where(
      and(
        eq(requirementCorrections.organizationId, organizationId),
        eq(requirementCorrections.solicitationId, solicitationId),
      ),
    );
  const merged = mergeWithCorrections({
    own: (parentRow.extractedRequirements ?? []) as ReviewedRequirement[],
    docs: docRows
      .filter((d) => d.parseStatus === "parsed")
      .map((d) => ({ id: d.id, requirements: (d.extractedRequirements ?? []) as SourcedRequirement[] })),
    corrections: corrections.map((c) => ({
      docKey: c.docKey,
      originalKey: c.originalKey,
      action: c.action,
      corrected: c.corrected,
      original: c.original,
      userId: c.userId,
      updatedAt: c.updatedAt,
    })),
  });
  await db
    .update(solicitations)
    .set({ extractedRequirements: merged, updatedAt: new Date() })
    .where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.id, solicitationId)));
  return { merged: merged.length };
}
