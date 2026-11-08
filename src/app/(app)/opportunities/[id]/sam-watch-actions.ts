"use server";

import { revalidatePath } from "next/cache";
import { checkOpportunityNotices } from "@/lib/amendment-watch";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";

export type SamWatchActionResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * BL-SCOUT-AMEND — "Check SAM.gov now" on an opportunity: the daily
 * amendment watch, run for this one opportunity on the company's key.
 * The check is scoped and audited (`opportunity.sam_watch`).
 */
export async function checkSamNowAction(opportunityId: string): Promise<SamWatchActionResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await checkOpportunityNotices({
    organizationId,
    opportunityId: String(opportunityId ?? ""),
    actor: { userId: user.id, email: user.email },
    // Within the page's 300 s: no download starts that could end after 240 s.
    downloadsUntil: Date.now() + 240_000,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath("/");
  const parts = [
    res.filed > 0 ? `${res.filed} document${res.filed === 1 ? "" : "s"} filed and being read` : "Nothing new on SAM.gov",
    res.amendments > 0 ? `${res.amendments} new amendment${res.amendments === 1 ? "" : "s"}` : "",
    res.dueMovedTo ? `response date moved to ${res.dueMovedTo}` : "",
    res.notified ? "the team was told" : "",
    res.retrying > 0 ? `${res.retrying} more on the next check` : "",
    res.skipped.length > res.retrying ? `${res.skipped.length - res.retrying} couldn't be downloaded` : "",
  ].filter(Boolean);
  return { ok: true, message: `${parts.join("; ")}.` };
}
