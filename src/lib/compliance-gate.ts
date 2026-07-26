/**
 * BL-FB-CM-GATE — pre-submission compliance gate.
 *
 * Computes whether a proposal is cleared for export against its
 * compliance matrix. The gate is meant to live between the user
 * clicking "Export PDF / DOCX" and the actual render call.
 *
 * Behaviour:
 *   - blocked = true     when one or more compliance items are
 *                        `not_addressed` or `partial` (anything that
 *                        isn't `complete` / `not_applicable`).
 *   - allowOverride       always true today — the gate is advisory
 *                        until tier-level "hard block" is wired in
 *                        BL-FB-CM-GATE-CONFIG. Render actions accept
 *                        `forceExport: true` to bypass.
 *   - hasMatrix          false → no items recorded at all. Gate
 *                        treats this as not-blocked so this PR doesn't
 *                        break existing workflows for tenants who
 *                        haven't built their matrix yet.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceItems, proposals } from "@/db/schema";

export type ComplianceGateStatus = {
  blocked: boolean;
  hasMatrix: boolean;
  totalItems: number;
  completeCount: number;
  partialCount: number;
  notAddressedCount: number;
  notApplicableCount: number;
  /** Pretty summary for in-line UI ("12 of 15 complete · 1 not addressed"). */
  summary: string;
};

export async function getComplianceGateStatus(
  proposalId: string,
  organizationId: string,
): Promise<ComplianceGateStatus> {
  // Verify ownership inline so a hand-typed UUID can't return another
  // tenant's gate status.
  const [own] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(
      and(
        eq(proposals.id, proposalId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!own) {
    return {
      blocked: false,
      hasMatrix: false,
      totalItems: 0,
      completeCount: 0,
      partialCount: 0,
      notAddressedCount: 0,
      notApplicableCount: 0,
      summary: "Proposal not found.",
    };
  }

  const rows = await db
    .select({ status: complianceItems.status })
    .from(complianceItems)
    .where(eq(complianceItems.proposalId, proposalId));

  if (rows.length === 0) {
    return {
      blocked: false,
      hasMatrix: false,
      totalItems: 0,
      completeCount: 0,
      partialCount: 0,
      notAddressedCount: 0,
      notApplicableCount: 0,
      summary: "No compliance matrix recorded — gate is inactive.",
    };
  }

  let complete = 0;
  let partial = 0;
  let notAddressed = 0;
  let notApplicable = 0;
  for (const r of rows) {
    if (r.status === "complete") complete += 1;
    else if (r.status === "partial") partial += 1;
    else if (r.status === "not_applicable") notApplicable += 1;
    else notAddressed += 1;
  }

  const blocked = notAddressed > 0 || partial > 0;

  const parts: string[] = [`${complete} of ${rows.length} complete`];
  if (partial > 0) parts.push(`${partial} partial`);
  if (notAddressed > 0) parts.push(`${notAddressed} not addressed`);
  if (notApplicable > 0) parts.push(`${notApplicable} N/A`);

  return {
    blocked,
    hasMatrix: true,
    totalItems: rows.length,
    completeCount: complete,
    partialCount: partial,
    notAddressedCount: notAddressed,
    notApplicableCount: notApplicable,
    summary: parts.join(" · "),
  };
}

/** Human-readable refusal message — used by render actions. */
export function complianceGateBlockMessage(
  status: ComplianceGateStatus,
): string {
  const bits: string[] = [];
  if (status.notAddressedCount > 0) {
    bits.push(
      `${status.notAddressedCount} requirement${status.notAddressedCount === 1 ? "" : "s"} not addressed`,
    );
  }
  if (status.partialCount > 0) {
    bits.push(
      `${status.partialCount} marked partial`,
    );
  }
  return (
    `Compliance gate blocked the export: ${bits.join(", ")}. ` +
    `Close the gaps on /proposals/[id]/compliance, or pass forceExport=true to override.`
  );
}
