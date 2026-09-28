"use server";

import { revalidatePath } from "next/cache";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { runJobsCron, type JobsCronSummary } from "@/lib/jobs";

/**
 * BL-AIP-4c — run one jobs-cron tick on demand from the admin page
 * (preview deployments have no Vercel Cron; production operators can
 * drain the queue without waiting five minutes). Platform-wide by
 * design; the audit row lands on the superadmin's current org.
 */
export async function runJobsNowAction(): Promise<
  { ok: true; summary: JobsCronSummary } | { ok: false; error: string }
> {
  const actor = await requireSuperadmin();
  try {
    const summary = await runJobsCron({ maxJobs: 5 });
    if (actor.organizationId) {
      await recordAudit({
        organizationId: actor.organizationId,
        actor: { userId: actor.id, email: actor.email ?? null },
        action: "admin.jobs.run_now",
        resourceType: "background_job",
        metadata: { ...summary },
      });
    }
    revalidatePath("/admin/jobs");
    return { ok: true, summary };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Run failed." };
  }
}
