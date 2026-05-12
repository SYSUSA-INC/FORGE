"use server";

import { and, desc, eq, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { bdSavedSearches, users } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { safeQuery } from "@/lib/schema-resilience";

export type SavedSearchKind = "awards" | "firms";

export type SavedSearchRow = {
  id: string;
  name: string;
  kind: SavedSearchKind;
  criteria: Record<string, unknown>;
  shared: boolean;
  createdBy: string | null;
  /** Owner email snapshot for display; "" when owner has been removed. */
  ownerEmail: string;
  /** True when the current user owns this row (can edit/delete). */
  mine: boolean;
  createdAt: string;
  lastRunAt: string | null;
};

export type SavedSearchSaveInput = {
  name: string;
  kind: SavedSearchKind;
  criteria: Record<string, unknown>;
  shared: boolean;
};

export type SavedSearchMutation =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function saveSavedSearchAction(
  input: SavedSearchSaveInput,
): Promise<SavedSearchMutation> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  if (process.env.AWARDS_INTEL_ENABLED !== "1") {
    return {
      ok: false,
      error: "Awards intel is in preview. Ask an admin to set AWARDS_INTEL_ENABLED=1.",
    };
  }
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (input.kind !== "awards" && input.kind !== "firms") {
    return { ok: false, error: "Unknown saved-search kind." };
  }
  try {
    const [row] = await db
      .insert(bdSavedSearches)
      .values({
        organizationId,
        createdBy: actor.id,
        name: name.slice(0, 200),
        kind: input.kind,
        criteria: input.criteria,
        shared: !!input.shared,
      })
      .returning({ id: bdSavedSearches.id });
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: `saved_search.${input.kind}.create`,
      resourceType: "bd_saved_search",
      resourceId: row.id,
      metadata: { name, shared: input.shared },
    });
    revalidatePath("/intelligence/saved-searches");
    return { ok: true, id: row.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function updateSavedSearchAction(
  id: string,
  patch: Partial<SavedSearchSaveInput>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  try {
    // Only the owner can edit. Read-then-write to enforce.
    const [existing] = await db
      .select({
        id: bdSavedSearches.id,
        createdBy: bdSavedSearches.createdBy,
        kind: bdSavedSearches.kind,
      })
      .from(bdSavedSearches)
      .where(
        and(
          eq(bdSavedSearches.id, id),
          eq(bdSavedSearches.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!existing) return { ok: false, error: "Saved search not found." };
    if (existing.createdBy !== actor.id) {
      return { ok: false, error: "Only the owner can edit a saved search." };
    }

    const update: Record<string, unknown> = {};
    if (typeof patch.name === "string") update.name = patch.name.trim().slice(0, 200);
    if (patch.criteria) update.criteria = patch.criteria;
    if (typeof patch.shared === "boolean") update.shared = patch.shared;
    if (Object.keys(update).length === 0) return { ok: true };

    await db
      .update(bdSavedSearches)
      .set(update)
      .where(eq(bdSavedSearches.id, id));

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: `saved_search.${existing.kind}.update`,
      resourceType: "bd_saved_search",
      resourceId: id,
      metadata: update,
    });
    revalidatePath("/intelligence/saved-searches");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function deleteSavedSearchAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  try {
    const [row] = await db
      .delete(bdSavedSearches)
      .where(
        and(
          eq(bdSavedSearches.id, id),
          eq(bdSavedSearches.organizationId, organizationId),
          eq(bdSavedSearches.createdBy, actor.id),
        ),
      )
      .returning({ id: bdSavedSearches.id, kind: bdSavedSearches.kind });
    if (!row) {
      return { ok: false, error: "Saved search not found, or you don't own it." };
    }
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: `saved_search.${row.kind}.delete`,
      resourceType: "bd_saved_search",
      resourceId: id,
    });
    revalidatePath("/intelligence/saved-searches");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Returns saved searches visible to the current user: their private
 * ones plus all org-shared ones. Owner email is left-joined and
 * snapshotted as a string (empty when owner has been removed from
 * the org).
 */
export async function listSavedSearches(): Promise<SavedSearchRow[]> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return safeQuery<SavedSearchRow[]>(
    async () => {
      const rows = await db
        .select({
          id: bdSavedSearches.id,
          name: bdSavedSearches.name,
          kind: bdSavedSearches.kind,
          criteria: bdSavedSearches.criteria,
          shared: bdSavedSearches.shared,
          createdBy: bdSavedSearches.createdBy,
          ownerEmail: users.email,
          createdAt: bdSavedSearches.createdAt,
          lastRunAt: bdSavedSearches.lastRunAt,
        })
        .from(bdSavedSearches)
        .leftJoin(users, eq(users.id, bdSavedSearches.createdBy))
        .where(
          and(
            eq(bdSavedSearches.organizationId, organizationId),
            or(
              eq(bdSavedSearches.shared, true),
              eq(bdSavedSearches.createdBy, actor.id),
            ),
          ),
        )
        .orderBy(desc(bdSavedSearches.createdAt))
        .limit(500);
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind as SavedSearchKind,
        criteria: (r.criteria as Record<string, unknown>) ?? {},
        shared: r.shared,
        createdBy: r.createdBy,
        ownerEmail: r.ownerEmail ?? "",
        mine: r.createdBy === actor.id,
        createdAt: r.createdAt.toISOString(),
        lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
      }));
    },
    [],
    { tag: "listSavedSearches" },
  );
}

/**
 * Returns the criteria payload for a single saved search, scoped to
 * the requesting user's org and visibility (own + shared). Used by
 * the awards/firms search pages to hydrate filters from a deep link.
 * Returns null when the row is invisible to the caller.
 */
export async function loadSavedSearchAction(
  id: string,
): Promise<{
  id: string;
  name: string;
  kind: SavedSearchKind;
  criteria: Record<string, unknown>;
} | null> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return safeQuery(
    async () => {
      const [row] = await db
        .select({
          id: bdSavedSearches.id,
          name: bdSavedSearches.name,
          kind: bdSavedSearches.kind,
          criteria: bdSavedSearches.criteria,
          shared: bdSavedSearches.shared,
          createdBy: bdSavedSearches.createdBy,
        })
        .from(bdSavedSearches)
        .where(
          and(
            eq(bdSavedSearches.id, id),
            eq(bdSavedSearches.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row) return null;
      if (!row.shared && row.createdBy !== actor.id) return null;
      return {
        id: row.id,
        name: row.name,
        kind: row.kind as SavedSearchKind,
        criteria: (row.criteria as Record<string, unknown>) ?? {},
      };
    },
    null,
    { tag: "loadSavedSearchAction" },
  );
}

export async function touchSavedSearchLastRunAction(
  id: string,
): Promise<void> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  try {
    await db
      .update(bdSavedSearches)
      .set({ lastRunAt: new Date() })
      .where(
        and(
          eq(bdSavedSearches.id, id),
          eq(bdSavedSearches.organizationId, organizationId),
          // Only the owner counts the run; shared viewers don't bump it.
          eq(bdSavedSearches.createdBy, actor.id),
        ),
      );
  } catch {
    // Best-effort — failure here doesn't impact the user's search.
  }
}
