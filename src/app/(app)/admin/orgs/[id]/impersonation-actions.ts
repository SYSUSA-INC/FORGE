"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  organizations,
  superadminImpersonationSessions,
} from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import {
  IMPERSONATION_TTL_MS,
  clearImpersonationCookie,
  getActiveImpersonationSession,
  setImpersonationCookie,
} from "@/lib/impersonation";
import { log } from "@/lib/log";

/**
 * BL-15 Phase B-3b — start a super-admin impersonation session.
 *
 * Refuses when:
 *   - The target org doesn't exist or is disabled.
 *   - The caller already has an active impersonation session (must
 *     end the current one before starting a new one; one-at-a-time
 *     enforcement keeps the audit trail simple).
 *   - Reason is empty or shorter than 8 chars (forces a real
 *     justification — "test" doesn't help future investigators).
 *
 * Audits as `superadmin.assume_start` into the target org's log so
 * tenant admins can see the platform-support access on their own
 * `/audit-log` page.
 */
export async function startImpersonationAction(input: {
  organizationId: string;
  reason: string;
}): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();

  if (!input.organizationId) {
    return { ok: false, error: "Target organization required." };
  }
  const reason = (input.reason ?? "").trim();
  if (reason.length < 8) {
    return {
      ok: false,
      error:
        "Reason must be at least 8 characters (e.g. a ticket id + brief description).",
    };
  }
  if (reason.length > 500) {
    return {
      ok: false,
      error: "Reason too long (max 500 characters).",
    };
  }

  const [org] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      disabledAt: organizations.disabledAt,
    })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);

  if (!org) return { ok: false, error: "Organization not found." };
  if (org.disabledAt) {
    return {
      ok: false,
      error: "Cannot impersonate a disabled organization.",
    };
  }

  // Reject if the super-admin already has an active session.
  const existing = await getActiveImpersonationSession(actor.id);
  if (existing) {
    return {
      ok: false,
      error:
        "End your current impersonation session before starting a new one.",
    };
  }

  const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MS);

  try {
    const [row] = await db
      .insert(superadminImpersonationSessions)
      .values({
        superadminUserId: actor.id,
        targetOrganizationId: org.id,
        reason,
        expiresAt,
      })
      .returning({ id: superadminImpersonationSessions.id });

    if (!row) {
      return { ok: false, error: "Could not start impersonation session." };
    }

    setImpersonationCookie(row.id);

    await recordAudit({
      organizationId: org.id,
      actor: { userId: actor.id, email: actor.email },
      action: "superadmin.assume_start",
      resourceType: "superadmin_impersonation_session",
      resourceId: row.id,
      metadata: {
        reason,
        expiresAt: expiresAt.toISOString(),
        targetOrganizationName: org.name,
        viaSuperadmin: true,
      },
    });

    revalidatePath("/");
    revalidatePath(`/admin/orgs/${org.id}`);
    return { ok: true, sessionId: row.id };
  } catch (err) {
    log.error("[startImpersonationAction]", "insert failed", {
      error: err,
      targetOrganizationId: org.id,
    });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Start failed.",
    };
  }
}

/**
 * BL-15 Phase B-3b — end the active impersonation session for the
 * calling super-admin. Idempotent: clearing the cookie + setting
 * `ended_at` even when nothing is active is safe.
 *
 * Always called from outside the impersonated context (the middleware
 * write-block makes a special exception for this action).
 */
export async function endImpersonationAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const actor = await requireSuperadmin();

  try {
    // Find any active session for this super-admin (cookie may have
    // been cleared client-side but the row could still exist) and
    // close it. Filter by user id so we never accidentally close
    // another super-admin's session.
    const closedRows = await db
      .update(superadminImpersonationSessions)
      .set({ endedAt: new Date() })
      .where(
        and(
          eq(superadminImpersonationSessions.superadminUserId, actor.id),
          isNull(superadminImpersonationSessions.endedAt),
        ),
      )
      .returning({
        id: superadminImpersonationSessions.id,
        targetOrganizationId:
          superadminImpersonationSessions.targetOrganizationId,
        startedAt: superadminImpersonationSessions.startedAt,
      });

    clearImpersonationCookie();

    for (const row of closedRows) {
      await recordAudit({
        organizationId: row.targetOrganizationId,
        actor: { userId: actor.id, email: actor.email },
        action: "superadmin.assume_end",
        resourceType: "superadmin_impersonation_session",
        resourceId: row.id,
        metadata: {
          durationMs: Date.now() - row.startedAt.getTime(),
          viaSuperadmin: true,
        },
      });
    }

    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    log.error("[endImpersonationAction]", "end failed", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "End failed.",
    };
  }
}
