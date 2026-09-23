/**
 * BL-9 Slice 7 — load a tenant's recent track-changes decisions and
 * summarise them for the section drafter.
 *
 * Prefers decisions made on sections of the same kind (an executive
 * summary is edited differently from a pricing volume); when the kind
 * has too few rows it falls back to the org's decisions across kinds.
 * Best-effort: any failure returns null and the draft proceeds without
 * this signal, like every other pattern-intel input.
 */
import "server-only";

import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { sectionChangeDecisions } from "@/db/schema";
import {
  EDIT_FEEDBACK_MIN_SAMPLE,
  summarizeEditDecisions,
  type EditDecisionInput,
  type EditFeedbackSummary,
} from "@/lib/edit-feedback-summary";
import { log } from "@/lib/log";

const WINDOW_DAYS = 180;
const SAMPLE_LIMIT = 300;
/** Below this many same-kind rows, widen to every section kind. */
const KIND_MIN_ROWS = 20;

export async function gatherEditFeedbackForSection(input: {
  organizationId: string;
  sectionKind: string;
}): Promise<EditFeedbackSummary | null> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  try {
    const byKind = await loadDecisions({
      organizationId: input.organizationId,
      since,
      sectionKind: input.sectionKind,
    });
    const rows =
      byKind.length >= KIND_MIN_ROWS
        ? byKind
        : await loadDecisions({ organizationId: input.organizationId, since });
    if (rows.length < EDIT_FEEDBACK_MIN_SAMPLE) return null;
    return summarizeEditDecisions(rows, { windowDays: WINDOW_DAYS });
  } catch (err) {
    log.warn("[edit-feedback]", "decision load failed", { error: err });
    return null;
  }
}

async function loadDecisions(input: {
  organizationId: string;
  since: Date;
  sectionKind?: string;
}): Promise<EditDecisionInput[]> {
  const scope = eq(sectionChangeDecisions.organizationId, input.organizationId);
  const where = input.sectionKind
    ? and(
        scope,
        eq(sectionChangeDecisions.sectionKind, input.sectionKind),
        gte(sectionChangeDecisions.createdAt, input.since),
      )
    : and(scope, gte(sectionChangeDecisions.createdAt, input.since));

  const rows = await db
    .select({
      changeType: sectionChangeDecisions.changeType,
      decision: sectionChangeDecisions.decision,
      text: sectionChangeDecisions.changeText,
      createdAt: sectionChangeDecisions.createdAt,
    })
    .from(sectionChangeDecisions)
    .where(where)
    .orderBy(desc(sectionChangeDecisions.createdAt))
    .limit(SAMPLE_LIMIT);

  return rows
    .filter(
      (r) =>
        (r.changeType === "insert" || r.changeType === "delete") &&
        (r.decision === "accept" || r.decision === "reject"),
    )
    .map((r) => ({
      changeType: r.changeType as "insert" | "delete",
      decision: r.decision as "accept" | "reject",
      text: r.text,
      createdAt: r.createdAt,
    }));
}
