"use server";

import { revalidatePath } from "next/cache";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { isKnownEnvLabel, isProductionEnv, KNOWN_ENV_LABELS, resolveEnvLabel } from "@/lib/env-label";
import { readEnvMarker, relabelEnvMarker } from "@/lib/env-marker";
import { log } from "@/lib/log";
import {
  getMigrationStatus,
  runMigrations,
  scanPendingForDestructive,
  type DestructiveFinding,
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
      /** BL-ENV-SEP — set when production needs an explicit acknowledgement. */
      needsAcknowledgement?: boolean;
      destructive?: DestructiveFinding[];
    };

/**
 * Apply pending migrations against this database. Super-admin gated.
 * Audit-logged so we always know who applied what.
 *
 * Idempotent — re-running on a synced DB is a no-op (everything lands
 * in skippedFilenames). Tamper detection aborts if a previously-applied
 * migration's content has changed.
 *
 * BL-ENV-SEP: in production, pending migrations that contain destructive
 * operations are refused until the operator acknowledges them (having
 * taken a snapshot and reviewed each one). Staging and preview apply
 * without the extra step — that is what they are for.
 */
export async function runMigrationsAction(input?: {
  acknowledgeDestructive?: boolean;
}): Promise<RunMigrationsActionResult> {
  const actor = await requireSuperadmin();

  if (isProductionEnv()) {
    const destructive = await scanPendingForDestructive();
    if (destructive.length > 0 && !input?.acknowledgeDestructive) {
      return {
        ok: false,
        error: `Production: ${destructive.length} pending migration${destructive.length === 1 ? "" : "s"} contain destructive operations. Take a Neon snapshot, review each one, then acknowledge to apply.`,
        appliedFilenames: [],
        needsAcknowledgement: true,
        destructive,
      };
    }
  }

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
        environment: resolveEnvLabel(),
        acknowledgedDestructive: Boolean(input?.acknowledgeDestructive),
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

// ── BL-ENV-SEP — environment marker ─────────────────────────────────

export type EnvMarkerStatus = {
  /** What this process believes it is (FORGE_ENV_OVERRIDE → VERCEL_ENV). */
  runtime: string | null;
  /** What the database says it belongs to. */
  marker: { expectedEnv: string; firstSeenAt: string | null; lastVerifiedAt: string | null } | null;
  knownLabels: readonly string[];
};

export async function getEnvMarkerStatusAction(): Promise<EnvMarkerStatus> {
  await requireSuperadmin();
  const marker = await readEnvMarker();
  return {
    runtime: resolveEnvLabel(),
    marker: marker
      ? {
          expectedEnv: marker.expectedEnv,
          firstSeenAt: marker.firstSeenAt?.toISOString() ?? null,
          lastVerifiedAt: marker.lastVerifiedAt?.toISOString() ?? null,
        }
      : null,
    knownLabels: KNOWN_ENV_LABELS,
  };
}

/**
 * Re-label the database's environment marker — the affordance the 0055
 * migration header promised. Only for a cutover (a former-prod DB
 * becoming staging, or vice versa). Requires the operator to type the
 * new label in capitals as confirmation, because the next boot of any
 * deploy whose runtime label differs will refuse to start.
 */
export async function relabelEnvMarkerAction(input: {
  label: string;
  confirmation: string;
}): Promise<{ ok: true; previous: string | null; label: string } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();

  const label = (input.label ?? "").trim().toLowerCase();
  if (!isKnownEnvLabel(label)) {
    return { ok: false, error: `Label must be one of: ${KNOWN_ENV_LABELS.join(", ")}.` };
  }
  if ((input.confirmation ?? "").trim() !== label.toUpperCase()) {
    return { ok: false, error: `Type ${label.toUpperCase()} to confirm.` };
  }

  const { previous } = await relabelEnvMarker(label);

  log.warn("[env-marker]", "marker relabelled by superadmin", {
    previous,
    label,
    actor: actor.email,
    runtime: resolveEnvLabel(),
  });
  if (actor.organizationId) {
    await recordAudit({
      organizationId: actor.organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "platform.env_marker.relabel",
      resourceType: "platform",
      resourceId: "env_marker",
      metadata: { previous, label, runtime: resolveEnvLabel() },
    });
  }

  revalidatePath("/admin/migrations");
  return { ok: true, previous, label };
}
