"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { computePwin, snapshotPwin } from "@/lib/pwin";
import { log } from "@/lib/log";

export type ApplyPwinResult =
  | { ok: true; pwin: number; previous: number }
  | { ok: false; error: string };

/**
 * BL-FB-X-PWIN-MODEL — write the model's estimate onto the opportunity
 * record (the value the pipeline, Command Center and briefs read) and
 * freeze a snapshot so the decision is auditable. The manual slider
 * remains editable; applying is an explicit user choice.
 */
export async function applyPwinEstimateAction(
  opportunityId: string,
): Promise<ApplyPwinResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [own] = await db
    .select({ id: opportunities.id, pWin: opportunities.pWin })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.id, opportunityId),
        eq(opportunities.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!own) return { ok: false, error: "Opportunity not found." };

  const estimate = await computePwin(organizationId, opportunityId);
  if (!estimate) return { ok: false, error: "Could not compute an estimate." };

  await db
    .update(opportunities)
    .set({ pWin: estimate.score.pwin, updatedAt: new Date() })
    .where(
      and(
        eq(opportunities.id, opportunityId),
        eq(opportunities.organizationId, organizationId),
      ),
    );

  try {
    await snapshotPwin({ organizationId, estimate, trigger: "apply" });
  } catch (err) {
    log.warn("[applyPwinEstimateAction]", "snapshot failed", { error: err });
  }

  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "opportunity.pwin.apply",
    resourceType: "opportunity",
    resourceId: opportunityId,
    metadata: {
      from: own.pWin,
      to: estimate.score.pwin,
      confidence: estimate.score.confidence,
      modelVersion: estimate.modelVersion,
      calibrated: estimate.calibration.applied,
    },
  });

  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath("/opportunities");
  revalidatePath("/");

  return { ok: true, pwin: estimate.score.pwin, previous: own.pWin };
}
