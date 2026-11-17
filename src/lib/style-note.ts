/**
 * BL-NAV-LIFECYCLE 5d-2 — the style note against Postgres: the weekly
 * rebuild, and the reads for the drafter and the AI Draft Insights panel.
 *
 * A note is built from one tenant's own rows and stored under that
 * tenant's id. Every query here filters on the organizationId the caller
 * passes (from `requireCurrentOrg`, or the cron's per-tenant loop);
 * sections are reached through their proposal's organization. Nothing is
 * read or written across tenants. No AI call: a rebuild spends no quota.
 */
import "server-only";

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  proposalSectionKindEnum,
  proposalSectionSnapshots,
  proposalSections,
  proposals,
  sectionChangeDecisions,
  sectionStyleNotes,
  type TipTapDoc,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { latestPerSection } from "@/lib/draft-learning-logic";
import { EDIT_FEEDBACK_MIN_SAMPLE } from "@/lib/edit-feedback-summary";
import { log } from "@/lib/log";
import {
  buildStyleNote,
  hasStyleContent,
  parseStyleNoteBody,
  type StyleDecision,
  type StyleDraft,
  type StyleNoteBody,
  type StyleNoteView,
} from "@/lib/style-note-logic";
import { projectToPlain, validateDoc } from "@/lib/tiptap-doc";
import { isAiAuthor } from "@/lib/tracked-diff";

/** The same window and sample cap the drafter's edit feedback uses. */
export const STYLE_NOTE_WINDOW_DAYS = 180;
const DECISION_LIMIT = 300;
const DRAFT_LIMIT = 60;

type SectionKind = (typeof proposalSectionKindEnum.enumValues)[number];
const SECTION_KINDS: readonly string[] = proposalSectionKindEnum.enumValues;

async function loadDecisions(organizationId: string, sectionKind: string, since: Date): Promise<StyleDecision[]> {
  const rows = await db
    .select({
      changeType: sectionChangeDecisions.changeType,
      decision: sectionChangeDecisions.decision,
      text: sectionChangeDecisions.changeText,
      createdAt: sectionChangeDecisions.createdAt,
      authorUserId: sectionChangeDecisions.authorUserId,
      bulk: sectionChangeDecisions.bulk,
      wordCount: sectionChangeDecisions.wordCount,
      reviewColor: sectionChangeDecisions.reviewColor,
    })
    .from(sectionChangeDecisions)
    .where(
      and(
        eq(sectionChangeDecisions.organizationId, organizationId),
        eq(sectionChangeDecisions.sectionKind, sectionKind),
        gte(sectionChangeDecisions.createdAt, since),
      ),
    )
    .orderBy(desc(sectionChangeDecisions.createdAt))
    .limit(DECISION_LIMIT);
  return rows
    .filter((r) => (r.changeType === "insert" || r.changeType === "delete") && (r.decision === "accept" || r.decision === "reject"))
    .map((r) => ({
      changeType: r.changeType as "insert" | "delete",
      decision: r.decision as "accept" | "reject",
      text: r.text,
      createdAt: r.createdAt,
      fromAi: isAiAuthor(r.authorUserId),
      bulk: r.bulk,
      wordCount: r.wordCount,
      fromReviewer: r.reviewColor !== null,
    }));
}

/** The tenant's recent AI drafts for sections of one kind, beside each section's text now. */
async function loadDrafts(organizationId: string, sectionKind: SectionKind, since: Date): Promise<StyleDraft[]> {
  const rows = await db
    .select({
      sectionId: proposalSectionSnapshots.proposalSectionId,
      draftDoc: proposalSectionSnapshots.bodyDoc,
      bodyDoc: proposalSections.bodyDoc,
      content: proposalSections.content,
    })
    .from(proposalSectionSnapshots)
    .innerJoin(proposalSections, eq(proposalSections.id, proposalSectionSnapshots.proposalSectionId))
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .where(
      and(
        eq(proposalSectionSnapshots.organizationId, organizationId),
        eq(proposals.organizationId, organizationId),
        eq(proposalSectionSnapshots.kind, "ai_draft"),
        eq(proposalSections.kind, sectionKind),
        gte(proposalSectionSnapshots.createdAt, since),
      ),
    )
    .orderBy(desc(proposalSectionSnapshots.createdAt))
    .limit(DRAFT_LIMIT);
  return latestPerSection(rows).map((r) => {
    const doc = validateDoc(r.bodyDoc) as TipTapDoc | null;
    return { sectionId: r.sectionId, draftText: projectToPlain(r.draftDoc), currentText: doc ? projectToPlain(doc) : (r.content ?? "") };
  });
}

/**
 * Rebuild one tenant's notes, one per section kind. A kind with fewer than
 * five decisions in the window gets no note, and loses the one it had.
 */
