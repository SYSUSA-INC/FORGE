"use server";

import { revalidatePath } from "next/cache";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import {
  getMigrationStatus,
  runMigrations,
} from "@/lib/migration-runner";

export type MigrationStatusResult = {
  expectedFiles: string[];
  appliedFiles: string[];
  pendingFiles: string[];
};

export async function getMigrationStatusAction(): Promise<MigrationStatusResult> {
  await requireSuperadmin();
  return getMigrationStatus();
}

export type RunMigrationsActionResult =
  | {
      ok: true;
      appliedFilenames: string[];
      skippedFilenames: string[];
    }
  | {
      ok: false;
      error: string;
      appliedFilenames: string[];
    };

/**
 * Apply pending migrations against the production DB. Super-admin
 * gated. Audit-logged so we always know who applied what.
 *
 * Idempotent — re-running on a synced DB is a no-op (everything
 * lands in skippedFilenames). Tamper detection aborts if a
 * previously-applied migration's content has changed.
 */
export async function runMigrationsAction(): Promise<RunMigrationsActionResult> {
  const actor = await requireSuperadmin();

  const result = await runMigrations();

  // Audit against a sentinel "platform" org_id since this is a
  // cross-tenant operation. Per the BL-18 platform audit log
  // design, those events live in the same audit_log table — for
  // now we record under the actor's primary org so the entry
  // shows up somewhere visible. Refine when BL-18 lands.
  if (actor.organizationId) {
    await recordAudit({
      organizationId: actor.organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: result.ok ? "platform.migrations.run" : "platform.migrations.failed",
      resourceType: "platform",
      resourceId: "migrations",
      metadata: {
        applied: result.appliedFilenames,
        ...(result.ok ? { skipped: result.skippedFilenames } : { error: result.error }),
      },
    });
  }

  revalidatePath("/admin");
  return result;
}

// `markMigrationsAppliedThroughAction` was removed in BL-QC-sync-ledger-
// retire. It was the entry point for the "Sync ledger" UI affordance
// that caused the 2026-06-15 schema drift incident (false-applied
// ledger entries past the actual high-water mark). The underlying
// `markMigrationsAppliedThrough` helper in migration-runner.ts is
// kept as a low-level utility (now hardened to refuse syncing past
// missing tables — see BL-QC-ledger-drift-detector / PR #203) for
// genuine emergencies, but no UI entry exists. Operators in such an
// emergency must construct the call deliberately, which is the
// intended friction.
