/**
 * BL-AIP-5 — seed the compliance matrix from the solicitation's
 * extracted requirements.
 *
 * Until now the matrix was filled only by hand ("Bulk paste shall
 * statements"), so the requirements the intake pipeline had already
 * extracted never reached the proposal. This turns each extracted
 * clause into a `compliance_item` row, categorised from its RFP
 * reference, skipping clauses that are already in the matrix (by
 * normalised text or a near-duplicate). Idempotent: running it twice
 * inserts nothing the second time.
 *
 * Server-only; callers own auth. Runs on proposal creation and behind
 * the "Seed from solicitation" button on the compliance page.
 */
import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceItems, proposals } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import {
  categoryFromRef,
  jaccard,
  requirementKey,
} from "@/lib/requirements-text";
import { loadOpportunityRequirements } from "@/lib/solicitation-requirements";
import { log } from "@/lib/log";

export type SeedComplianceResult =
  | {
      ok: true;
      inserted: number;
      skippedDuplicates: number;
      available: number;
      solicitationCount: number;
    }
  | { ok: false; error: string };

/** Hard ceiling per seed so a runaway extraction cannot flood the matrix. */
export const MAX_SEEDED_ITEMS = 400;

export async function seedComplianceItemsFromRequirements(input: {
  organizationId: string;
  proposalId: string;
  actor: { id: string; email?: string | null };
}): Promise<SeedComplianceResult> {
  const { organizationId, proposalId } = input;
  const [prop] = await db
    .select({ id: proposals.id, opportunityId: proposals.opportunityId })
    .from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  if (!prop) return { ok: false, error: "Proposal not found." };

  const loaded = await loadOpportunityRequirements({
    organizationId,
    opportunityId: prop.opportunityId,
  });
  if (loaded.requirements.length === 0) {
    return {
      ok: true,
      inserted: 0,
      skippedDuplicates: 0,
      available: 0,
      solicitationCount: loaded.solicitationCount,
    };
  }

  const existing = await db
    .select({
      requirementText: complianceItems.requirementText,
      ordering: complianceItems.ordering,
    })
    .from(complianceItems)
    .where(eq(complianceItems.proposalId, proposalId))
    .orderBy(desc(complianceItems.ordering));

  const seen = new Set(existing.map((e) => requirementKey(e.requirementText)));
  const existingTexts = existing.map((e) => e.requirementText);
  let ordering = (existing[0]?.ordering ?? 0) + 1;
  let skippedDuplicates = 0;

  const values: (typeof complianceItems.$inferInsert)[] = [];
  for (const r of loaded.requirements) {
    if (values.length >= MAX_SEEDED_ITEMS) break;
    const key = requirementKey(r.text);
    if (!key) continue;
    if (seen.has(key) || existingTexts.some((t) => jaccard(t, r.text) >= 0.6)) {
      skippedDuplicates += 1;
      continue;
    }
    seen.add(key);
    existingTexts.push(r.text);
    values.push({
      proposalId,
      category: categoryFromRef(r.ref, r.text),
      number: (r.ref ?? "").slice(0, 64),
      requirementText: r.text.slice(0, 4_000),
      rfpPageReference: r.ref ? r.ref.slice(0, 64) : "",
      notes: r.kind === "shall" ? "" : `Extracted as a "${r.kind}" statement.`,
      ordering: ordering++,
      createdByUserId: input.actor.id,
    });
  }

  if (values.length > 0) {
    try {
      await db.insert(complianceItems).values(values);
    } catch (err) {
      log.error("[seedComplianceItemsFromRequirements]", "insert failed", {
        error: err,
        proposalId,
        organizationId,
      });
      return { ok: false, error: "Could not write the compliance items." };
    }
  }

  await recordAudit({
    organizationId,
    actor: { userId: input.actor.id, email: input.actor.email },
    action: "proposal.compliance.seed",
    resourceType: "proposal",
    resourceId: proposalId,
    metadata: {
      proposalId,
      inserted: values.length,
      skippedDuplicates,
      available: loaded.requirements.length,
      solicitationCount: loaded.solicitationCount,
      primarySolicitationId: loaded.primarySolicitationId,
    },
  });

  return {
    ok: true,
    inserted: values.length,
    skippedDuplicates,
    available: loaded.requirements.length,
    solicitationCount: loaded.solicitationCount,
  };
}
