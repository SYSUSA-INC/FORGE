"use server";

import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { recordRead } from "@/lib/audit-log";
import { reportsRefusal } from "@/lib/reports";

const TABLES = ["agency", "naics", "set_aside", "funnel", "months"] as const;

/**
 * BL-PACKAGES add-ons Slice 2c — a Reports table is about to be
 * downloaded as CSV (built in the browser from what the page already
 * shows). Checks the plan and records the export in the audit log.
 */
export async function recordReportExportAction(input: { table: string; range: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(TABLES as readonly string[]).includes(input.table)) return { ok: false, error: "Unknown report." };
  const refusal = await reportsRefusal(organizationId);
  if (refusal) return { ok: false, error: refusal };
  await recordRead({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "report.export",
    resourceType: "report",
    resourceId: input.table,
    metadata: { range: input.range.slice(0, 8) },
  });
  return { ok: true };
}
