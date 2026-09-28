"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { harvestProposal, type HarvestResult } from "@/lib/proposal-harvest";

export type { HarvestResult } from "@/lib/proposal-harvest";

/**
 * Phase 10f: harvest a submitted proposal back into the corpus.
 *
 * BL-AIP-4b — the harvest itself lives in `src/lib/proposal-harvest.ts`
 * so the brain-index cron can run it for submitted / won proposals that
 * were never harvested; this action keeps the gates and revalidation.
 *
 * Triggered automatically when a proposal is advanced to "submitted"
 * (see advanceProposalStageAction) and when a won outcome is saved;
 * also exposed as a manual "Harvest now" button on the proposal page.
 */
export async function harvestProposalToCorpusAction(
  proposalId: string,
): Promise<HarvestResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const res = await harvestProposal({
    organizationId,
    proposalId,
    actor: { userId: user.id, email: user.email, name: user.name },
  });
  if (!res.ok) return res;

  revalidatePath("/knowledge-base");
  revalidatePath("/knowledge-base/import");
  revalidatePath(`/knowledge-base/import/${res.artifactId}`);
  revalidatePath(`/proposals/${proposalId}`);
  return res;
}
