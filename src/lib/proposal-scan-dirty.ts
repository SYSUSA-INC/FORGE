/**
 * BL-FB-SCAN-CONTINUOUS — internal helper, NOT a server action.
 *
 * Marks a proposal "dirty" — content changed since the last AI health
 * scan. Idempotent: later edits don't move the `scanDirtySince`
 * timestamp forward because we want to record the OLDEST unscanned
 * edit (so the debounce window measures from there).
 *
 * Callers must already have verified that the proposal belongs to
 * the calling user's org. This helper is purposefully NOT exported
 * from a "use server" file so it isn't callable from the client —
 * its `organizationId` parameter is caller-controlled but always
 * comes from the trusted `requireCurrentOrg()` result of the
 * enclosing server action.
 */
import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { proposals } from "@/db/schema";
import { log } from "@/lib/log";

export async function markScanDirty(
  proposalId: string,
  organizationId: string,
): Promise<void> {
  try {
    await db
      .update(proposals)
      .set({ scanDirtySince: new Date() })
      .where(
        and(
          eq(proposals.id, proposalId),
          eq(proposals.organizationId, organizationId),
          // Only set when null — preserve the OLDEST dirtying edit so
          // the debounce window measures from there.
          isNull(proposals.scanDirtySince),
        ),
      );
  } catch (err) {
    log.warn("[markScanDirty]", "update failed", { error: err });
  }
}
