"use server";

/**
 * BL-9 Slice 5b — server actions for proposal-section version snapshots.
 *
 * Three operations live on this surface:
 *   - `createSectionSnapshotAction` — captures the current `body_doc`
 *     into a new row. `kind: "manual"` for the toolbar button;
 *     `kind: "auto"` reserved for the stage-transition checkpoint
 *     fired by `saveSectionAction` when status crosses a milestone.
 *   - `listSectionSnapshotsAction` — newest-first list for the
 *     snapshots sidebar.
 *   - `restoreSectionSnapshotAction` — overwrites the section's
 *     current body_doc with the snapshot's. Before doing so, it
 *     creates a fresh `auto`-kind snapshot of the CURRENT state so
 *     the restore is itself reversible.
 *   - `deleteSectionSnapshotAction` — removes a single snapshot.
 *     Useful when an accidental snapshot needs cleaning up.
 *
 * All paths require auth, org-scope, ownership of the parent
 * proposal, and audit the action.
 */

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  proposalSectionSnapshots,
  proposalSections,
  proposals,
  type ProposalSectionSnapshotKind,
  type TipTapDoc,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import {
  countWords as countTipTapWords,
  projectToPlain,
} from "@/lib/tiptap-doc";
import { log } from "@/lib/log";

const LABEL_MAX = 120;

/** Bounded snapshot row returned to the client (drops body_doc bulk). */
export type SectionSnapshotSummary = {
  id: string;
  kind: ProposalSectionSnapshotKind;
  label: string;
  wordCount: number;
  createdAt: string;
  createdByUserId: string | null;
  createdByName: string;
};

async function loadOwnedSection(input: {
  proposalId: string;
  sectionId: string;
  organizationId: string;
}): Promise<{ id: string; bodyDoc: TipTapDoc } | null> {
  const [row] = await db
    .select({
      id: proposalSections.id,
      bodyDoc: proposalSections.bodyDoc,
    })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .where(
      and(
        eq(proposalSections.id, input.sectionId),
        eq(proposalSections.proposalId, input.proposalId),
        eq(proposals.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createSectionSnapshotAction(input: {
  proposalId: string;
  sectionId: string;
  label?: string;
  kind?: ProposalSectionSnapshotKind;
}): Promise<{ ok: true; snapshotId: string } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const section = await loadOwnedSection({
    proposalId: input.proposalId,
    sectionId: input.sectionId,
    organizationId,
  });
  if (!section) return { ok: false, error: "Section not found." };

  const label = (input.label ?? "").trim().slice(0, LABEL_MAX);
  const kind: ProposalSectionSnapshotKind = input.kind ?? "manual";
  const wordCount = countTipTapWords(section.bodyDoc);

  try {
    const [row] = await db
      .insert(proposalSectionSnapshots)
      .values({
        organizationId,
        proposalSectionId: section.id,
        proposalId: input.proposalId,
        kind,
        label,
        bodyDoc: section.bodyDoc,
        wordCount,
        createdByUserId: actor.id,
        createdByNameSnapshot: actor.name ?? actor.email ?? "",
      })
      .returning({ id: proposalSectionSnapshots.id });
    if (!row) return { ok: false, error: "Snapshot insert failed." };

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "proposal_section.snapshot_create",
      resourceType: "proposal_section",
      resourceId: input.sectionId,
      metadata: { snapshotId: row.id, kind, label, wordCount },
    });
    revalidatePath(`/proposals/${input.proposalId}/sections`);
    return { ok: true, snapshotId: row.id };
  } catch (err) {
    log.error("[createSectionSnapshotAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Snapshot failed.",
    };
  }
}

export async function listSectionSnapshotsAction(input: {
  proposalId: string;
  sectionId: string;
}): Promise<
  | { ok: true; snapshots: SectionSnapshotSummary[] }
  | { ok: false; error: string }
> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const section = await loadOwnedSection({
    proposalId: input.proposalId,
    sectionId: input.sectionId,
    organizationId,
  });
  if (!section) return { ok: false, error: "Section not found." };

  const rows = await db
    .select({
      id: proposalSectionSnapshots.id,
      kind: proposalSectionSnapshots.kind,
      label: proposalSectionSnapshots.label,
      wordCount: proposalSectionSnapshots.wordCount,
      createdAt: proposalSectionSnapshots.createdAt,
      createdByUserId: proposalSectionSnapshots.createdByUserId,
      createdByNameSnapshot: proposalSectionSnapshots.createdByNameSnapshot,
    })
    .from(proposalSectionSnapshots)
    .where(
      and(
        eq(proposalSectionSnapshots.proposalSectionId, section.id),
        eq(proposalSectionSnapshots.organizationId, organizationId),
      ),
    )
    .orderBy(desc(proposalSectionSnapshots.createdAt));

  const snapshots: SectionSnapshotSummary[] = rows.map((r) => ({
    id: r.id,
    kind: (r.kind === "auto" ? "auto" : "manual") as ProposalSectionSnapshotKind,
    label: r.label,
    wordCount: r.wordCount,
    createdAt: r.createdAt.toISOString(),
    createdByUserId: r.createdByUserId,
    createdByName: r.createdByNameSnapshot,
  }));
  return { ok: true, snapshots };
}

