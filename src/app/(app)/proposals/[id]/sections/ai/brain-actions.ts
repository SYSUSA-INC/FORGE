"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, proposalSections, proposals } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { searchBrain, type BrainHit } from "@/lib/brain-retrieval";

export type { BrainHit } from "@/lib/brain-retrieval";

export type BrainSuggestResult =
  | { ok: true; hits: BrainHit[]; provider: string; stubbed: boolean }
  | { ok: false; error: string };

/**
 * Brain suggest: given a proposal section, run a semantic search
 * across the org's corpus + structured knowledge entries and return
 * the highest-similarity matches the writer can drop into the draft.
 *
 * The query is composed from:
 *   1. The user's optional free-text query (highest weight)
 *   2. The section title + kind
 *   3. The opportunity's agency / NAICS / set-aside / description
 *
 * Retrieval itself lives in src/lib/brain-retrieval.ts (shared with
 * the citation-required drafter, BL-FB-GEN-CITE).
 */
export async function brainSuggestForSectionAction(
  sectionId: string,
  freeText: string,
): Promise<BrainSuggestResult> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [row] = await db
    .select({
      sectionTitle: proposalSections.title,
      sectionKind: proposalSections.kind,
      agency: opportunities.agency,
      naicsCode: opportunities.naicsCode,
      setAside: opportunities.setAside,
      oppDescription: opportunities.description,
    })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .where(
      and(
        eq(proposalSections.id, sectionId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Section not found." };

  const composed = [
    freeText.trim(),
    `Section: ${row.sectionTitle} (${row.sectionKind.replace(/_/g, " ")})`,
    row.agency ? `Agency: ${row.agency}` : "",
    row.naicsCode ? `NAICS ${row.naicsCode}` : "",
    row.setAside ? `Set-aside: ${row.setAside}` : "",
    row.oppDescription ? `Opportunity: ${row.oppDescription.slice(0, 600)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (composed.trim().length < 6) {
    return { ok: false, error: "Not enough context to suggest." };
  }

  return searchBrain({ organizationId, query: composed });
}