export async function rebuildStyleNotesForOrg(input: { organizationId: string; now?: Date }): Promise<{ built: number; cleared: number }> {
  const { organizationId } = input;
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - STYLE_NOTE_WINDOW_DAYS * 86_400_000);
  let built = 0;
  let cleared = 0;

  for (const sectionKind of proposalSectionKindEnum.enumValues) {
    const decisions = await loadDecisions(organizationId, sectionKind, since);
    const body =
      decisions.length >= EDIT_FEEDBACK_MIN_SAMPLE
        ? buildStyleNote({ decisions, drafts: await loadDrafts(organizationId, sectionKind, since), windowDays: STYLE_NOTE_WINDOW_DAYS })
        : null;
    if (!body) {
      const gone = await db
        .delete(sectionStyleNotes)
        .where(and(eq(sectionStyleNotes.organizationId, organizationId), eq(sectionStyleNotes.sectionKind, sectionKind)))
        .returning({ sectionKind: sectionStyleNotes.sectionKind });
      cleared += gone.length;
      continue;
    }
    await db
      .insert(sectionStyleNotes)
      .values({ organizationId, sectionKind, body, sampleSize: body.sampleSize, builtAt: now })
      .onConflictDoUpdate({
        target: [sectionStyleNotes.organizationId, sectionStyleNotes.sectionKind],
        set: { body, sampleSize: body.sampleSize, builtAt: now },
      });
    built += 1;
  }

  if (built > 0 || cleared > 0) {
    await recordAudit({
      organizationId,
      actor: { userId: null, email: null },
      action: "style_note.rebuild",
      resourceType: "section_style_note",
      resourceId: organizationId,
      metadata: { built, cleared, windowDays: STYLE_NOTE_WINDOW_DAYS },
    });
  }
  return { built, cleared };
}

export type StyleNoteCronSummary = { organizations: number; built: number; cleared: number; errors: number; deferred: number };

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

/**
 * Weekly: every enabled tenant that recorded a tracked-change decision in
 * the window, or still holds a note, least recently rebuilt first, inside a
 * time budget. Cross-org by design: a background worker that only lists
 * tenant ids; each tenant's rows are read and written through
 * `rebuildStyleNotesForOrg` with its own id.
 */
export async function runStyleNoteCron(opts: { maxOrgs?: number; budgetMs?: number; now?: Date } = {}): Promise<StyleNoteCronSummary> {
  const maxOrgs = opts.maxOrgs ?? 200;
  const budgetMs = opts.budgetMs ?? 240_000;
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - STYLE_NOTE_WINDOW_DAYS * 86_400_000);
  const started = Date.now();
  const summary: StyleNoteCronSummary = { organizations: 0, built: 0, cleared: 0, errors: 0, deferred: 0 };

  const due = rowsOf<{ organization_id: string }>(
    await db.execute(sql`
      SELECT org.id AS organization_id
      FROM organization org
      WHERE org.disabled_at IS NULL
        AND (
          EXISTS (SELECT 1 FROM section_change_decision d WHERE d.organization_id = org.id AND d.created_at >= ${since.toISOString()}::timestamptz)
          OR EXISTS (SELECT 1 FROM section_style_note n WHERE n.organization_id = org.id)
        )
      ORDER BY (SELECT MIN(n.built_at) FROM section_style_note n WHERE n.organization_id = org.id) ASC NULLS FIRST
      LIMIT ${maxOrgs}
    `),
  );

  for (const row of due) {
    if (Date.now() - started > budgetMs) {
      summary.deferred += 1;
      continue;
    }
    try {
      const r = await rebuildStyleNotesForOrg({ organizationId: row.organization_id, now });
      summary.organizations += 1;
      summary.built += r.built;
      summary.cleared += r.cleared;
    } catch (err) {
      summary.errors += 1;
      log.warn("[style-note]", "rebuild failed", { organizationId: row.organization_id, error: err });
    }
  }
  return summary;
}

export type StoredStyleNote = { sectionKind: string; builtAt: string; body: StyleNoteBody };

/** A tenant's notes for some section kinds; kinds without a usable note are absent. */
export async function listStyleNotes(input: { organizationId: string; sectionKinds: string[] }): Promise<StoredStyleNote[]> {
  const kinds = [...new Set(input.sectionKinds)].filter((k) => SECTION_KINDS.includes(k));
  if (kinds.length === 0) return [];
  const rows = await db
    .select({ sectionKind: sectionStyleNotes.sectionKind, body: sectionStyleNotes.body, builtAt: sectionStyleNotes.builtAt })
    .from(sectionStyleNotes)
    .where(and(eq(sectionStyleNotes.organizationId, input.organizationId), inArray(sectionStyleNotes.sectionKind, kinds)));
  return rows
    .flatMap((r) => {
      const body = parseStyleNoteBody(r.body);
      return body && hasStyleContent(body) ? [{ sectionKind: r.sectionKind, builtAt: r.builtAt.toISOString(), body }] : [];
    })
    .sort((a, b) => SECTION_KINDS.indexOf(a.sectionKind) - SECTION_KINDS.indexOf(b.sectionKind));
}

/** What the drafter reads for one section kind, or null. */
export async function getStyleNoteView(input: { organizationId: string; sectionKind: string }): Promise<StyleNoteView | null> {
  const [note] = await listStyleNotes({ organizationId: input.organizationId, sectionKinds: [input.sectionKind] });
  if (!note) return null;
  const { cut, added, preferredWording, avoidedWording, droppedFromAiDrafts } = note.body;
  return { sectionKind: note.sectionKind, builtAt: note.builtAt, cut, added, preferredWording, avoidedWording, droppedFromAiDrafts };
}
