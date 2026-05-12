"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { bdWatchlistItems } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { safeQuery } from "@/lib/schema-resilience";

export type WatchlistKind = "award" | "firm";

export type WatchlistRow = {
  id: string;
  kind: WatchlistKind;
  externalId: string;
  label: string;
  metadata: Record<string, unknown>;
  notes: string;
  createdAt: string;
  createdBy: string | null;
};

export type WatchlistSaveInput = {
  kind: WatchlistKind;
  externalId: string;
  label: string;
  metadata?: Record<string, unknown>;
  notes?: string;
};

export type WatchlistMutationResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Idempotent save — re-saving an already-watched item is a no-op
 * (returns the existing row's id) so the UI can naively call this on
 * every star-click without checking state first.
 */
export async function saveWatchlistItemAction(
  input: WatchlistSaveInput,
): Promise<WatchlistMutationResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  if (process.env.AWARDS_INTEL_ENABLED !== "1") {
    return {
      ok: false,
      error: "Awards intel is in preview. Ask an admin to set AWARDS_INTEL_ENABLED=1.",
    };
  }
  if (input.kind !== "award" && input.kind !== "firm") {
    return { ok: false, error: "Unknown watchlist kind." };
  }
  const externalId = input.externalId.trim();
  if (!externalId) return { ok: false, error: "externalId is required." };

  try {
    const [existing] = await db
      .select({ id: bdWatchlistItems.id })
      .from(bdWatchlistItems)
      .where(
        and(
          eq(bdWatchlistItems.organizationId, organizationId),
          eq(bdWatchlistItems.kind, input.kind),
          eq(bdWatchlistItems.externalId, externalId),
        ),
      )
      .limit(1);
    if (existing) {
      return { ok: true, id: existing.id };
    }
    const [row] = await db
      .insert(bdWatchlistItems)
      .values({
        organizationId,
        createdBy: actor.id,
        kind: input.kind,
        externalId,
        label: (input.label || "").slice(0, 512),
        metadata: input.metadata ?? {},
        notes: (input.notes || "").slice(0, 4000),
      })
      .returning({ id: bdWatchlistItems.id });
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: `watchlist.${input.kind}.add`,
      resourceType: "bd_watchlist_item",
      resourceId: row.id,
      metadata: { externalId, label: input.label },
    });
    revalidatePath("/intelligence/watchlist");
    return { ok: true, id: row.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function removeWatchlistItemAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  try {
    const [row] = await db
      .delete(bdWatchlistItems)
      .where(
        and(
          eq(bdWatchlistItems.id, id),
          eq(bdWatchlistItems.organizationId, organizationId),
        ),
      )
      .returning({ id: bdWatchlistItems.id, kind: bdWatchlistItems.kind });
    if (!row) return { ok: false, error: "Watchlist item not found." };
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: `watchlist.${row.kind}.remove`,
      resourceType: "bd_watchlist_item",
      resourceId: id,
    });
    revalidatePath("/intelligence/watchlist");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function updateWatchlistNotesAction(
  id: string,
  notes: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  try {
    const [row] = await db
      .update(bdWatchlistItems)
      .set({ notes: notes.slice(0, 4000) })
      .where(
        and(
          eq(bdWatchlistItems.id, id),
          eq(bdWatchlistItems.organizationId, organizationId),
        ),
      )
      .returning({ id: bdWatchlistItems.id, kind: bdWatchlistItems.kind });
    if (!row) return { ok: false, error: "Watchlist item not found." };
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: `watchlist.${row.kind}.update_notes`,
      resourceType: "bd_watchlist_item",
      resourceId: id,
    });
    revalidatePath("/intelligence/watchlist");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Server-side fetch for the watchlist page. */
export async function listWatchlistRows(): Promise<WatchlistRow[]> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return safeQuery<WatchlistRow[]>(
    async () => {
      const rows = await db
        .select()
        .from(bdWatchlistItems)
        .where(eq(bdWatchlistItems.organizationId, organizationId))
        .orderBy(desc(bdWatchlistItems.createdAt))
        .limit(500);
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind as WatchlistKind,
        externalId: r.externalId,
        label: r.label,
        metadata: (r.metadata as Record<string, unknown>) ?? {},
        notes: r.notes,
        createdAt: r.createdAt.toISOString(),
        createdBy: r.createdBy,
      }));
    },
    [],
    { tag: "listWatchlistRows" },
  );
}

/**
 * Lightweight "which of these are already watched?" lookup for
 * lighting up the star button on result lists. Returns a Set of
 * watched externalIds within the given kind.
 */
export async function listWatchedExternalIdsAction(
  kind: WatchlistKind,
  externalIds: string[],
): Promise<string[]> {
  if (!externalIds.length) return [];
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return safeQuery<string[]>(
    async () => {
      const trimmed = externalIds
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 500);
      if (!trimmed.length) return [];
      const rows = await db
        .select({ externalId: bdWatchlistItems.externalId })
        .from(bdWatchlistItems)
        .where(
          and(
            eq(bdWatchlistItems.organizationId, organizationId),
            eq(bdWatchlistItems.kind, kind),
            inArray(bdWatchlistItems.externalId, trimmed),
          ),
        );
      return rows.map((r) => r.externalId);
    },
    [],
    { tag: "listWatchedExternalIdsAction" },
  );
}
