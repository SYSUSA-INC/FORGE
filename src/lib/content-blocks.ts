/**
 * BL-FB-GEN-BLOCKS — the content block library, server side: the org's
 * live boilerplate entries with their latest version number for the
 * editor's picker, and the reuse record an insertion leaves behind.
 * Every query carries organizationId. Server-only; callers own auth.
 */
import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeEntries, knowledgeEntryVersions } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import type { ContentBlockView } from "@/lib/content-blocks-logic";

export type { ContentBlockView } from "@/lib/content-blocks-logic";

export async function listContentBlocks(input: {
  organizationId: string;
  limit?: number;
}): Promise<ContentBlockView[]> {
  const { organizationId } = input;
  const rows = await db
    .select({
      id: knowledgeEntries.id,
      title: knowledgeEntries.title,
      body: knowledgeEntries.body,
      tags: knowledgeEntries.tags,
      reuseCount: knowledgeEntries.reuseCount,
      updatedAt: knowledgeEntries.updatedAt,
    })
    .from(knowledgeEntries)
    .where(
      and(
        eq(knowledgeEntries.organizationId, organizationId),
        eq(knowledgeEntries.kind, "boilerplate"),
        isNull(knowledgeEntries.archivedAt),
      ),
    )
    .orderBy(desc(knowledgeEntries.updatedAt))
    .limit(Math.max(1, Math.min(500, input.limit ?? 200)));
  if (rows.length === 0) return [];

  const versions = await db
    .select({
      entryId: knowledgeEntryVersions.entryId,
      version: sql<number>`max(${knowledgeEntryVersions.version})::int`,
    })
    .from(knowledgeEntryVersions)
    .where(
      and(
        eq(knowledgeEntryVersions.organizationId, organizationId),
        inArray(
          knowledgeEntryVersions.entryId,
          rows.map((r) => r.id),
        ),
      ),
    )
    .groupBy(knowledgeEntryVersions.entryId);
  const latest = new Map(versions.map((v) => [v.entryId, Number(v.version)]));

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    tags: r.tags ?? [],
    reuseCount: r.reuseCount,
    version: latest.get(r.id) ?? 0,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** An insertion from the editor: bump the block's reuse counter and record it. */
export async function recordBlockUse(input: {
  organizationId: string;
  entryId: string;
  proposalId: string;
  sectionId: string;
  actor: { userId: string | null; email?: string | null };
}): Promise<{ ok: true; reuseCount: number } | { ok: false; error: string }> {
  const { organizationId } = input;
  const [row] = await db
    .update(knowledgeEntries)
    .set({ reuseCount: sql`${knowledgeEntries.reuseCount} + 1` })
    .where(
      and(
        eq(knowledgeEntries.id, input.entryId),
        eq(knowledgeEntries.organizationId, organizationId),
        eq(knowledgeEntries.kind, "boilerplate"),
      ),
    )
    .returning({ reuseCount: knowledgeEntries.reuseCount });
  if (!row) return { ok: false, error: "Content block not found." };
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "knowledge_entry.reuse",
    resourceType: "knowledge_entry",
    resourceId: input.entryId,
    metadata: { proposalId: input.proposalId, sectionId: input.sectionId, via: "content_block" },
  });
  return { ok: true, reuseCount: row.reuseCount };
}
