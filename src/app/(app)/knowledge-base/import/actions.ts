"use server";

import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  knowledgeArtifacts,
  type KnowledgeArtifactKind,
  type KnowledgeOutcomeLabel,
} from "@/db/schema";
import {
  requireAuth,
  requireCurrentOrg,
  requireOrgAdmin,
} from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { getStorageProvider } from "@/lib/storage";
import { detectFormat, type ExtractFormat } from "@/lib/text-extract";
import {
  classifyArtifactKind,
  CLASSIFY_CONFIDENCE_THRESHOLD,
} from "@/lib/knowledge-classify";
import { hasAnyJob, runDurable } from "@/lib/jobs";
import { claimUpload, finishClaim, inlineBytesForMemoryMode, releaseClaim } from "@/lib/uploads";
import {
  enforceStorageQuota,
  QuotaExceededError,
} from "@/lib/subscription-gates";
import { log } from "@/lib/log";


export type ArtifactUploadResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Map a detected format to a sensible default artifact kind. The user
 * can override on the review screen, and Phase 10c will let the AI
 * propose a better kind based on actual content.
 */
function defaultKindFromFormat(
  format: ExtractFormat | null,
): KnowledgeArtifactKind {
  switch (format) {
    case "image":
      return "image";
    case "xlsx":
      return "spreadsheet";
    case "pptx":
      return "deck";
    case "text":
      return "note";
    default:
      return "other";
  }
}

/**
 * BL-STAB-2e — save a file uploaded straight to storage as a knowledge
 * artifact. The upload ledger's claim fixes the artifact's id, so a retry
 * returns the same artifact; the storage limit is checked before anything
 * is saved; the text is read by a durable job (retried by the jobs cron),
 * queued before the claim is finished. The page passes the batch's kind,
 * tags and outcome.
 */
export async function createKnowledgeArtifactFromUploadAction(input: {
  uploadId: string;
  kind?: string;
  tags?: string;
  title?: string;
  outcome?: string;
}): Promise<ArtifactUploadResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const claim = await claimUpload({ organizationId, userId: user.id, uploadId: String(input?.uploadId ?? ""), resourceType: "knowledge_artifact" });
  if (!claim.ok) return { ok: false, error: claim.error };
  if ("alreadyClaimed" in claim) return { ok: true, id: claim.resourceId };
  const file = claim.claim;

  // BL-16 Phase B-3c — refuse the file when the tenant is at or over its
  // storage limit. Live-measured from SUM(file_size) so deleting an
  // artifact frees space immediately. The upload stays, ready to retry. A
  // retry whose artifact an earlier attempt already saved is counted
  // already: it isn't checked again.
  const savedBefore =
    claim.rerun &&
    (
      await db
        .select({ id: knowledgeArtifacts.id })
        .from(knowledgeArtifacts)
        .where(and(eq(knowledgeArtifacts.organizationId, organizationId), eq(knowledgeArtifacts.id, file.resourceId)))
        .limit(1)
    ).length > 0;
  try {
    if (!savedBefore) await enforceStorageQuota(organizationId, file.size);
  } catch (err) {
    await releaseClaim({ organizationId, uploadId: file.uploadId, claimedAt: file.claimedAt });
    if (err instanceof QuotaExceededError) return { ok: false, error: err.message };
    throw err;
  }

  const format = detectFormat(file.contentType, file.fileName);
  // BL-AIP-4 — a historical proposal (or debrief) can be labelled won /
  // lost at upload so retrieval's outcome boost has data on day one.
  const rawOutcome = typeof input?.outcome === "string" ? input.outcome.trim() : "";
  const outcomeLabel: KnowledgeOutcomeLabel = isOutcomeLabel(rawOutcome) ? rawOutcome : "none";
  const rawKind = typeof input?.kind === "string" ? input.kind.trim() : "";
  const kind = isValidKind(rawKind) ? (rawKind as KnowledgeArtifactKind) : defaultKindFromFormat(format);
  const tags = (typeof input?.tags === "string" ? input.tags : "")
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 32);
  const title = ((typeof input?.title === "string" && input.title.trim()) || stripExt(file.fileName)).slice(0, 256);

  let created = false;
  try {
    const inserted = await db
      .insert(knowledgeArtifacts)
      .values({
        id: file.resourceId,
        organizationId,
        kind,
        source: "uploaded",
        title,
        tags,
        fileName: file.fileName,
        fileSize: file.size,
        contentType: file.contentType,
        storagePath: file.storageKey,
        status: "uploaded",
        outcomeLabel,
        uploadedByUserId: user.id,
      })
      .onConflictDoNothing()
      .returning({ id: knowledgeArtifacts.id });
    created = inserted.length > 0;
  } catch (err) {
    log.error("[createKnowledgeArtifactFromUploadAction]", "insert failed", { error: err });
    await releaseClaim({ organizationId, uploadId: file.uploadId, claimedAt: file.claimedAt });
    return { ok: false, error: "Could not record the artifact; try again." };
  }

  // BL-10 Phase A — with "Auto-detect", the kind above is the file-type
  // guess; after extraction the classifier may replace it. Queued before
  // the claim is finished (the upload sweep finishes a filing that dies in
  // between); a retry that finds the artifact saved reads it only if it
  // never was.
  const extract = {
    organizationId,
    kind: "knowledge_artifact_extract" as const,
    resourceId: file.resourceId,
    payload: { wasAutoKind: !isValidKind(rawKind) },
    requestedByUserId: user.id,
  };
  if (created || !(await hasAnyJob(extract))) {
    const bytes = await inlineBytesForMemoryMode({ organizationId, storagePath: file.storageKey });
    await runDurable("[createKnowledgeArtifactFromUploadAction] extract", extract, bytes ? { bytes } : {});
  }
  await finishClaim({ organizationId, uploadId: file.uploadId, claimedAt: file.claimedAt });

  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "knowledge_artifact.upload",
    resourceType: "knowledge_artifact",
    resourceId: file.resourceId,
    metadata: { uploadId: file.uploadId, kind, fileName: file.fileName, fileSize: file.size, format, outcomeLabel },
  });

  revalidatePath("/knowledge-base");
  revalidatePath("/knowledge-base/import");
  return { ok: true, id: file.resourceId };
}

