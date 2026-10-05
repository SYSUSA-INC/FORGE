/**
 * BL-AIX Phase 0c — server-side "Auto-draft proposal".
 *
 *   start    → one `section_auto_draft` job per target section, then
 *              start working through them in the background.
 *   pump     → run this proposal's due jobs one after another inside a
 *              time budget. Called on start and by the progress view
 *              while someone is watching, so a run moves quickly; when
 *              nobody is, the jobs cron finishes it.
 *   progress → the newest job per section, for the dialog.
 */
import "server-only";

import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { backgroundJobs, proposalSections, proposals } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { pickAutoDraftTargets, summarizeAutoDraft, type AutoDraftProgress } from "@/lib/auto-draft-logic";
import { runInBackground } from "@/lib/background";
import { enqueueJob, executeJob } from "@/lib/jobs";
import { ensureFeature, FeatureGateError } from "@/lib/subscription-gates";

const KIND = "section_auto_draft" as const;
/** Keep a pump inside the 300-second function limit. */
const PUMP_BUDGET_MS = 230_000;

const forProposal = (organizationId: string, proposalId: string) =>
  and(
    eq(backgroundJobs.organizationId, organizationId),
    eq(backgroundJobs.kind, KIND),
    sql`${backgroundJobs.payload}->>'proposalId' = ${proposalId}`,
  );

export async function startAutoDraft(input: {
  organizationId: string;
  proposalId: string;
  userId: string;
  email?: string | null;
  overwrite: boolean;
  /** Start working in the background right away (tests drive the pump themselves). */
  kick?: boolean;
}): Promise<{ ok: true; queued: number } | { ok: false; error: string }> {
  const { organizationId, proposalId } = input;
  const [proposal] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  if (!proposal) return { ok: false, error: "Proposal not found." };
  try {
    await ensureFeature(organizationId, "aiAutoDraft");
  } catch (err) {
    if (err instanceof FeatureGateError) return { ok: false, error: err.message };
    throw err;
  }

  const sections = await db
    .select({ id: proposalSections.id, wordCount: proposalSections.wordCount })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposal.id))
    .orderBy(asc(proposalSections.ordering));
  const targets = pickAutoDraftTargets(sections, input.overwrite);
  if (targets.length === 0) {
    return { ok: false, error: input.overwrite ? "This proposal has no sections." : "Every section already has text. Tick “Overwrite” to redraft them as suggestions." };
  }

  let queued = 0;
  for (const sectionId of targets) {
    const { reused } = await enqueueJob({
      organizationId,
      kind: KIND,
      resourceId: sectionId,
      payload: { proposalId, overwrite: input.overwrite },
      requestedByUserId: input.userId,
    });
    if (!reused) queued += 1;
  }

  await recordAudit({
    organizationId,
    actor: { userId: input.userId, email: input.email ?? null },
    action: "proposal.auto_draft.start",
    resourceType: "proposal",
    resourceId: proposalId,
    metadata: { sections: targets.length, newlyQueued: queued, overwrite: input.overwrite },
  });

  if (input.kick !== false) runInBackground(`[auto-draft:${proposalId}]`, () => pumpAutoDraft({ organizationId, proposalId }));
  return { ok: true, queued };
}

/**
 * Work through this proposal's due jobs, oldest first, until none are
 * left or the budget is spent. A job another pump or the cron already
 * claimed is skipped by `executeJob`'s conditional claim.
 */
export async function pumpAutoDraft(input: {
  organizationId: string;
  proposalId: string;
  budgetMs?: number;
}): Promise<{ ran: number }> {
  const { organizationId } = input;
  const startedAt = Date.now();
  const budget = input.budgetMs ?? PUMP_BUDGET_MS;
  let ran = 0;
  const tried = new Set<string>();
  while (Date.now() - startedAt < budget) {
    const [next] = await db
      .select({ id: backgroundJobs.id })
      .from(backgroundJobs)
      .where(
        and(
          forProposal(organizationId, input.proposalId),
          eq(backgroundJobs.status, "queued"),
          lte(backgroundJobs.nextAttemptAt, new Date()),
        ),
      )
      .orderBy(asc(backgroundJobs.createdAt))
      .limit(1);
    if (!next || tried.has(next.id)) break;
    tried.add(next.id);
    const res = await executeJob(next.id, organizationId, { viaCron: false });
    if (res.ran) ran += 1;
  }
  return { ran };
}

export async function autoDraftProgress(input: {
  organizationId: string;
  proposalId: string;
}): Promise<AutoDraftProgress & { titles: Record<string, string> }> {
  const rows = await db
    .select({
      resourceId: backgroundJobs.resourceId,
      status: backgroundJobs.status,
      error: backgroundJobs.error,
      payload: backgroundJobs.payload,
      createdAt: backgroundJobs.createdAt,
    })
    .from(backgroundJobs)
    .where(forProposal(input.organizationId, input.proposalId))
    .orderBy(asc(backgroundJobs.createdAt))
    .limit(500);
  const progress = summarizeAutoDraft(rows);
  const ids = progress.sections.map((s) => s.sectionId);
  const titles = ids.length
    ? await db
        .select({ id: proposalSections.id, title: proposalSections.title })
        .from(proposalSections)
        .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
        .where(and(inArray(proposalSections.id, ids), eq(proposals.organizationId, input.organizationId)))
    : [];
  return { ...progress, titles: Object.fromEntries(titles.map((t) => [t.id, t.title])) };
}

/** Keep a watched run moving: start a pump when work is due and none is running. */
export async function continueAutoDraft(input: { organizationId: string; proposalId: string }): Promise<void> {
  const [busy] = await db
    .select({ id: backgroundJobs.id })
    .from(backgroundJobs)
    .where(and(forProposal(input.organizationId, input.proposalId), eq(backgroundJobs.status, "running")))
    .limit(1);
  if (busy) return;
  runInBackground(`[auto-draft:${input.proposalId}]`, () => pumpAutoDraft(input));
}
