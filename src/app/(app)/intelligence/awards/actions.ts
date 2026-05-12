"use server";

import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import {
  searchAwardsByCriteria,
  type AwardsSearchCriteria,
  type UsaspendingAward,
} from "@/lib/usaspending";

export type AwardsIntelSearchResult =
  | { ok: true; awards: UsaspendingAward[]; totalRecords: number }
  | { ok: false; error: string };

export async function searchAwardsIntelAction(
  criteria: AwardsSearchCriteria,
): Promise<AwardsIntelSearchResult> {
  await requireAuth();
  await requireCurrentOrg();

  if (process.env.AWARDS_INTEL_ENABLED !== "1") {
    return {
      ok: false,
      error:
        "Awards intel is in preview. Ask an admin to set AWARDS_INTEL_ENABLED=1.",
    };
  }

  return searchAwardsByCriteria({
    ...criteria,
    limit: Math.min(100, criteria.limit ?? 50),
  });
}
