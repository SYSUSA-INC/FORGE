"use server";

import { revalidatePath } from "next/cache";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { setPlatformSetting } from "@/lib/platform-settings";
import { enforceRateLimit } from "@/lib/rate-limit";
import { spotCheckSamNotices } from "@/lib/sam-notice-admin";
import type { SpotCheckResult } from "@/lib/sam-notice-csv";
import { runSamNoticeLoad, type SamNoticeLoadResult } from "@/lib/sam-notice-load";

/**
 * BL-STAB-10b — platform-admin controls for FORGE's copy of SAM.gov's
 * notice descriptions. Platform-wide by design; each audit row lands on
 * the admin's current organization, as on Admin → Jobs.
 */
async function audit(actor: { id: string; email?: string | null; organizationId?: string | null }, action: string, metadata: Record<string, unknown>) {
  if (!actor.organizationId) return;
  await recordAudit({ organizationId: actor.organizationId, actor: { userId: actor.id, email: actor.email ?? null }, action, resourceType: "sam_notice", metadata });
}

/** Pause or resume the nightly load, or (10b-3) searches reading the copy. */
export async function setSamNoticeSwitchAction(input: { name: "load" | "reads"; on: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  if (input?.name !== "load" && input?.name !== "reads") return { ok: false, error: "Unknown switch." };
  await setPlatformSetting(`sam_notice.${input.name}`, input.on ? "on" : "off", actor.id);
  await audit(actor, "admin.sam_notice.switch", { name: input.name, on: !!input.on });
  revalidatePath("/admin/sam-notices");
  return { ok: true };
}

/** Run the load now, as the cron would (an unchanged file costs one 304). */
export async function runSamNoticeLoadNowAction(): Promise<{ ok: true; result: SamNoticeLoadResult } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  const result = await runSamNoticeLoad();
  await audit(actor, "admin.sam_notice.run_now", { status: result.status, rowsSeen: result.rowsSeen, rowsWritten: result.rowsWritten });
  revalidatePath("/admin/sam-notices");
  return { ok: true, result };
}

/** Compare 13 stored rows with SAM.gov's live descriptions (shared key; three checks a day). */
export async function spotCheckSamNoticesAction(): Promise<{ ok: true; sampled: number; counts: Record<SpotCheckResult, number> } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  // Counted only when the check would ask SAM.gov: a missing key or an empty copy costs nothing.
  const r = await spotCheckSamNotices(async () =>
    (await enforceRateLimit({ key: "samgov:spot-check", limit: 3, windowSeconds: 86_400 })).ok
      ? null
      : "Three spot-checks a day: each one spends shared-key requests. Try again tomorrow.",
  );
  if (r.ok) await audit(actor, "admin.sam_notice.spot_check", { sampled: r.sampled, ...r.counts });
  return r;
}
