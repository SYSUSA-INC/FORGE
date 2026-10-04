/**
 * BL-PACKAGES add-ons Slice 2c — what the Reports page reads: the
 * workspace's opportunities (scoped to its organization) and whether its
 * plan includes `advancedReporting`. The arithmetic is in reports-logic.
 */
import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { ensureFeature, FeatureGateError } from "@/lib/subscription-gates";
import type { ReportOpp } from "@/lib/reports-logic";

export const REPORTS_REFUSAL =
  "Reports aren't included in this workspace's plan. An admin can add them under Settings → Billing.";

/** Why the plan refuses the Reports page, or null when it allows it. */
export async function reportsRefusal(organizationId: string): Promise<string | null> {
  try {
    await ensureFeature(organizationId, "advancedReporting");
    return null;
  } catch (err) {
    if (err instanceof FeatureGateError) return REPORTS_REFUSAL;
    throw err;
  }
}

export async function loadReportOpportunities(organizationId: string): Promise<ReportOpp[]> {
  return db
    .select({
      agency: opportunities.agency,
      naicsCode: opportunities.naicsCode,
      setAside: opportunities.setAside,
      stage: opportunities.stage,
      valueLow: opportunities.valueLow,
      valueHigh: opportunities.valueHigh,
      createdAt: opportunities.createdAt,
      awardDate: opportunities.awardDate,
      updatedAt: opportunities.updatedAt,
    })
    .from(opportunities)
    .where(eq(opportunities.organizationId, organizationId));
}
