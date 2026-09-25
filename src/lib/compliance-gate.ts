/**
 * BL-FB-CM-GATE — pre-submission compliance gate.
 *
 * Computes whether a proposal is cleared for export against its
 * compliance matrix and the text of its sections. The gate sits between
 * the user clicking "Export PDF / DOCX" and the actual render call.
 *
 * BL-AIP-5 made it a real gate:
 *   - blocked = true     when one or more compliance items are
 *                        `not_addressed` or `partial` (anything that
 *                        isn't `complete` / `not_applicable`), OR any
 *                        section still carries a "[NEEDS CITATION]"
 *                        marker left by citation mode.
 *   - Override           no longer a checkbox. The render actions accept
 *                        `override: { reason }` from an org admin or the
 *                        proposal manager only, and audit it
 *                        (`proposal.export.gate_override`).
 *   - hasMatrix          false → no items recorded. Open markers still
 *                        block; an empty matrix on its own does not, so
 *                        tenants who never built one keep exporting.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceItems, proposalSections, proposals, type TipTapDoc } from "@/db/schema";
import { NEEDS_CITATION_MARKER } from "@/lib/citations";
import { projectToPlain } from "@/lib/tiptap-doc";

export type ComplianceGateStatus = {
  blocked: boolean;
  hasMatrix: boolean;
  totalItems: number;
  completeCount: number;
  partialCount: number;
  notAddressedCount: number;
  notApplicableCount: number;
  /** BL-AIP-5 — "[NEEDS CITATION]" markers still in section bodies. */
  needsCitationCount: number;
  /** Titles of the sections carrying markers. */
  needsCitationSections: string[];
  /** Pretty summary for in-line UI ("12 of 15 complete · 1 not addressed · 2 citations open"). */
  summary: string;
};

const EMPTY: Omit<ComplianceGateStatus, "summary"> = {
  blocked: false,
  hasMatrix: false,
  totalItems: 0,
  completeCount: 0,
  partialCount: 0,
  notAddressedCount: 0,
  notApplicableCount: 0,
  needsCitationCount: 0,
  needsCitationSections: [],
};

const NEEDS_CITATION_RE = /\[NEEDS CITATION\]/gi;

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
    return { ...EMPTY, summary: "Proposal not found." };
  }

  const rows = await db
    .select({ status: complianceItems.status })
    .from(complianceItems)
    .where(eq(complianceItems.proposalId, proposalId));

  // BL-AIP-5 — a draft that still says "[NEEDS CITATION]" is not done.
  const sections = await db
    .select({
      title: proposalSections.title,
      bodyDoc: proposalSections.bodyDoc,
      content: proposalSections.content,
    })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId));
  let needsCitationCount = 0;
  const needsCitationSections: string[] = [];
  for (const s of sections) {
    const plain = projectToPlain(s.bodyDoc as TipTapDoc | null) || s.content || "";
    const n = plain.match(NEEDS_CITATION_RE)?.length ?? 0;
    if (n > 0) {
      needsCitationCount += n;
      needsCitationSections.push(s.title);
    }
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

  const hasMatrix = rows.length > 0;
  const blocked = notAddressed > 0 || partial > 0 || needsCitationCount > 0;

  const parts: string[] = [];
  if (hasMatrix) {
    parts.push(`${complete} of ${rows.length} complete`);
    if (partial > 0) parts.push(`${partial} partial`);
    if (notAddressed > 0) parts.push(`${notAddressed} not addressed`);
    if (notApplicable > 0) parts.push(`${notApplicable} N/A`);
  } else {
    parts.push("No compliance matrix recorded");
  }
  if (needsCitationCount > 0) {
    parts.push(
      `${needsCitationCount} ${NEEDS_CITATION_MARKER} marker${needsCitationCount === 1 ? "" : "s"} open in ${needsCitationSections.length} section${needsCitationSections.length === 1 ? "" : "s"}`,
    );
  }

  return {
    blocked,
    hasMatrix,
    totalItems: rows.length,
    completeCount: complete,
    partialCount: partial,
    notAddressedCount: notAddressed,
    notApplicableCount: notApplicable,
    needsCitationCount,
    needsCitationSections,
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
    bits.push(`${status.partialCount} marked partial`);
  }
  if (status.needsCitationCount > 0) {
    bits.push(
      `${status.needsCitationCount} ${NEEDS_CITATION_MARKER} marker${status.needsCitationCount === 1 ? "" : "s"} in ${status.needsCitationSections.join(", ")}`,
    );
  }
  return (
    `Compliance gate blocked the export: ${bits.join(", ")}. ` +
    `Close the gaps on the compliance matrix and resolve the citation markers in the editor. ` +
    `An org admin or the proposal manager can override with a written reason; the override is recorded in the audit log.`
  );
}