/**
 * BL-9 Slice 5c — fetch a single snapshot's full body for the diff
 * viewer. The list action above drops body_doc to keep payloads
 * small; this action returns it for exactly one snapshot at a time.
 */
export async function getSectionSnapshotBodyAction(input: {
  proposalId: string;
  sectionId: string;
  snapshotId: string;
}): Promise<
  | {
      ok: true;
      bodyDoc: TipTapDoc;
      meta: SectionSnapshotSummary;
    }
  | { ok: false; error: string }
> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const section = await loadOwnedSection({
    proposalId: input.proposalId,
    sectionId: input.sectionId,
    organizationId,
  });
  if (!section) return { ok: false, error: "Section not found." };

  const [row] = await db
    .select({
      id: proposalSectionSnapshots.id,
      kind: proposalSectionSnapshots.kind,
      label: proposalSectionSnapshots.label,
      bodyDoc: proposalSectionSnapshots.bodyDoc,
      wordCount: proposalSectionSnapshots.wordCount,
      createdAt: proposalSectionSnapshots.createdAt,
      createdByUserId: proposalSectionSnapshots.createdByUserId,
      createdByNameSnapshot: proposalSectionSnapshots.createdByNameSnapshot,
    })
    .from(proposalSectionSnapshots)
    .where(
      and(
        eq(proposalSectionSnapshots.id, input.snapshotId),
        eq(proposalSectionSnapshots.proposalSectionId, section.id),
        eq(proposalSectionSnapshots.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Snapshot not found." };

  return {
    ok: true,
    bodyDoc: row.bodyDoc,
    meta: {
      id: row.id,
      kind: (row.kind === "auto" ? "auto" : "manual") as ProposalSectionSnapshotKind,
      label: row.label,
      wordCount: row.wordCount,
      createdAt: row.createdAt.toISOString(),
      createdByUserId: row.createdByUserId,
      createdByName: row.createdByNameSnapshot,
    },
  };
}

export async function restoreSectionSnapshotAction(input: {
  proposalId: string;
  sectionId: string;
  snapshotId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const section = await loadOwnedSection({
    proposalId: input.proposalId,
    sectionId: input.sectionId,
    organizationId,
  });
  if (!section) return { ok: false, error: "Section not found." };

  const [snap] = await db
    .select({
      id: proposalSectionSnapshots.id,
      bodyDoc: proposalSectionSnapshots.bodyDoc,
      label: proposalSectionSnapshots.label,
      createdAt: proposalSectionSnapshots.createdAt,
    })
    .from(proposalSectionSnapshots)
    .where(
      and(
        eq(proposalSectionSnapshots.id, input.snapshotId),
        eq(proposalSectionSnapshots.proposalSectionId, section.id),
        eq(proposalSectionSnapshots.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!snap) return { ok: false, error: "Snapshot not found." };

  try {
    // Capture the current state first so the restore is reversible.
    const currentWordCount = countTipTapWords(section.bodyDoc);
    const [preRestore] = await db
      .insert(proposalSectionSnapshots)
      .values({
        organizationId,
        proposalSectionId: section.id,
        proposalId: input.proposalId,
        kind: "auto",
        label: "before restore",
        bodyDoc: section.bodyDoc,
        wordCount: currentWordCount,
        createdByUserId: actor.id,
        createdByNameSnapshot: actor.name ?? actor.email ?? "",
      })
      .returning({ id: proposalSectionSnapshots.id });

    const restoredWordCount = countTipTapWords(snap.bodyDoc);
    const restoredPlain = projectToPlain(snap.bodyDoc);
    await db
      .update(proposalSections)
      .set({
        bodyDoc: snap.bodyDoc,
        content: restoredPlain,
        wordCount: restoredWordCount,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(proposalSections.id, section.id),
          eq(proposalSections.proposalId, input.proposalId),
        ),
      );

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "proposal_section.snapshot_restore",
      resourceType: "proposal_section",
      resourceId: input.sectionId,
      metadata: {
        snapshotId: snap.id,
        snapshotLabel: snap.label,
        snapshotCreatedAt: snap.createdAt.toISOString(),
        preRestoreSnapshotId: preRestore?.id ?? null,
        restoredWordCount,
      },
    });
    revalidatePath(`/proposals/${input.proposalId}/sections`);
    return { ok: true };
  } catch (err) {
    log.error("[restoreSectionSnapshotAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Restore failed.",
    };
  }
}

export async function deleteSectionSnapshotAction(input: {
  proposalId: string;
  sectionId: string;
  snapshotId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const section = await loadOwnedSection({
    proposalId: input.proposalId,
    sectionId: input.sectionId,
    organizationId,
  });
  if (!section) return { ok: false, error: "Section not found." };

  const result = await db
    .delete(proposalSectionSnapshots)
    .where(
      and(
        eq(proposalSectionSnapshots.id, input.snapshotId),
        eq(proposalSectionSnapshots.proposalSectionId, section.id),
        eq(proposalSectionSnapshots.organizationId, organizationId),
      ),
    )
    .returning({ id: proposalSectionSnapshots.id });
  if (result.length === 0) {
    return { ok: false, error: "Snapshot not found." };
  }

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "proposal_section.snapshot_delete",
    resourceType: "proposal_section",
    resourceId: input.sectionId,
    metadata: { snapshotId: input.snapshotId },
  });
  revalidatePath(`/proposals/${input.proposalId}/sections`);
  return { ok: true };
}

