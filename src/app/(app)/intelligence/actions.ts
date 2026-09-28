"use server";

import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { getAIProviderStatus } from "@/lib/ai";
import type { PipelineSnapshot } from "@/lib/ai-prompts";
import type { BriefFeedback, StoredBrief } from "@/lib/brief-logic";
import { generatePipelineBrief, latestBrief, setBriefFeedback, toStoredBrief } from "@/lib/briefs";
import { log } from "@/lib/log";

/**
 * BL-AIP-7a — the pipeline brief is generated, stored and grounded in
 * `src/lib/briefs.ts`; these actions keep the gates.
 */
export type PipelineBriefResult = {
  ok: true;
  brief: StoredBrief;
  reused: boolean;
  snapshot?: PipelineSnapshot;
};
export type PipelineBriefError = { ok: false; error: string };

export async function generatePipelineBriefAction(
  options: { force?: boolean } = {},
): Promise<PipelineBriefResult | PipelineBriefError> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  try {
    return await generatePipelineBrief({
      organizationId,
      actor: { userId: user.id, email: user.email },
      force: options.force,
    });
  } catch (err) {
    log.error("[generatePipelineBriefAction]", "error", { error: err });
    return { ok: false, error: err instanceof Error ? err.message : "AI request failed." };
  }
}

export async function getLatestPipelineBriefAction(): Promise<StoredBrief | null> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const row = await latestBrief({ organizationId, kind: "pipeline" });
  return row ? toStoredBrief(row) : null;
}

export async function setPipelineBriefFeedbackAction(
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

export async function getProviderStatusAction() {
  await requireAuth();
  return getAIProviderStatus();
}
