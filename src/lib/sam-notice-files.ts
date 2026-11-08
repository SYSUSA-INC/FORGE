import "server-only";

import { log } from "@/lib/log";

/**
 * BL-SCOUT-FILES (owner, 2026-11-07: "can you also download attachments
 * that are with the opportunity, so that we have everything ready") — an
 * opportunity added from a SAM.gov notice gets the notice's attachments
 * at once: a durable job runs the amendment watch's check for it, which
 * files every attachment of the notice (and any amendment) on the
 * opportunity and queues each one to be read. Before this they arrived
 * only with the next daily check. Best effort: a failure is logged and
 * the daily check tries again.
 */
export async function queueNoticeFiles(input: { organizationId: string; opportunityId: string; userId?: string | null }): Promise<void> {
  try {
    const { runDurable } = await import("@/lib/jobs");
    await runDurable("[sam-notice-files] download", {
      organizationId: input.organizationId,
      kind: "sam_notice_files",
      resourceId: input.opportunityId,
      requestedByUserId: input.userId ?? null,
      maxAttempts: 2,
    });
  } catch (err) {
    log.warn("[sam-notice-files]", "not queued", { organizationId: input.organizationId, opportunityId: input.opportunityId, error: err instanceof Error ? err.message : err });
  }
}

/** For the job runner: the watch's check for one opportunity. A refusal (no key, SAM.gov down) fails the job so it is retried once. */
export async function handleSamNoticeFiles(job: { organizationId: string; resourceId: string }): Promise<void> {
  const { checkOpportunityNotices } = await import("@/lib/amendment-watch");
  const res = await checkOpportunityNotices({ organizationId: job.organizationId, opportunityId: job.resourceId });
  if (!res.ok) throw new Error(res.error);
  log.info("[sam-notice-files]", "filed", { organizationId: job.organizationId, opportunityId: job.resourceId, filed: res.filed, skipped: res.skipped.length });
}