export type ListedArtifact = {
  id: string;
  kind: KnowledgeArtifactKind;
  title: string;
  tags: string[];
  fileName: string;
  fileSize: number;
  status: string;
  statusError: string;
  charCount: number;
  uploadedAt: Date;
  archivedAt: Date | null;
  // BL-10 Phase B-1 — AI classifier output. Nullable when classification
  // didn't run (user picked a kind explicitly, or extraction failed).
  aiSuggestedKind: KnowledgeArtifactKind | null;
  aiClassificationConfidence: number | null;
  aiClassificationReasoning: string;
  // BL-AIP-4 — won / lost / … provenance, editable from the row.
  outcomeLabel: KnowledgeOutcomeLabel;
};

export async function listKnowledgeArtifactsAction(): Promise<ListedArtifact[]> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const rows = await db
    .select({
      id: knowledgeArtifacts.id,
      kind: knowledgeArtifacts.kind,
      title: knowledgeArtifacts.title,
      tags: knowledgeArtifacts.tags,
      fileName: knowledgeArtifacts.fileName,
      fileSize: knowledgeArtifacts.fileSize,
      status: knowledgeArtifacts.status,
      statusError: knowledgeArtifacts.statusError,
      rawText: knowledgeArtifacts.rawText,
      uploadedAt: knowledgeArtifacts.createdAt,
      archivedAt: knowledgeArtifacts.archivedAt,
      aiSuggestedKind: knowledgeArtifacts.aiSuggestedKind,
      aiClassificationConfidence: knowledgeArtifacts.aiClassificationConfidence,
      aiClassificationReasoning: knowledgeArtifacts.aiClassificationReasoning,
      outcomeLabel: knowledgeArtifacts.outcomeLabel,
    })
    .from(knowledgeArtifacts)
    .where(eq(knowledgeArtifacts.organizationId, organizationId))
    .orderBy(desc(knowledgeArtifacts.createdAt))
    .limit(500);

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    tags: r.tags ?? [],
    fileName: r.fileName,
    fileSize: r.fileSize,
    status: r.status,
    statusError: r.statusError,
    charCount: r.rawText?.length ?? 0,
    uploadedAt: r.uploadedAt,
    archivedAt: r.archivedAt,
    aiSuggestedKind: r.aiSuggestedKind,
    aiClassificationConfidence: r.aiClassificationConfidence,
    aiClassificationReasoning: r.aiClassificationReasoning,
    outcomeLabel: r.outcomeLabel,
  }));
}

