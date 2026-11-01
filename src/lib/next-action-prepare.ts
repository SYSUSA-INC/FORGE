import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, opportunityNextActions, proposalSections, proposals } from "@/db/schema";
import { getAIProviderStatus } from "@/lib/ai";
import { prepareAheadEnabled } from "@/lib/ai-engine-control";
import { recordAudit } from "@/lib/audit-log";
import { withTruncationNote } from "@/lib/auto-draft-logic";
import { buildCapabilityQuestions, suggestCapabilityAnswers } from "@/lib/capability-matrix-build";
import { autoMapAndApply } from "@/lib/compliance-automap";
import { log } from "@/lib/log";
import { PREPARABLE_KINDS, PREPARE_DRAFTS_PER_NIGHT, type NextActionPriority, type PreparedRecord } from "@/lib/next-actions";
import { bootstrapProposal } from "@/lib/proposal-bootstrap";
import { markScanDirty } from "@/lib/proposal-scan-dirty";
import { enforceRateLimit } from "@/lib/rate-limit";
import { runSectionDraft } from "@/lib/section-draft-run";
import { ensureFeature } from "@/lib/subscription-gates";
import { countWords, EMPTY_DOC, projectToPlain } from "@/lib/tiptap-doc";
import { applyAsTrackedChanges, FORGE_AI_AUTHOR } from "@/lib/tracked-diff";

/**
 * BL-NEXT-ACTION phase 5c — the nightly prepare step. For an open action
 * FORGE can do itself, do it and mark the row prepared, so the person
 * reviews instead of starting from nothing. Nothing prepared changes a
 * decision, a stage, a status or a submission:
 *   - the outline from Section L lands as sections with no text;
 *   - the questionnaire lands with suggested answers nobody confirmed;
 *   - compliance auto-map applies only high-confidence mappings (as the
 *     seeding path does) and the person checks the matrix;
 *   - section drafts land as FORGE AI tracked insertions on an empty
 *     section whose status stays Not started until someone accepts;
 *   - the health scan is queued for the scan cron.
 * Gated per organisation by the Prepare ahead switch and `aiAutoDraft`;
 * each AI call still goes through its own quota gate. One of each kind
 * per pursuit per night, six section drafts per organisation per night.
 */
const FORGE_ACTOR = { userId: null, email: "forge-prepare" };
const DAY_SECONDS = 86_400;
const PRIORITY_RANK: Record<NextActionPriority, number> = { now: 0, this_week: 1, later: 2 };

export type PrepareSummary = { considered: number; prepared: number; skipped: number; errors: number };

export async function prepareNextActions(opts: { limit?: number } = {}): Promise<PrepareSummary> {
  const summary: PrepareSummary = { considered: 0, prepared: 0, skipped: 0, errors: 0 };
  if (getAIProviderStatus().active.name === "stub") return summary;

  const rows = await db
    .select({
      id: opportunityNextActions.id,
      organizationId: opportunityNextActions.organizationId,
      opportunityId: opportunityNextActions.opportunityId,
      proposalId: opportunityNextActions.proposalId,
      kind: opportunityNextActions.kind,
      priority: opportunityNextActions.priority,
      dueBy: opportunityNextActions.dueBy,
    })
    .from(opportunityNextActions)
    .innerJoin(opportunities, eq(opportunities.id, opportunityNextActions.opportunityId))
    .where(and(eq(opportunityNextActions.status, "proposed"), inArray(opportunityNextActions.kind, [...PREPARABLE_KINDS])))
    .orderBy(desc(opportunityNextActions.updatedAt))
    .limit(opts.limit ?? 200);
  rows.sort((a, b) => PRIORITY_RANK[a.priority as NextActionPriority] - PRIORITY_RANK[b.priority as NextActionPriority] || (a.dueBy?.getTime() ?? Infinity) - (b.dueBy?.getTime() ?? Infinity));
  summary.considered = rows.length;

  const enabledByOrg = new Map<string, boolean>();
  for (const row of rows) {
    try {
      let enabled = enabledByOrg.get(row.organizationId);
      if (enabled === undefined) {
        enabled = await prepareAheadEnabled(row.organizationId);
        if (enabled) enabled = await ensureFeature(row.organizationId, "aiAutoDraft").then(() => true, () => false);
        enabledByOrg.set(row.organizationId, enabled);
      }
      if (!enabled) {
        summary.skipped += 1;
        continue;
      }
      // One attempt of each kind per pursuit per night.
      const once = await enforceRateLimit({ key: `next-action-prepare:${row.kind}:${row.opportunityId}`, limit: 1, windowSeconds: DAY_SECONDS });
      if (!once.ok) {
        summary.skipped += 1;
        continue;
      }
      const prepared = await prepareOne(row);
      if (!prepared) {
        summary.skipped += 1;
        continue;
      }
      const now = new Date();
      await db
        .update(opportunityNextActions)
        .set({ status: "prepared", prepared, updatedAt: now })
        .where(and(eq(opportunityNextActions.organizationId, row.organizationId), eq(opportunityNextActions.id, row.id)));
      await recordAudit({
        organizationId: row.organizationId,
        actor: FORGE_ACTOR,
        action: "opportunity.next_action.prepare",
        resourceType: "opportunity",
        resourceId: row.opportunityId,
        metadata: { nextActionId: row.id, kind: row.kind, prepared },
      });
      summary.prepared += 1;
    } catch (err) {
      summary.errors += 1;
      log.error("[next-action-prepare]", "prepare failed", { organizationId: row.organizationId, opportunityId: row.opportunityId, kind: row.kind, error: err });
    }
  }
  return summary;
}

