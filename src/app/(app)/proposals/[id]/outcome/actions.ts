"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  proposalDebriefs,
  proposalOutcomes,
  proposals,
  type ProposalDebriefFormat,
  type ProposalDebriefStatus,
  type ProposalOutcomeReason,
  type ProposalOutcomeType,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { OUTCOME_REASONS } from "@/lib/proposal-outcome-types";

const OUTCOME_TYPES: ProposalOutcomeType[] = [
  "won",
  "lost",
  "no_bid",
  "withdrawn",
];

const DEBRIEF_STATUSES: ProposalDebriefStatus[] = [
  "not_requested",
  "requested",
  "scheduled",
  "held",
  "declined_by_govt",
  "not_offered",
  "waived",
];

const DEBRIEF_FORMATS: ProposalDebriefFormat[] = [
  "written",
  "oral",
  "both",
  "unknown",
];

async function ownsProposal(id: string, organizationId: string) {
  const [row] = await db
    .select({ id: proposals.id, stage: proposals.stage })
    .from(proposals)
    .where(
      and(eq(proposals.id, id), eq(proposals.organizationId, organizationId)),
    )
    .limit(1);
  return row ?? null;
}

function parseDate(value: FormDataEntryValue | null): Date | null {
  if (!value || typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getString(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function saveOutcomeAction(
  proposalId: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const owned = await ownsProposal(proposalId, organizationId);
  if (!owned) return { ok: false, error: "Proposal not found." };

  const outcomeTypeRaw = getString(formData, "outcomeType");
  if (!OUTCOME_TYPES.includes(outcomeTypeRaw as ProposalOutcomeType)) {
    return { ok: false, error: "Pick an outcome type." };
  }
  const outcomeType = outcomeTypeRaw as ProposalOutcomeType;

  const reasonsRaw = formData.getAll("reasons");
  const reasons = reasonsRaw
    .map((r) => (typeof r === "string" ? r : ""))
    .filter((r): r is ProposalOutcomeReason =>
      OUTCOME_REASONS.includes(r as ProposalOutcomeReason),
    );

  const decisionDate = parseDate(formData.get("decisionDate"));

  const payload = {
    organizationId,
    proposalId,
    outcomeType,
    awardValue: getString(formData, "awardValue"),
    decisionDate,
    reasons,
    summary: getString(formData, "summary"),
    lessonsLearned: getString(formData, "lessonsLearned"),
    followUpActions: getString(formData, "followUpActions"),
    awardedToCompetitor: getString(formData, "awardedToCompetitor"),
    createdByUserId: user.id,
    updatedAt: new Date(),
  };

  try {
    const [existing] = await db
      .select({ id: proposalOutcomes.id })
      .from(proposalOutcomes)
      .where(eq(proposalOutcomes.proposalId, proposalId))
      .limit(1);

    if (existing) {
      const { createdByUserId: _ignored, ...update } = payload;
      void _ignored;
      await db
        .update(proposalOutcomes)
        .set(update)
        .where(eq(proposalOutcomes.id, existing.id));
    } else {
      await db.insert(proposalOutcomes).values(payload);
    }

    const stageMap: Record<ProposalOutcomeType, string> = {
      won: "awarded",
      lost: "lost",
      no_bid: "no_bid",
      withdrawn: "no_bid",
    };
    if (owned.stage !== stageMap[outcomeType]) {
      await db
        .update(proposals)
        .set({
          stage: stageMap[outcomeType] as never,
          updatedAt: new Date(),
        })
        .where(eq(proposals.id, proposalId));
    }

    revalidatePath(`/proposals/${proposalId}`);
    revalidatePath(`/proposals/${proposalId}/outcome`);
    revalidatePath(`/proposals`);
    return { ok: true };
  } catch (err) {
    console.error("[saveOutcomeAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save outcome.",
    };
  }
}

export async function saveDebriefAction(
  proposalId: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }

  const statusRaw = getString(formData, "status");
  if (!DEBRIEF_STATUSES.includes(statusRaw as ProposalDebriefStatus)) {
    return { ok: false, error: "Pick a debrief status." };
  }
  const formatRaw = getString(formData, "format") || "unknown";
  if (!DEBRIEF_FORMATS.includes(formatRaw as ProposalDebriefFormat)) {
    return { ok: false, error: "Pick a debrief format." };
  }

  const [outcome] = await db
    .select({ id: proposalOutcomes.id })
    .from(proposalOutcomes)
    .where(eq(proposalOutcomes.proposalId, proposalId))
    .limit(1);

  const payload = {
    organizationId,
    proposalId,
    outcomeId: outcome?.id ?? null,
    status: statusRaw as ProposalDebriefStatus,
    format: formatRaw as ProposalDebriefFormat,
    requestedAt: parseDate(formData.get("requestedAt")),
    scheduledFor: parseDate(formData.get("scheduledFor")),
    heldOn: parseDate(formData.get("heldOn")),
    governmentAttendees: getString(formData, "governmentAttendees"),
    ourAttendees: getString(formData, "ourAttendees"),
    strengths: getString(formData, "strengths"),
    weaknesses: getString(formData, "weaknesses"),
    improvements: getString(formData, "improvements"),
    pastPerformanceCitation: getString(formData, "pastPerformanceCitation"),
    notes: getString(formData, "notes"),
    createdByUserId: user.id,
    updatedAt: new Date(),
  };

  try {
    const [existing] = await db
      .select({ id: proposalDebriefs.id })
      .from(proposalDebriefs)
      .where(eq(proposalDebriefs.proposalId, proposalId))
      .limit(1);

    if (existing) {
      const { createdByUserId: _ignored, ...update } = payload;
      void _ignored;
      await db
        .update(proposalDebriefs)
        .set(update)
        .where(eq(proposalDebriefs.id, existing.id));
    } else {
      await db.insert(proposalDebriefs).values(payload);
    }

    revalidatePath(`/proposals/${proposalId}/outcome`);
    return { ok: true };
  } catch (err) {
    console.error("[saveDebriefAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save debrief.",
    };
  }
}