/**
 * BL-AIP-4 — label an artifact's outcome by hand. The only way a new
 * tenant can tell the Brain which of their uploaded past proposals won,
 * which is what the retrieval boost and the win-pattern intelligence
 * learn from.
 */
export async function setArtifactOutcomeAction(
  artifactId: string,
  outcome: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  if (!isOutcomeLabel(outcome)) {
    return { ok: false, error: "Invalid outcome." };
  }

  try {
    const result = await db
      .update(knowledgeArtifacts)
      .set({ outcomeLabel: outcome, updatedAt: new Date() })
      .where(
        and(
          eq(knowledgeArtifacts.id, artifactId),
          eq(knowledgeArtifacts.organizationId, organizationId),
        ),
      )
      .returning({ id: knowledgeArtifacts.id });
    if (result.length === 0) {
      return { ok: false, error: "Artifact not found." };
    }

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "knowledge_artifact.set_outcome",
      resourceType: "knowledge_artifact",
      resourceId: artifactId,
      metadata: { outcome },
    });
    revalidatePath("/knowledge-base/import");
    return { ok: true };
  } catch (err) {
    log.error("[setArtifactOutcomeAction]", "update failed", { error: err, artifactId });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}

const OUTCOME_LABELS: KnowledgeOutcomeLabel[] = ["none", "won", "lost", "no_bid", "withdrawn"];

function isOutcomeLabel(s: string): s is KnowledgeOutcomeLabel {
  return (OUTCOME_LABELS as string[]).includes(s);
}

/**
 * BL-10 Phase B-1 — accept the AI's suggested kind for this artifact.
 *
 * Used when the classifier produced a sub-threshold confidence (so
 * Phase A didn't auto-apply it) but a human reviewing the row agrees
 * with the suggestion. Updates `kind` to match `ai_suggested_kind`.
 * Org-scoped: callers can only accept suggestions on their own
 * artifacts.
 */
export async function acceptKindSuggestionAction(
  artifactId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [row] = await db
    .select({
      id: knowledgeArtifacts.id,
      kind: knowledgeArtifacts.kind,
      suggested: knowledgeArtifacts.aiSuggestedKind,
    })
    .from(knowledgeArtifacts)
    .where(
      and(
        eq(knowledgeArtifacts.id, artifactId),
        eq(knowledgeArtifacts.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!row) return { ok: false, error: "Artifact not found." };
  if (!row.suggested) {
    return { ok: false, error: "No AI suggestion to accept." };
  }
  if (row.suggested === row.kind) {
    return { ok: false, error: "Kind already matches the suggestion." };
  }

  try {
    await db
      .update(knowledgeArtifacts)
      .set({ kind: row.suggested, updatedAt: new Date() })
      .where(
        and(
          eq(knowledgeArtifacts.id, artifactId),
          eq(knowledgeArtifacts.organizationId, organizationId),
        ),
      );
    revalidatePath("/knowledge-base/import");
    return { ok: true };
  } catch (err) {
    log.error("[acceptKindSuggestionAction]", "update failed", {
      error: err,
      artifactId,
    });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}

export async function deleteKnowledgeArtifactAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await db
    .delete(knowledgeArtifacts)
    .where(
      and(
        eq(knowledgeArtifacts.id, id),
        eq(knowledgeArtifacts.organizationId, organizationId),
      ),
    );
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "knowledge_artifact.delete",
    resourceType: "knowledge_artifact",
    resourceId: id,
  });
  revalidatePath("/knowledge-base");
  revalidatePath("/knowledge-base/import");
  return { ok: true };
}

export async function archiveKnowledgeArtifactAction(
  id: string,
  archive: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await db
    .update(knowledgeArtifacts)
    .set({
      archivedAt: archive ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(knowledgeArtifacts.id, id),
        eq(knowledgeArtifacts.organizationId, organizationId),
      ),
    );
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: archive ? "knowledge_artifact.archive" : "knowledge_artifact.unarchive",
    resourceType: "knowledge_artifact",
    resourceId: id,
  });
  revalidatePath("/knowledge-base");
  revalidatePath("/knowledge-base/import");
  return { ok: true };
}

const VALID_KINDS = new Set([
  "proposal",
  "rfp",
  "contract",
  "cpars",
  "debrief",
  "capability_brief",
  "resume",
  "brochure",
  "whitepaper",
  "email",
  "note",
  "image",
  "spreadsheet",
  "deck",
  "other",
]);

