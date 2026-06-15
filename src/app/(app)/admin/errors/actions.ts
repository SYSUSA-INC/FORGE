"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { productionErrors } from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";

/**
 * BL-QC-errors — superadmin actions for triaging the production
 * error log.
 *
 * All actions are superadmin-only — the table is platform-wide ops
 * data, not tenant scoped. Each writes an audit-log row under the
 * `production_error` resource type when the actor has a current org
 * (so the audit row has somewhere to live); if the superadmin has no
 * org context, we fall back to a structured info log so the action is
 * still traceable.
 */

async function auditOrLog(
  actor: { id: string; email?: string | null; organizationId: string | null },
  action: string,
  resourceId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (actor.organizationId) {
    await recordAudit({
      organizationId: actor.organizationId,
      actor: { userId: actor.id, email: actor.email },
      action,
      resourceType: "production_error",
      resourceId,
      metadata,
    });
  } else {
    log.info(`[admin.errors] ${action}`, "by pure superadmin", {
      actorUserId: actor.id,
      resourceId,
      ...(metadata ?? {}),
    });
  }
}

export async function acknowledgeErrorAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  try {
    await db
      .update(productionErrors)
      .set({
        acknowledgedAt: new Date(),
        acknowledgedByUserId: actor.id,
      })
      .where(eq(productionErrors.id, id));
    await auditOrLog(actor, "production_error.acknowledge", id);
    revalidatePath("/admin/errors");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Acknowledge failed.",
    };
  }
}

export async function resolveErrorAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  try {
    const now = new Date();
    await db
      .update(productionErrors)
      .set({
        resolvedAt: now,
        resolvedByUserId: actor.id,
        // Resolving implies acknowledgement.
        acknowledgedAt: now,
        acknowledgedByUserId: actor.id,
      })
      .where(eq(productionErrors.id, id));
    await auditOrLog(actor, "production_error.resolve", id);
    revalidatePath("/admin/errors");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Resolve failed.",
    };
  }
}

export async function unresolveErrorAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  try {
    await db
      .update(productionErrors)
      .set({
        resolvedAt: null,
        resolvedByUserId: null,
      })
      .where(eq(productionErrors.id, id));
    await auditOrLog(actor, "production_error.unresolve", id);
    revalidatePath("/admin/errors");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unresolve failed.",
    };
  }
}

export async function updateErrorNotesAction(
  id: string,
  notes: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  try {
    await db
      .update(productionErrors)
      .set({
        notes: notes.slice(0, 4000),
      })
      .where(eq(productionErrors.id, id));
    await auditOrLog(actor, "production_error.notes.update", id, {
      length: notes.length,
    });
    revalidatePath("/admin/errors");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}
