"use server";

import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  opportunitySourceRequests,
  users,
  type OpportunitySourceRequestStatus,
} from "@/db/schema";
import {
  requireAuth,
  requireCurrentOrg,
  requireSuperadmin,
} from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { enforceRateLimit } from "@/lib/rate-limit";
import { safeQuery } from "@/lib/schema-resilience";
import { log } from "@/lib/log";

// ────────────────────────────────────────────────────────────────────
// Tenant-scoped actions
// ────────────────────────────────────────────────────────────────────

export type CreateSourceRequestInput = {
  sourceName: string;
  description: string;
  sampleText: string;
};

export type CreateSourceRequestResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const SOURCE_NAME_MAX = 128;
const DESCRIPTION_MAX = 2000;
const SAMPLE_TEXT_MAX = 10_000;

/**
 * Tenant-side: submit a new source-request. Rate-limited per org so
 * a noisy tenant can't flood the super-admin triage queue.
 */
export async function createSourceRequestAction(
  input: CreateSourceRequestInput,
): Promise<CreateSourceRequestResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const sourceName = input.sourceName.trim();
  const description = input.description.trim();
  const sampleText = input.sampleText.trim();

  if (!sourceName) {
    return { ok: false, error: "Give the source a short name." };
  }
  if (sourceName.length > SOURCE_NAME_MAX) {
    return {
      ok: false,
      error: `Source name is too long (max ${SOURCE_NAME_MAX} chars).`,
    };
  }
  if (!description) {
    return {
      ok: false,
      error: "Add a one-paragraph description so we know what it is.",
    };
  }
  if (description.length > DESCRIPTION_MAX) {
    return {
      ok: false,
      error: `Description is too long (max ${DESCRIPTION_MAX} chars).`,
    };
  }
  if (sampleText.length > SAMPLE_TEXT_MAX) {
    return {
      ok: false,
      error: `Sample paste is too long (max ${SAMPLE_TEXT_MAX} chars).`,
    };
  }

  const limit = await enforceRateLimit({
    key: `source-request:org:${organizationId}`,
    limit: 10,
    windowSeconds: 24 * 3600,
  });
  if (!limit.ok) {
    return {
      ok: false,
      error: `Daily limit reached. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.`,
    };
  }

  try {
    const [row] = await db
      .insert(opportunitySourceRequests)
      .values({
        organizationId,
        requesterUserId: actor.id,
        sourceName,
        description,
        sampleText,
        status: "pending",
      })
      .returning({ id: opportunitySourceRequests.id });
    if (!row) return { ok: false, error: "Could not record request." };

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "source_request.create",
      resourceType: "source_request",
      resourceId: row.id,
      metadata: { sourceName },
    });

    revalidatePath("/opportunities/import");
    return { ok: true, id: row.id };
  } catch (err) {
    log.error("[createSourceRequestAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Submission failed.",
    };
  }
}

export type TenantSourceRequest = {
  id: string;
  sourceName: string;
  description: string;
  sampleText: string;
  status: OpportunitySourceRequestStatus;
  platformNotes: string;
  createdAt: string;
  statusChangedAt: string | null;
};

/**
 * Tenant-side: list this org's own submitted requests, newest first.
 * Used in the import page so customers can see status changes.
 */
export async function listOwnSourceRequestsAction(): Promise<
  TenantSourceRequest[]
> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // safeQuery so a missing migration 0032 on the deployed DB
  // degrades to "no requests yet" rather than crashing the page.
  type SourceRow = {
    id: string;
    sourceName: string;
    description: string;
    sampleText: string;
    status: OpportunitySourceRequestStatus;
    platformNotes: string;
    createdAt: Date;
    statusChangedAt: Date | null;
  };
  const rows = await safeQuery<SourceRow[]>(
    () =>
      db
        .select({
          id: opportunitySourceRequests.id,
          sourceName: opportunitySourceRequests.sourceName,
          description: opportunitySourceRequests.description,
          sampleText: opportunitySourceRequests.sampleText,
          status: opportunitySourceRequests.status,
          platformNotes: opportunitySourceRequests.platformNotes,
          createdAt: opportunitySourceRequests.createdAt,
          statusChangedAt: opportunitySourceRequests.statusChangedAt,
        })
        .from(opportunitySourceRequests)
        .where(eq(opportunitySourceRequests.organizationId, organizationId))
        .orderBy(desc(opportunitySourceRequests.createdAt)),
    [],
    { tag: "opportunitySourceRequests.listOwn" },
  );

  return rows.map((r) => ({
    id: r.id,
    sourceName: r.sourceName,
    description: r.description,
    sampleText: r.sampleText,
    status: r.status,
    platformNotes: r.platformNotes,
    createdAt: r.createdAt.toISOString(),
    statusChangedAt: r.statusChangedAt
      ? r.statusChangedAt.toISOString()
      : null,
  }));
}

// ────────────────────────────────────────────────────────────────────
// Super-admin actions
// ────────────────────────────────────────────────────────────────────