function isValidKind(s: string): boolean {
  return VALID_KINDS.has(s);
}

function stripExt(s: string): string {
  return s.replace(/\.[^./]+$/, "");
}

/**
 * Phase 10g: re-run text extraction on an existing artifact.
 *
 * Useful when:
 *   - An image artifact was uploaded before ANTHROPIC_API_KEY was
 *     configured and now needs OCR run against it.
 *   - Vision OCR produced a poor result and the user wants to retry.
 *   - A future format extractor improves and we want to re-process.
 *
 * BL-STAB-2e — checks the file is in storage (without downloading it),
 * then queues the same extraction job an upload runs; a job already open
 * for the artifact is reused. The page shows the result when it lands.
 */
export async function reextractArtifactTextAction(
  artifactId: string,
): Promise<{ ok: true; queued: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [artifact] = await db
    .select()
    .from(knowledgeArtifacts)
    .where(
      and(
        eq(knowledgeArtifacts.id, artifactId),
        eq(knowledgeArtifacts.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!artifact) return { ok: false, error: "Artifact not found." };
  if (!artifact.storagePath) {
    return {
      ok: false,
      error:
        "No file bytes in storage for this artifact. Re-upload the original.",
    };
  }
  const format = detectFormat(artifact.contentType, artifact.fileName);
  if (!format) {
    return {
      ok: false,
      error: "Unrecognized file format. Cannot re-extract.",
    };
  }

  // A storage error is not a missing file: say which it was.
  let head: Awaited<ReturnType<ReturnType<typeof getStorageProvider>["head"]>>;
  try {
    head = await getStorageProvider().head(artifact.storagePath);
  } catch (err) {
    log.warn("[reextractArtifactTextAction]", "storage check failed", { error: err });
    return { ok: false, error: "File storage could not be reached just now. Try Re-extract again in a minute." };
  }
  if (!head) {
    return {
      ok: false,
      error:
        "Storage no longer has the file bytes (likely after a redeploy of the memory-mode stub). Re-upload to retry.",
    };
  }

  const bytes = await inlineBytesForMemoryMode({ organizationId, storagePath: artifact.storagePath });
  await runDurable(
    "[reextractArtifactTextAction] extract",
    { organizationId, kind: "knowledge_artifact_extract", resourceId: artifact.id, payload: { wasAutoKind: false }, requestedByUserId: actor.id },
    bytes ? { bytes } : {},
  );

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "knowledge_artifact.reextract",
    resourceType: "knowledge_artifact",
    resourceId: artifactId,
    metadata: { format },
  });

  revalidatePath(`/knowledge-base/import/${artifactId}`);
  revalidatePath("/knowledge-base/import");
  return { ok: true, queued: true };
}

/**
 * BL-10 Phase B-2 — one-off classifier backfill.
 *
 * For each artifact in the caller's org that has `kind='other'`
 * (the heuristic catch-all) AND has no AI suggestion yet AND has
 * extracted text to classify, runs the classifier and stores the
 * result. High-confidence suggestions (>= threshold) auto-apply
 * `kind`; lower-confidence ones surface in the import UI as
 * accept-able pills (Phase B-1's row UI).
 *
 * Idempotent — skips artifacts that already have an
 * `ai_suggested_kind`. Org admin gate; not superadmin since this
 * is a per-tenant operation. Best-effort per artifact: one failure
 * doesn't block the rest.
 *
 * Returns a summary so the caller can surface "processed N,
 * auto-applied M" in the UI.
 */
export type ClassifyBackfillResult =
  | {
      ok: true;
      processed: number;
      autoApplied: number;
      lowConfidence: number;
      skipped: number;
    }
  | { ok: false; error: string };

/**
 * BL-10 Phase B-2 — count classifier-eligible artifacts.
 *
 * Surfaces a "N candidates" line on the import page so admins know
 * whether the backfill button has work to do. Same predicate the
 * backfill action uses.
 */
