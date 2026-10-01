/**
 * BL-FB-GEN-BLOCKS — version history of knowledge entries, server side.
 *
 * `recordEntryVersion` appends a row for a saved state (the first
 * tracked save of an older entry also records the pre-change state as
 * v1, so the changelog starts from something real); `listEntryVersions`
 * reads the changelog; `restoreEntryVersion` writes an older state back
 * onto the entry — re-scored and re-embedded like any save — and appends
 * a new row saying so. Every query carries organizationId. Server-only;
 * callers own auth.
 */
import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeEntries, knowledgeEntryVersions, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import {
  CHANGE_NOTE_MAX,
  countWords,
  versionDelta,
  type EntryState,
} from "@/lib/content-blocks-logic";
import { embedKnowledgeEntry } from "@/lib/knowledge-entry-embed";
import { scoreKnowledgeEntry } from "@/lib/knowledge-quality";
import { log } from "@/lib/log";

type Actor = { userId: string | null; email?: string | null };

export type EntryVersionView = {
  id: string;
  version: number;
  title: string;
  body: string;
  tags: string[];
  changeNote: string;
  wordsAdded: number;
  wordsRemoved: number;
  authorName: string | null;
  createdAt: string;
};

async function latestVersionNumber(organizationId: string, entryId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${knowledgeEntryVersions.version}), 0)::int` })
    .from(knowledgeEntryVersions)
    .where(and(eq(knowledgeEntryVersions.organizationId, organizationId), eq(knowledgeEntryVersions.entryId, entryId)));
  return Number(row?.max ?? 0);
}

/**
 * Append the saved state as the next version. With `previous` and no
 * history yet, the previous state becomes v1 first so the first diff
 * has something to diff against. Returns the new version number.
 */
export async function recordEntryVersion(input: {
  organizationId: string;
  entryId: string;
  state: EntryState;
  previous?: EntryState | null;
  changeNote: string;
  actor: Actor;
}): Promise<number> {
  const { organizationId } = input;
  let n = await latestVersionNumber(organizationId, input.entryId);
  if (n === 0 && input.previous) {
    await db.insert(knowledgeEntryVersions).values({
      organizationId,
      entryId: input.entryId,
      version: 1,
      title: input.previous.title,
      body: input.previous.body,
      tags: input.previous.tags,
      changeNote: "Before first tracked change",
      wordsAdded: countWords(input.previous.body),
      wordsRemoved: 0,
      createdByUserId: null,
    });
    n = 1;
  }
  const delta = input.previous
    ? versionDelta(input.previous, input.state)
    : { wordsAdded: countWords(input.state.body), wordsRemoved: 0 };
  const version = n + 1;
  await db.insert(knowledgeEntryVersions).values({
    organizationId,
    entryId: input.entryId,
    version,
    title: input.state.title,
    body: input.state.body,
    tags: input.state.tags,
    changeNote: input.changeNote.replace(/\s+/g, " ").trim().slice(0, CHANGE_NOTE_MAX),
    wordsAdded: delta.wordsAdded,
    wordsRemoved: delta.wordsRemoved,
    createdByUserId: input.actor.userId,
  });
  return version;
}

/** The changelog, newest first. */
export async function listEntryVersions(input: {
  organizationId: string;
  entryId: string;
  limit?: number;
}): Promise<EntryVersionView[]> {
  const { organizationId } = input;
  const rows = await db
    .select({
      id: knowledgeEntryVersions.id,
      version: knowledgeEntryVersions.version,
      title: knowledgeEntryVersions.title,
      body: knowledgeEntryVersions.body,
      tags: knowledgeEntryVersions.tags,
      changeNote: knowledgeEntryVersions.changeNote,
      wordsAdded: knowledgeEntryVersions.wordsAdded,
      wordsRemoved: knowledgeEntryVersions.wordsRemoved,
      authorName: users.name,
      authorEmail: users.email,
      createdAt: knowledgeEntryVersions.createdAt,
    })
    .from(knowledgeEntryVersions)
    .leftJoin(users, eq(users.id, knowledgeEntryVersions.createdByUserId))
    .where(and(eq(knowledgeEntryVersions.organizationId, organizationId), eq(knowledgeEntryVersions.entryId, input.entryId)))
    .orderBy(desc(knowledgeEntryVersions.version))
    .limit(Math.max(1, Math.min(200, input.limit ?? 50)));
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    title: r.title,
    body: r.body,
    tags: r.tags ?? [],
    changeNote: r.changeNote,
    wordsAdded: r.wordsAdded,
    wordsRemoved: r.wordsRemoved,
    authorName: r.authorName || r.authorEmail || null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export type RestoreResult = { ok: true; version: number } | { ok: false; error: string };

/** Write an older version back onto the entry and record it as a new version. */
export async function restoreEntryVersion(input: {
  organizationId: string;
  entryId: string;
  version: number;
  actor: Actor;
}): Promise<RestoreResult> {
  const { organizationId } = input;
  const [target] = await db
    .select({ title: knowledgeEntryVersions.title, body: knowledgeEntryVersions.body, tags: knowledgeEntryVersions.tags })
    .from(knowledgeEntryVersions)
    .where(
      and(
        eq(knowledgeEntryVersions.organizationId, organizationId),
        eq(knowledgeEntryVersions.entryId, input.entryId),
        eq(knowledgeEntryVersions.version, input.version),
      ),
    )
    .limit(1);
  if (!target) return { ok: false, error: "Version not found." };

  const [current] = await db
    .select({
      kind: knowledgeEntries.kind,
      title: knowledgeEntries.title,
      body: knowledgeEntries.body,
      tags: knowledgeEntries.tags,
      metadata: knowledgeEntries.metadata,
    })
    .from(knowledgeEntries)
    .where(and(eq(knowledgeEntries.id, input.entryId), eq(knowledgeEntries.organizationId, organizationId)))
    .limit(1);
  if (!current) return { ok: false, error: "Entry not found." };

  const state: EntryState = { title: target.title, body: target.body, tags: target.tags ?? [] };
  const quality = scoreKnowledgeEntry({ kind: current.kind, ...state, metadata: current.metadata });
  await db
    .update(knowledgeEntries)
    .set({
      title: state.title,
      body: state.body,
      tags: state.tags,
      qualityScore: quality.score,
      qualityScoreFactors: quality.factors,
      qualityScoredAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(knowledgeEntries.id, input.entryId), eq(knowledgeEntries.organizationId, organizationId)));
  await embedKnowledgeEntry(organizationId, input.entryId, state.title, state.body).catch((err) =>
    log.warn("[entry-versions]", "re-embed after restore failed", { organizationId, error: err }),
  );

  const version = await recordEntryVersion({
    organizationId,
    entryId: input.entryId,
    state,
    previous: { title: current.title, body: current.body, tags: current.tags ?? [] },
    changeNote: `Restored v${input.version}`,
    actor: input.actor,
  });
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "knowledge_entry.version.restore",
    resourceType: "knowledge_entry",
    resourceId: input.entryId,
    metadata: { restored: input.version, version },
  });
  return { ok: true, version };
}
