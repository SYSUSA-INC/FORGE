import { and, eq, lt } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { auditLogs, organizations } from "@/db/schema";
import { log } from "@/lib/log";

/**
 * BL-12 — tenant-scoped audit log helper.
 *
 * Called from every mutating server action and from sensitive reads
 * (export, share-link generation, etc.). Failures here are logged
 * but never thrown — auditing must not block the user's action. If
 * the audit row can't be persisted we lose forensics on that one
 * call but the action itself still completes.
 *
 * Convention for `action`: "<resource>.<verb>" — e.g.
 *   opportunity.create, opportunity.update, opportunity.delete,
 *   opportunity.advance_stage,
 *   proposal.create, proposal.advance_stage, proposal.section.save,
 *   solicitation.upload, solicitation.review.run,
 *   solicitation.matrix.run, solicitation.questions.run,
 *   user.invite, user.role_change, user.disable,
 *   org.create, org.disable, org.restore,
 *   settings.update, template.create, template.update,
 *   knowledge_entry.create, knowledge_entry.delete,
 *   notification.dismiss, source_request.create
 */

export type AuditInput = {
  organizationId: string;
  actor: {
    userId: string | null;
    email?: string | null;
  };
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
};

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const { ip, userAgent } = await readRequestContext();
    await db.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorUserId: input.actor.userId,
      actorEmailSnapshot: (input.actor.email ?? "").slice(0, 256),
      action: input.action.slice(0, 128),
      resourceType: (input.resourceType ?? "").slice(0, 64),
      resourceId: (input.resourceId ?? "").slice(0, 128),
      metadata: input.metadata ?? {},
      ip: ip.slice(0, 64),
      userAgent: userAgent.slice(0, 512),
    });
  } catch (err) {
    // Audit writes are best-effort — never let a failure break the
    // user-facing action that triggered it. Log structured so a
    // recurring failure is investigatable.
    log.error("[recordAudit]", "failed to write audit row", {
      error: err,
      action: input.action,
      organizationId: input.organizationId,
    });
  }
}

/**
 * Same shape as recordAudit, but semantic sugar for sensitive reads
 * (export, share-link generation, search results that surface PII).
 * Adds a `category: "read"` field so the UI can filter on it.
 */
export async function recordRead(input: AuditInput): Promise<void> {
  return recordAudit({
    ...input,
    metadata: {
      ...(input.metadata ?? {}),
      category: "read",
    },
  });
}

export type AuthDenyReason =
  | "not_member"
  | "not_org_admin"
  | "not_superadmin";

/**
 * BL-20 — record an authorization denial as a synthetic audit row.
 * Called by the `require*` auth helpers when they're about to redirect
 * a request that doesn't meet the bar.
 *
 * Skips fully-unauthenticated denials silently because `audit_log`
 * requires an `organization_id` and we have no tenant context until
 * the caller is signed in. Anonymous probing surfaces in HTTP logs
 * instead.
 */
export async function recordAuthDenied(input: {
  user: { id: string; email?: string | null };
  organizationId: string | null;
  reason: AuthDenyReason;
  attemptedOrgId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!input.organizationId) return;
  return recordAudit({
    organizationId: input.organizationId,
    actor: { userId: input.user.id, email: input.user.email },
    action: "auth_denied",
    resourceType: "auth",
    resourceId: input.reason,
    metadata: {
      ...(input.metadata ?? {}),
      reason: input.reason,
      ...(input.attemptedOrgId
        ? { attemptedOrgId: input.attemptedOrgId }
        : {}),
    },
  });
}

export type PruneResult = {
  organizations: number;
  rowsDeleted: number;
};

/**
 * BL-12c — prune audit_log rows older than each tenant's configured
 * retention window. Called by the daily cron at
 * /api/cron/prune-audit-logs. Per-tenant deletes keep us within the
 * isolation contract: every WHERE has an organization_id filter.
 *
 * Returns a summary so the cron handler can log it for ops.
 */
export async function pruneAuditLogsAcrossTenants(): Promise<PruneResult> {
  const orgs = await db
    .select({
      id: organizations.id,
      auditRetentionDays: organizations.auditRetentionDays,
    })
    .from(organizations);

  let rowsDeleted = 0;
  for (const org of orgs) {
    const cutoff = new Date(
      Date.now() - org.auditRetentionDays * 24 * 60 * 60_000,
    );
    try {
      const result = await db
        .delete(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, org.id),
            lt(auditLogs.createdAt, cutoff),
          ),
        )
        .returning({ id: auditLogs.id });
      rowsDeleted += result.length;
    } catch (err) {
      log.error("[pruneAuditLogs]", "delete failed for org", {
        error: err,
        organizationId: org.id,
      });
    }
  }

  return { organizations: orgs.length, rowsDeleted };
}

/**
 * Pull request context (IP, user-agent) from the current request's
 * headers. Returns blanks when called outside an HTTP context
 * (background tasks, scripts). x-forwarded-for is honored when
 * present — Vercel sets it on every request.
 */
async function readRequestContext(): Promise<{
  ip: string;
  userAgent: string;
}> {
  try {
    const h = headers();
    const fwd = h.get("x-forwarded-for") ?? "";
    const ip = fwd.split(",")[0]?.trim() || h.get("x-real-ip") || "";
    const userAgent = h.get("user-agent") ?? "";
    return { ip, userAgent };
  } catch {
    return { ip: "", userAgent: "" };
  }
}
