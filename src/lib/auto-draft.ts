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

import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { backgroundJobs, proposalSections, proposals } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { pickAutoDraftTargets, summarizeAutoDraft, type AutoDraftProgress } from "@/lib/auto-draft-logic";
import { runInBackground } from "@/lib/background";
import { enqueueJob, executeJob } from "@/lib/jobs";
import { ensureFeature, FeatureGateError } from "@/lib/subscription-gates";

const KIND = "section_auto_draft" as const;
/** BL-NAV-LIFECYCLE 5b — the research step that runs before the section drafts. */
const RESEARCH_KIND = "proposal_research" as const;
/** Keep a pump inside the 300-second function limit. */
const PUMP_BUDGET_MS = 230_000;

/** The proposal's section drafts and its research step: the pump runs both, oldest first, so research goes first. */
const pumpableForProposal = (organizationId: string, proposalId: string) =>
  and(
    eq(backgroundJobs.organizationId, organizationId),
    inArray(backgroundJobs.kind, [KIND, RESEARCH_KIND]),
    sql`${backgroundJobs.payload}->>'proposalId' = ${proposalId}`,
  );

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

  // BL-NAV-LIFECYCLE 5b — research first, when the organization has it on and
  // the allowance can pay for it. It is queued before the sections, so the
  // pump runs it first; a run that cannot search is a finished job with a note,
  // and the drafts go ahead on the company's own records.
  const research = await researchCanRun(organizationId);
  if (research) {
    await enqueueJob({
      organizationId,
      kind: RESEARCH_KIND,
      resourceId: proposalId,
      payload: { proposalId },
      requestedByUserId: input.userId,
    });
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
    metadata: { sections: targets.length, newlyQueued: queued, overwrite: input.overwrite, research },
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
          pumpableForProposal(organizationId, input.proposalId),
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
/** Whether a research step is worth queueing: switched on, the Anthropic provider active, allowance left. */
async function researchCanRun(organizationId: string): Promise<boolean> {
  const [{ getResearchSettings }, { getWebSearchAllowance }, { getAIProviderStatus }] = await Promise.all([
    import("@/lib/research-store"),
    import("@/lib/subscription-gates"),
    import("@/lib/ai"),
  ]);
  const settings = await getResearchSettings(organizationId);
  if (!settings.enabled || getAIProviderStatus().active.name !== "anthropic") return false;
  return (await getWebSearchAllowance(organizationId)).remaining > 0;
}

/** The newest research step of a proposal: how it stands and what it did or why it did not. */
export async function researchProgress(input: { organizationId: string; proposalId: string }): Promise<{
  status: "queued" | "running" | "done" | "failed";
  note: string;
  searches: number;
  sources: number;
} | null> {
  const [row] = await db
    .select({ status: backgroundJobs.status, error: backgroundJobs.error, payload: backgroundJobs.payload })
    .from(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.organizationId, input.organizationId),
        eq(backgroundJobs.kind, RESEARCH_KIND),
        sql`${backgroundJobs.payload}->>'proposalId' = ${input.proposalId}`,
      ),
    )
    .orderBy(desc(backgroundJobs.createdAt))
    .limit(1);
  if (!row) return null;
  const p = row.payload as Record<string, unknown>;
  return {
    status: row.status,
    note: row.status === "failed" ? row.error : typeof p.skipped === "string" ? p.skipped : "",
    searches: typeof p.searches === "number" ? p.searches : 0,
    sources: typeof p.sources === "number" ? p.sources : 0,
  };
}

/** Whether the proposal's research step has yet to finish (queued, or running within the stuck window). */
export async function researchPending(organizationId: string, proposalId: string): Promise<boolean> {
  const p = await researchProgress({ organizationId, proposalId });
  return p !== null && (p.status === "queued" || p.status === "running");
}

export async function continueAutoDraft(input: { organizationId: string; proposalId: string }): Promise<void> {
  const [busy] = await db
    .select({ id: backgroundJobs.id })
    .from(backgroundJobs)
    .where(and(forProposal(input.organizationId, input.proposalId), eq(backgroundJobs.status, "running")))
    .limit(1);
  if (busy) return;
  runInBackground(`[auto-draft:${input.proposalId}]`, () => pumpAutoDraft(input));
}
