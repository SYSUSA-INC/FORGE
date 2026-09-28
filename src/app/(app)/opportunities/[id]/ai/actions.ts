"use server";

import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import type { BriefFeedback, BriefTrack, StoredBrief } from "@/lib/brief-logic";
import {
  generatePursuitBrief,
  getBriefTrack,
  latestBrief,
  setBriefFeedback,
  toStoredBrief,
} from "@/lib/briefs";
import { log } from "@/lib/log";

/**
 * BL-AIP-7a — the pursuit brief is generated, stored, grounded and
 * graded in `src/lib/briefs.ts`; these actions keep the gates.
 */
export type OpportunityBriefResult = { ok: true; brief: StoredBrief; reused: boolean };
export type OpportunityBriefError = { ok: false; error: string };

export async function generateOpportunityBriefAction(
  opportunityId: string,
  options: { force?: boolean } = {},
): Promise<OpportunityBriefResult | OpportunityBriefError> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  try {
    return await generatePursuitBrief({
      organizationId,
      opportunityId,
      actor: { userId: user.id, email: user.email },
      force: options.force,
    });
  } catch (err) {
    log.error("[generateOpportunityBriefAction]", "error", { error: err });
    return { ok: false, error: err instanceof Error ? err.message : "AI request failed." };
  }
}

export async function getLatestOpportunityBriefAction(
  opportunityId: string,
): Promise<{ brief: StoredBrief | null; track: BriefTrack }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const [row, track] = await Promise.all([
    latestBrief({ organizationId, kind: "pursuit", opportunityId }),
    getBriefTrack({ organizationId }),
  ]);
  return { brief: row ? toStoredBrief(row) : null, track };
}

export async function setBriefFeedbackAction(
  briefId: string,
  feedback: BriefFeedback,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (feedback !== "useful" && feedback !== "not_useful") {
    return { ok: false, error: "Invalid feedback." };
  }
  return setBriefFeedback({
    organizationId,
    briefId,
    feedback,
    actor: { userId: user.id, email: user.email },
  });
}