export async function countClassifyBackfillCandidatesAction(): Promise<number> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(knowledgeArtifacts)
    .where(
      and(
        eq(knowledgeArtifacts.organizationId, organizationId),
        eq(knowledgeArtifacts.kind, "other"),
        isNull(knowledgeArtifacts.aiSuggestedKind),
        ne(knowledgeArtifacts.rawText, ""),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function runKnowledgeClassificationBackfillAction(): Promise<ClassifyBackfillResult> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const candidates = await db
    .select({
      id: knowledgeArtifacts.id,
      fileName: knowledgeArtifacts.fileName,
      contentType: knowledgeArtifacts.contentType,
      rawText: knowledgeArtifacts.rawText,
    })
    .from(knowledgeArtifacts)
    .where(
      and(
        eq(knowledgeArtifacts.organizationId, organizationId),
        eq(knowledgeArtifacts.kind, "other"),
        isNull(knowledgeArtifacts.aiSuggestedKind),
        ne(knowledgeArtifacts.rawText, ""),
        // Hard upper bound — keeps a single call from running away
        // on enormous corpora. Admin can re-trigger to drain the rest.
        sql`length(${knowledgeArtifacts.rawText}) > 0`,
      ),
    )
    .limit(50);

  let processed = 0;
  let autoApplied = 0;
  let lowConfidence = 0;
  let skipped = 0;

  for (const c of candidates) {
    try {
      const classified = await classifyArtifactKind({
        organizationId,
        fileName: c.fileName,
        contentType: c.contentType,
        rawText: c.rawText,
      });
      if (!classified.ok || classified.stubbed) {
        skipped += 1;
        continue;
      }
      const shouldApply =
        classified.confidence >= CLASSIFY_CONFIDENCE_THRESHOLD;
      await db
        .update(knowledgeArtifacts)
        .set({
          ...(shouldApply ? { kind: classified.kind } : {}),
          aiSuggestedKind: classified.kind,
          aiClassificationConfidence: classified.confidence,
          aiClassificationReasoning: classified.reasoning,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(knowledgeArtifacts.id, c.id),
            eq(knowledgeArtifacts.organizationId, organizationId),
          ),
        );
      processed += 1;
      if (shouldApply) {
        autoApplied += 1;
      } else {
        lowConfidence += 1;
      }
    } catch (err) {
      log.error("[runKnowledgeClassificationBackfill]", "row failed", {
        error: err,
        artifactId: c.id,
        organizationId,
      });
      skipped += 1;
    }
  }

  revalidatePath("/knowledge-base/import");
  return { ok: true, processed, autoApplied, lowConfidence, skipped };
}

// ────────────────────────────────────────────────────────────────────────────
// BL-10 Phase C-2 — manual reclassification + tag management
// ────────────────────────────────────────────────────────────────────────────

/**
 * Set an artifact's `kind` directly. Used by the corpus drag-drop UI
 * when a user drops an artifact card onto a different kind bucket.
 * Org-scoped — callers can only re-kind their own artifacts.
 */
export async function setArtifactKindAction(
  artifactId: string,
  kind: KnowledgeArtifactKind,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  if (!isValidKind(kind)) {
    return { ok: false, error: "Invalid kind." };
  }

  try {
    const result = await db
      .update(knowledgeArtifacts)
      .set({ kind, updatedAt: new Date() })
      .where(
        and(
          eq(knowledgeArtifacts.id, artifactId),
          eq(knowledgeArtifacts.organizationId, organizationId),
        ),
      )
      .returning({ id: knowledgeArtifacts.id });

    if (result.length === 0) {
      return { ok: false, error: "Artifact not found." };
    }

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "knowledge_artifact.set_kind",
      resourceType: "knowledge_artifact",
      resourceId: artifactId,
      metadata: { kind },
    });
    revalidatePath("/knowledge-base/import");
    return { ok: true };
  } catch (err) {
    log.error("[setArtifactKindAction]", "update failed", {
      error: err,
      artifactId,
    });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}

/**
 * Replace an artifact's `tags` array. Trims, lowercases, dedupes, and
 * caps each tag at 64 chars; caps total tag count at 24 so a runaway
 * caller can't pollute the row.
 */
export async function setArtifactTagsAction(
  artifactId: string,
  tags: string[],
): Promise<{ ok: true; tags: string[] } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const cleaned = normalizeTags(tags);

  try {
    const result = await db
      .update(knowledgeArtifacts)
      .set({ tags: cleaned, updatedAt: new Date() })
      .where(
        and(
          eq(knowledgeArtifacts.id, artifactId),
          eq(knowledgeArtifacts.organizationId, organizationId),
        ),
      )
      .returning({ id: knowledgeArtifacts.id });

    if (result.length === 0) {
      return { ok: false, error: "Artifact not found." };
    }

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "knowledge_artifact.set_tags",
      resourceType: "knowledge_artifact",
      resourceId: artifactId,
      metadata: { tagCount: cleaned.length },
    });
    revalidatePath("/knowledge-base/import");
    return { ok: true, tags: cleaned };
  } catch (err) {
    log.error("[setArtifactTagsAction]", "update failed", {
      error: err,
      artifactId,
    });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}

