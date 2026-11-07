"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { log } from "@/lib/log";
import { runAnalysis } from "@/lib/opportunity-analysis";

/** BL-NAV-LIFECYCLE 2c — Analyze: the next Analysis Report for this opportunity. */
export async function runAnalysisAction(input: { opportunityId: string }): Promise<{ ok: true; id: string; version: number } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const opportunityId = String(input?.opportunityId ?? "");
  try {
    const res = await runAnalysis({ organizationId, opportunityId, actor: { userId: actor.id, email: actor.email } });
    if (res.ok) {
      revalidatePath(`/opportunities/${opportunityId}`);
      revalidatePath(`/opportunities/${opportunityId}/analysis`);
      revalidatePath("/pipeline/evaluate");
    }
    return res;
  } catch (err) {
    log.error("[runAnalysisAction]", "analysis failed", { opportunityId, error: err });
    return { ok: false, error: "The analysis could not be run just now. Try again." };
  }
}
