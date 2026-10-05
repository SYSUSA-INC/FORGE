"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { proposalSections, proposals } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { autoDraftProgress, continueAutoDraft, startAutoDraft } from "@/lib/auto-draft";
import { EMPTY_WORD_THRESHOLD, type AutoDraftProgress } from "@/lib/auto-draft-logic";

/**
 * Phase 14e — list every section in a proposal so the client
 * orchestrator knows what to draft and which are already fleshed out.
 *
 * "Empty" here means word count below a threshold — sections seeded
 * with placeholder text from the lifecycle template count as empty.
 */
export type AutoDraftSection = {
  id: string;
  title: string;
  kind: string;
  ordering: number;
  wordCount: number;
  isEmpty: boolean;
  status: string;
};

export async function listSectionsForAutoDraftAction(
  proposalId: string,
): Promise<
  | { ok: true; sections: AutoDraftSection[] }
  | { ok: false; error: string }
> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const [p] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(
      and(
        eq(proposals.id, proposalId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!p) return { ok: false, error: "Proposal not found." };

  const rows = await db
    .select({
      id: proposalSections.id,
      title: proposalSections.title,
      kind: proposalSections.kind,
      ordering: proposalSections.ordering,
      wordCount: proposalSections.wordCount,
      status: proposalSections.status,
    })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId))
    .orderBy(asc(proposalSections.ordering));

  return {
    ok: true,
    sections: rows.map((r) => ({
      id: r.id,
      title: r.title,
      kind: r.kind,
      ordering: r.ordering,
      wordCount: r.wordCount,
      isEmpty: r.wordCount < EMPTY_WORD_THRESHOLD,
      status: r.status,
    })),
  };
}

/**
 * BL-AIX Phase 0c — start a server-side auto-draft of this proposal. Each
 * target section becomes a durable job; closing the dialog no longer
 * stops the run.
 */
export async function startAutoDraftAction(input: {
  proposalId: string;
  overwrite?: boolean;
}): Promise<{ ok: true; queued: number } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await startAutoDraft({
    organizationId,
    proposalId: input.proposalId,
    userId: user.id,
    email: user.email,
    overwrite: !!input.overwrite,
  });
  if (res.ok) revalidatePath(`/proposals/${input.proposalId}/sections`);
  return res;
}

/**
 * The run's progress, newest job per section. While anything is queued
 * this also keeps the run moving, so a watched run finishes quickly; an
 * unwatched one is finished by the jobs cron.
 */
export async function autoDraftProgressAction(
  proposalId: string,
): Promise<{ ok: true; progress: AutoDraftProgress & { titles: Record<string, string> } } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const [p] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  if (!p) return { ok: false, error: "Proposal not found." };
  const progress = await autoDraftProgress({ organizationId, proposalId });
  if (progress.queued > 0) await continueAutoDraft({ organizationId, proposalId });
  return { ok: true, progress };
}
