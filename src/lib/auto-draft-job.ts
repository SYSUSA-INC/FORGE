/**
 * BL-AIX Phase 0c — the `section_auto_draft` job handler: draft one
 * section on the server and write it back safely.
 *
 * What the old browser loop did not do, and this does:
 *   - keeps going when the page that started it closes (durable job,
 *     retried with backoff, recovered by the jobs cron);
 *   - never writes stub-mode text into a section;
 *   - snapshots a section that already has text, then lands the draft
 *     as FORGE AI tracked changes on top of it instead of replacing it;
 *   - marks a draft cut off at the output limit so nobody mistakes it
 *     for finished;
 *   - flags the proposal for a background health scan.
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { backgroundJobs, proposalSectionSnapshots, proposalSections, proposals, type BackgroundJob, type TipTapDoc } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { EMPTY_WORD_THRESHOLD, withTruncationNote } from "@/lib/auto-draft-logic";
import { JobPermanentError } from "@/lib/jobs-policy";
import { markScanDirty } from "@/lib/proposal-scan-dirty";
import { enforceRateLimit } from "@/lib/rate-limit";
import { runSectionDraft } from "@/lib/section-draft-run";
import { countWords, fromPlainText, projectToPlain, validateDoc } from "@/lib/tiptap-doc";
import { applyAsTrackedChanges, FORGE_AI_AUTHOR } from "@/lib/tracked-diff";

/** Per-organisation ceiling on AI drafts a day, shared with the interactive draft path's org bucket. */
const ORG_DRAFTS_PER_DAY = 200;

export async function handleSectionAutoDraft(job: BackgroundJob): Promise<void> {
  const organizationId = job.organizationId;
  const proposalId = typeof job.payload.proposalId === "string" ? job.payload.proposalId : "";
  const overwrite = job.payload.overwrite === true;

  const [section] = await db
    .select({
      id: proposalSections.id,
      title: proposalSections.title,
      wordCount: proposalSections.wordCount,
      bodyDoc: proposalSections.bodyDoc,
      content: proposalSections.content,
    })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .where(
      and(
        eq(proposalSections.id, job.resourceId),
        eq(proposalSections.proposalId, proposalId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!section) throw new JobPermanentError("Section no longer exists.");

  const recordOutcome = (extra: Record<string, unknown>) =>
    db
      .update(backgroundJobs)
      .set({ payload: { ...job.payload, ...extra }, updatedAt: new Date() })
      .where(and(eq(backgroundJobs.id, job.id), eq(backgroundJobs.organizationId, organizationId)));

  // Someone wrote this section after the run was queued: leave it alone.
  if (!overwrite && section.wordCount >= EMPTY_WORD_THRESHOLD) {
    await recordOutcome({ skipped: "Already has text — skipped." });
    return;
  }

  const limit = await enforceRateLimit({ key: `ai-draft:org:${organizationId}`, limit: ORG_DRAFTS_PER_DAY, windowSeconds: 86_400 });
  if (!limit.ok) throw new JobPermanentError(`Your organization reached its daily AI draft limit (${ORG_DRAFTS_PER_DAY}). Run auto-draft again tomorrow.`);

  const draft = await runSectionDraft({
    organizationId,
    userId: job.requestedByUserId ?? FORGE_AI_AUTHOR.id,
    sectionId: section.id,
    mode: "draft",
    cite: true,
  });
  if (!draft.ok) {
    if (draft.code === "gated" || draft.code === "invalid") throw new JobPermanentError(draft.error);
    throw new Error(draft.error);
  }
  if (draft.stubbed) throw new JobPermanentError("AI is in stub mode, so nothing was written. Configure a provider and run auto-draft again.");

  const text = withTruncationNote(draft.text, !!draft.truncated);
  const existing = (validateDoc(section.bodyDoc) ?? (section.content ? fromPlainText(section.content) : null)) as TipTapDoc | null;
  const hasText = section.wordCount > 0 && existing !== null;

  if (hasText) {
    await db.insert(proposalSectionSnapshots).values({
      organizationId,
      proposalSectionId: section.id,
      proposalId,
      kind: "auto",
      label: "Before auto-draft",
      bodyDoc: existing,
      wordCount: section.wordCount,
      createdByUserId: job.requestedByUserId,
      createdByNameSnapshot: "Auto-draft",
    });
  }

  // Over existing text the draft arrives as FORGE AI suggestions to accept or reject.
  const doc = hasText ? applyAsTrackedChanges({ doc: existing!, proposedText: text }).doc : fromPlainText(text);
  const wordCount = countWords(doc);
  await db
    .update(proposalSections)
    .set({ bodyDoc: doc, content: projectToPlain(doc), wordCount, status: "in_progress", updatedAt: new Date() })
    .where(and(eq(proposalSections.id, section.id), eq(proposalSections.proposalId, proposalId)));

  await markScanDirty(proposalId, organizationId);
  await recordOutcome({ truncated: !!draft.truncated, tracked: hasText, wordCount });
  await recordAudit({
    organizationId,
    actor: { userId: job.requestedByUserId, email: null },
    action: "proposal.section.auto_draft",
    resourceType: "proposal_section",
    resourceId: section.id,
    metadata: {
      proposalId,
      jobId: job.id,
      wordCount,
      provider: draft.provider,
      model: draft.model,
      truncated: !!draft.truncated,
      trackedChanges: hasText,
      overwrite,
    },
  });
}