type Row = { id: string; organizationId: string; opportunityId: string; proposalId: string | null; kind: string };

async function prepareOne(row: Row): Promise<PreparedRecord | null> {
  const at = new Date().toISOString();
  const { organizationId, opportunityId, proposalId } = row;
  switch (row.kind) {
    case "build_outline": {
      if (!proposalId) return null;
      const res = await bootstrapProposal({ organizationId, proposalId, mode: "create", actor: FORGE_ACTOR });
      if (!res.ok || res.record.stubbed) return null;
      return { kind: "outline", at, sections: res.record.sections.length };
    }
    case "build_questionnaire": {
      const built = await buildCapabilityQuestions({ organizationId, opportunityId, actor: FORGE_ACTOR });
      if (!built.ok) return null;
      const suggested = await suggestCapabilityAnswers({ organizationId, opportunityId, actor: FORGE_ACTOR }).catch(() => null);
      return { kind: "questionnaire", at, questions: built.questions, suggested: suggested && suggested.ok ? suggested.suggested : 0 };
    }
    case "map_compliance": {
      if (!proposalId) return null;
      const res = await autoMapAndApply({ organizationId, proposalId, actor: { id: null, email: FORGE_ACTOR.email } });
      if (!res.ok || res.stubbed) return null;
      return { kind: "compliance", at, applied: res.applied };
    }
    case "draft_sections":
      return proposalId ? prepareDrafts(organizationId, proposalId, at) : null;
    case "run_health_scan": {
      if (!proposalId) return null;
      await markScanDirty(proposalId, organizationId);
      return { kind: "scan", at };
    }
    default:
      return null;
  }
}

/** Draft the not-started sections, oldest ordering first, within the organisation's nightly cap. */
async function prepareDrafts(organizationId: string, proposalId: string, at: string): Promise<PreparedRecord | null> {
  const sections = await db
    .select({ id: proposalSections.id, wordCount: proposalSections.wordCount })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .where(and(eq(proposalSections.proposalId, proposalId), eq(proposals.organizationId, organizationId), eq(proposalSections.status, "not_started")))
    .orderBy(asc(proposalSections.ordering));
  const sectionIds: string[] = [];
  let truncated = 0;
  for (const s of sections) {
    // Someone already put words there (or an earlier night did): leave it.
    if (s.wordCount > 0) continue;
    const cap = await enforceRateLimit({ key: `next-action-prepare-drafts:${organizationId}`, limit: PREPARE_DRAFTS_PER_NIGHT, windowSeconds: DAY_SECONDS });
    if (!cap.ok) break;
    const draft = await runSectionDraft({ organizationId, userId: FORGE_AI_AUTHOR.id, sectionId: s.id, mode: "draft", cite: true });
    if (!draft.ok) {
      if (draft.code === "gated") break;
      continue;
    }
    if (draft.stubbed) break;
    const text = withTruncationNote(draft.text, !!draft.truncated);
    const doc = applyAsTrackedChanges({ doc: EMPTY_DOC, proposedText: text }).doc;
    await db
      .update(proposalSections)
      .set({ bodyDoc: doc, content: projectToPlain(doc), wordCount: countWords(doc), updatedAt: new Date() })
      .where(and(eq(proposalSections.id, s.id), eq(proposalSections.proposalId, proposalId)));
    await recordAudit({
      organizationId,
      actor: FORGE_ACTOR,
      action: "proposal.section.prepared_draft",
      resourceType: "proposal_section",
      resourceId: s.id,
      metadata: { proposalId, wordCount: countWords(doc), provider: draft.provider, model: draft.model, truncated: !!draft.truncated, trackedChanges: true },
    });
    sectionIds.push(s.id);
    if (draft.truncated) truncated += 1;
  }
  if (sectionIds.length === 0) return null;
  await markScanDirty(proposalId, organizationId);
  return { kind: "drafts", at, sections: sectionIds.length, sectionIds, truncated };
}
