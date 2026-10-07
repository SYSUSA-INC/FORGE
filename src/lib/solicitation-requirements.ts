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

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  solicitationDocuments,
  solicitations,
  type SolicitationRequirement,
} from "@/db/schema";
import { dedupeRequirements } from "@/lib/requirements-text";
import type { SourcedRequirement } from "@/lib/requirement-provenance";

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
  for (const row of rows) {
    const list = (row.extractedRequirements ?? []) as SolicitationRequirement[];
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
    );
  // The parent's own clauses are the untagged entries. Tagged entries are
  // rebuilt from the documents that still exist, so a deleted document's
  // clauses fall out here instead of persisting for good.
  // BL-AIX Phase 2a — each entry keeps its provenance (`source`) through the merge.
  const parentReqs = (parentRow.extractedRequirements ?? []) as SourcedRequirement[];
  const ownReqs: SourcedRequirement[] = parentReqs
    .filter((r) => !r.sourceDocId)
    .map((r) => ({ kind: r.kind, text: r.text, ref: r.ref, ...(r.source ? { source: r.source } : {}) }));

  const companionReqs: SourcedRequirement[] = [];
  for (const doc of docRows) {
    if (doc.parseStatus !== "parsed") continue;
    for (const r of (doc.extractedRequirements ?? []) as SourcedRequirement[]) {
      companionReqs.push({ kind: r.kind, text: r.text, ref: r.ref, sourceDocId: doc.id, ...(r.source ? { source: r.source } : {}) });
    }
  }

  const merged = dedupeRequirements(ownReqs, companionReqs);
  await db
    .update(solicitations)
    .set({ extractedRequirements: merged, updatedAt: new Date() })
    .where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.id, solicitationId)));
  return { merged: merged.length };
}