export type AdminSourceRequest = {
  id: string;
  organizationId: string;
  organizationName: string | null;
  sourceName: string;
  description: string;
  sampleText: string;
  status: OpportunitySourceRequestStatus;
  platformNotes: string;
  requesterName: string | null;
  requesterEmail: string | null;
  createdAt: string;
  statusChangedAt: string | null;
};

/**
 * Super-admin: list every source request across every tenant. Joined
 * with users to surface who submitted each one and with organizations
 * to show which tenant. Newest first.
 */
export async function listAllSourceRequestsAction(): Promise<
  AdminSourceRequest[]
> {
  await requireSuperadmin();

  // Lazy import — avoids pulling organizations into the tenant
  // bundle which doesn't need it.
  const { organizations } = await import("@/db/schema");

  type AdminRow = {
    id: string;
    organizationId: string;
    organizationName: string | null;
    sourceName: string;
    description: string;
    sampleText: string;
    status: OpportunitySourceRequestStatus;
    platformNotes: string;
    requesterUserId: string | null;
    requesterName: string | null;
    requesterEmail: string | null;
    createdAt: Date;
    statusChangedAt: Date | null;
  };
  const rows = await safeQuery<AdminRow[]>(
    () =>
      db
        .select({
          id: opportunitySourceRequests.id,
          organizationId: opportunitySourceRequests.organizationId,
          organizationName: organizations.name,
          sourceName: opportunitySourceRequests.sourceName,
          description: opportunitySourceRequests.description,
          sampleText: opportunitySourceRequests.sampleText,
          status: opportunitySourceRequests.status,
          platformNotes: opportunitySourceRequests.platformNotes,
          requesterUserId: opportunitySourceRequests.requesterUserId,
          requesterName: users.name,
          requesterEmail: users.email,
          createdAt: opportunitySourceRequests.createdAt,
          statusChangedAt: opportunitySourceRequests.statusChangedAt,
        })
        .from(opportunitySourceRequests)
        .leftJoin(
          organizations,
          eq(organizations.id, opportunitySourceRequests.organizationId),
        )
        .leftJoin(
          users,
          eq(users.id, opportunitySourceRequests.requesterUserId),
        )
        .orderBy(desc(opportunitySourceRequests.createdAt)),
    [],
    { tag: "opportunitySourceRequests.listAll" },
  );

  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organizationId,
    organizationName: r.organizationName,
    sourceName: r.sourceName,
    description: r.description,
    sampleText: r.sampleText,
    status: r.status,
    platformNotes: r.platformNotes,
    requesterName: r.requesterName,
    requesterEmail: r.requesterEmail,
    createdAt: r.createdAt.toISOString(),
    statusChangedAt: r.statusChangedAt
      ? r.statusChangedAt.toISOString()
      : null,
  }));
}

export type UpdateSourceRequestInput = {
  id: string;
  status: OpportunitySourceRequestStatus;
  platformNotes?: string;
};

export type UpdateSourceRequestResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Super-admin: change a request's status and/or write platform-side
 * notes. statusChangedAt resets when the status actually changes;
 * notes-only edits don't bump it.
 */
export async function updateSourceRequestAction(
  input: UpdateSourceRequestInput,
): Promise<UpdateSourceRequestResult> {
  const actor = await requireSuperadmin();

  if (
    !["pending", "under_review", "shipped", "rejected"].includes(input.status)
  ) {
    return { ok: false, error: "Invalid status." };
  }
  const notes =
    typeof input.platformNotes === "string"
      ? input.platformNotes.slice(0, DESCRIPTION_MAX)
      : undefined;

  try {
    // Read current status so we can decide whether to update statusChangedAt.
    const [existing] = await db
      .select({ status: opportunitySourceRequests.status })
      .from(opportunitySourceRequests)
      .where(eq(opportunitySourceRequests.id, input.id))
      .limit(1);
    if (!existing) return { ok: false, error: "Request not found." };

    const statusChanged = existing.status !== input.status;
    const now = new Date();

    await db
      .update(opportunitySourceRequests)
      .set({
        status: input.status,
        ...(notes !== undefined ? { platformNotes: notes } : {}),
        ...(statusChanged ? { statusChangedAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(opportunitySourceRequests.id, input.id));

    // Audit log against the requesting org (so tenants can see
    // platform-team actions that touch their requests too).
    const [reqRow] = await db
      .select({ organizationId: opportunitySourceRequests.organizationId })
      .from(opportunitySourceRequests)
      .where(eq(opportunitySourceRequests.id, input.id))
      .limit(1);
    if (reqRow) {
      await recordAudit({
        organizationId: reqRow.organizationId,
        actor: { userId: actor.id, email: actor.email },
        action: "source_request.update_status",
        resourceType: "source_request",
        resourceId: input.id,
        metadata: {
          fromStatus: existing.status,
          toStatus: input.status,
          superadmin: true,
        },
      });
    }

    revalidatePath("/admin/source-requests");
    revalidatePath("/opportunities/import");
    return { ok: true };
  } catch (err) {
    log.error("[updateSourceRequestAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}
