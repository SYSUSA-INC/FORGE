import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { organizationModels } from "@/db/schema";
import type { CompanyModelBody } from "@/lib/company-model";

/**
 * BL-COMPANY-MODEL phase 1c — the one read every consumer uses: the
 * approved body only (a draft never counts), or null when none is
 * approved yet so each reader keeps its own fallback.
 */
export type ApprovedCompanyModel = { body: CompanyModelBody; version: number; approvedAt: Date | null };

export async function getApprovedCompanyModel(organizationId: string): Promise<ApprovedCompanyModel | null> {
  const [row] = await db
    .select({ approved: organizationModels.approved, version: organizationModels.approvedVersion, approvedAt: organizationModels.approvedAt })
    .from(organizationModels)
    .where(and(eq(organizationModels.organizationId, organizationId), isNotNull(organizationModels.approved)))
    .limit(1);
  if (!row?.approved) return null;
  return { body: row.approved, version: row.version, approvedAt: row.approvedAt };
}