/**
 * Rename a tag across every artifact in the caller's org. Removes the
 * old tag and adds the new one in a single UPDATE per row using array
 * functions so concurrent writes don't corrupt the array.
 */
export async function renameTagAction(
  fromTag: string,
  toTag: string,
): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const oldClean = normalizeTag(fromTag);
  const newClean = normalizeTag(toTag);
  if (!oldClean) return { ok: false, error: "Old tag is empty." };
  if (!newClean) return { ok: false, error: "New tag is empty." };
  if (oldClean === newClean) {
    return { ok: false, error: "Old and new tag are the same." };
  }

  try {
    // array_remove + array_append produces a deterministic result and is
    // race-safe because we filter by `oldClean = ANY(tags)`. If a concurrent
    // write removes oldClean first, this UPDATE just no-ops on that row.
    const result = await db
      .update(knowledgeArtifacts)
      .set({
        tags: sql`(
          SELECT array_agg(DISTINCT t)
          FROM unnest(array_append(array_remove(${knowledgeArtifacts.tags}, ${oldClean}), ${newClean})) AS t
          WHERE t IS NOT NULL AND t <> ''
        )`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(knowledgeArtifacts.organizationId, organizationId),
          sql`${oldClean} = ANY(${knowledgeArtifacts.tags})`,
        ),
      )
      .returning({ id: knowledgeArtifacts.id });

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "knowledge_artifact.rename_tag",
      resourceType: "knowledge_artifact_tag",
      resourceId: oldClean,
      metadata: { from: oldClean, to: newClean, affectedRows: result.length },
    });
    revalidatePath("/knowledge-base/import");
    return { ok: true, updated: result.length };
  } catch (err) {
    log.error("[renameTagAction]", "rename failed", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Rename failed.",
    };
  }
}

/**
 * Remove a tag from every artifact in the caller's org. Used by the
 * tag-management surface; idempotent.
 */
export async function deleteTagAction(
  tag: string,
): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const clean = normalizeTag(tag);
  if (!clean) return { ok: false, error: "Tag is empty." };

  try {
    const result = await db
      .update(knowledgeArtifacts)
      .set({
        tags: sql`array_remove(${knowledgeArtifacts.tags}, ${clean})`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(knowledgeArtifacts.organizationId, organizationId),
          sql`${clean} = ANY(${knowledgeArtifacts.tags})`,
        ),
      )
      .returning({ id: knowledgeArtifacts.id });

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "knowledge_artifact.delete_tag",
      resourceType: "knowledge_artifact_tag",
      resourceId: clean,
      metadata: { tag: clean, affectedRows: result.length },
    });
    revalidatePath("/knowledge-base/import");
    return { ok: true, updated: result.length };
  } catch (err) {
    log.error("[deleteTagAction]", "delete failed", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Delete failed.",
    };
  }
}

/**
 * List every distinct tag used across the caller's org's artifacts,
 * with usage counts. Powers the tag-management surface.
 */
export async function listTagUsageAction(): Promise<
  Array<{ tag: string; count: number }>
> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const rows = await db
    .select({
      tag: sql<string>`t`,
      count: sql<number>`count(*)::int`,
    })
    .from(knowledgeArtifacts)
    .innerJoin(
      sql`unnest(${knowledgeArtifacts.tags}) AS t`,
      sql`true`,
    )
    .where(eq(knowledgeArtifacts.organizationId, organizationId))
    .groupBy(sql`t`)
    .orderBy(sql`count(*) desc, t asc`);

  return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
}

const MAX_TAG_LENGTH = 64;
const MAX_TAGS_PER_ARTIFACT = 24;

/** Normalize a single tag: trim, collapse whitespace, lowercase, length-cap. */
function normalizeTag(raw: string): string {
  return (raw ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, MAX_TAG_LENGTH);
}

/** Normalize + dedupe + cap an incoming tag array. */
function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw ?? []) {
    const n = normalizeTag(t);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= MAX_TAGS_PER_ARTIFACT) break;
  }
  return out;
}
