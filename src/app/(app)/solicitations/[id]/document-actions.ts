"use server";

import { and, asc, eq } from "drizzle-orm";
import { describeCoverage } from "@/lib/extraction-coverage";
import { hasLm, type LmStructure } from "@/lib/solicitation-lm";
import { activeRequirements, type ReviewedRequirement } from "@/lib/requirement-review";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  solicitationDocuments,
  solicitations,
  type SolicitationDocumentType,
} from "@/db/schema";
import { mergeSolicitationRequirements } from "@/lib/solicitation-requirements";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { getStorageProvider } from "@/lib/storage";
import { isCompanionDocumentType } from "@/lib/document-type-name";
import { claimUpload, finishClaim, inlineBytesForMemoryMode, releaseClaim } from "@/lib/uploads";
import { runInBackground } from "@/lib/background";
import { runDurable } from "@/lib/jobs";
import { log } from "@/lib/log";

// BL-AIP-4c — the parse pipeline itself lives in
// src/lib/solicitation-document-parse.ts so the jobs cron can re-run it.

export type SolicitationDocumentRow = {
  id: string;
  solicitationId: string;
  documentType: SolicitationDocumentType;
  fileName: string;
  fileSize: number;
  parseStatus: string;
  parseError: string;
  requirementCount: number;
  /** BL-AIX Phase 0d — what the parse didn't read; null when read in full. */
  coverageWarnings: string[] | null;
  /** BL-AIX Phase 2b — the document's Sections L and M, when it has them. */
  lm: LmStructure | null;
  sortOrder: number;
  createdAt: string;
};

export type AddDocumentResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

// ────────────────────────────────────────────────────────────────────────────
// List
// ────────────────────────────────────────────────────────────────────────────

export async function listSolicitationDocumentsAction(
  solicitationId: string,
): Promise<SolicitationDocumentRow[]> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [parentRow] = await db
    .select({ id: solicitations.id })
    .from(solicitations)
    .where(
      and(
        eq(solicitations.id, solicitationId),
        eq(solicitations.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!parentRow) return [];

  const rows = await db
    .select({
      id: solicitationDocuments.id,
      solicitationId: solicitationDocuments.solicitationId,
      documentType: solicitationDocuments.documentType,
      fileName: solicitationDocuments.fileName,
      fileSize: solicitationDocuments.fileSize,
      parseStatus: solicitationDocuments.parseStatus,
      parseError: solicitationDocuments.parseError,
      extractedRequirements: solicitationDocuments.extractedRequirements,
      extractionCoverage: solicitationDocuments.extractionCoverage,
      lmStructure: solicitationDocuments.lmStructure,
      sortOrder: solicitationDocuments.sortOrder,
      createdAt: solicitationDocuments.createdAt,
    })
    .from(solicitationDocuments)
    .where(
      and(
        eq(solicitationDocuments.solicitationId, solicitationId),
        eq(solicitationDocuments.organizationId, organizationId),
      ),
    )
    .orderBy(
      asc(solicitationDocuments.sortOrder),
      asc(solicitationDocuments.createdAt),
    );

  return rows.map((r) => ({
    id: r.id,
    solicitationId: r.solicitationId,
    documentType: r.documentType,
    fileName: r.fileName,
    fileSize: r.fileSize,
    parseStatus: r.parseStatus,
    parseError: r.parseError,
    requirementCount: (r.extractedRequirements ?? []).length,
    coverageWarnings: describeCoverage(r.extractionCoverage),
    lm: hasLm(r.lmStructure) ? r.lmStructure : null,
    sortOrder: r.sortOrder,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ────────────────────────────────────────────────────────────────────────────
// Add (from an upload straight to storage, then an async parse)
// ────────────────────────────────────────────────────────────────────────────

/**
 * BL-STAB-2d — file a checked upload as a companion document. The file
 * went from the browser straight to storage (no request-size cap); this
 * claims it once (a retry returns the same document), records the
 * document under its key, and starts the parse, which reads the file
 * from storage. In the in-memory storage mode (development) the parse
 * gets the bytes in hand.
 */
export async function addSolicitationDocumentFromUploadAction(
  solicitationId: string,
  input: { uploadId: string; documentType: string; sortOrder?: number },
): Promise<AddDocumentResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // Verify the parent belongs to this org before the claim, so a wrong
  // parent leaves the upload ready to try again.
  const [parentRow] = await db
    .select({ id: solicitations.id })
    .from(solicitations)
    .where(
      and(
        eq(solicitations.id, solicitationId),
        eq(solicitations.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!parentRow) return { ok: false, error: "Solicitation not found." };

  const documentType: SolicitationDocumentType = isCompanionDocumentType(input?.documentType) ? input.documentType : "other";
  const sortOrder = Number.isSafeInteger(input?.sortOrder) ? Number(input.sortOrder) : 0;

  const claim = await claimUpload({
    organizationId,
    userId: user.id,
    uploadId: String(input?.uploadId ?? ""),
    resourceType: "solicitation_document",
  });
  if (!claim.ok) return { ok: false, error: claim.error };
  if ("alreadyClaimed" in claim) return { ok: true, id: claim.resourceId };
  const file = claim.claim;

  try {
    await db
      .insert(solicitationDocuments)
      .values({
        id: file.resourceId,
        organizationId,
        solicitationId,
        documentType,
        fileName: file.fileName,
        fileSize: file.size,
        contentType: file.contentType,
        storagePath: file.storageKey,
        parseStatus: "uploaded",
        uploadedByUserId: user.id,
        sortOrder,
      })
      .onConflictDoNothing();
  } catch (err) {
    log.error("[addSolicitationDocumentFromUploadAction]", "insert failed", { error: err });
    await releaseClaim({ organizationId, uploadId: file.uploadId });
    return { ok: false, error: "Could not record the document; try again." };
  }
  await finishClaim({ organizationId, uploadId: file.uploadId });

  // BL-AIP-4c — a background_job row; the jobs cron re-runs it from
  // storage if this instance dies.
  const bytes = await inlineBytesForMemoryMode({ organizationId, storagePath: file.storageKey });
  await runDurable(
    "[addSolicitationDocumentFromUploadAction] parse",
    {
      organizationId,
      kind: "solicitation_document_parse",
      resourceId: file.resourceId,
      payload: { solicitationId },
      requestedByUserId: user.id,
    },
    bytes ? { bytes } : {},
  );

  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "solicitation.document.upload",
    resourceType: "solicitation_document",
    resourceId: file.resourceId,
    metadata: { solicitationId, uploadId: file.uploadId, documentType, fileName: file.fileName, fileSize: file.size },
  });

  revalidatePath(`/solicitations/${solicitationId}`);
  return { ok: true, id: file.resourceId };
}

// ────────────────────────────────────────────────────────────────────────────
// Delete
// ────────────────────────────────────────────────────────────────────────────

export async function deleteSolicitationDocumentAction(
  documentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [row] = await db
    .select({
      id: solicitationDocuments.id,
      solicitationId: solicitationDocuments.solicitationId,
      storagePath: solicitationDocuments.storagePath,
    })
    .from(solicitationDocuments)
    .where(
      and(
        eq(solicitationDocuments.id, documentId),
        eq(solicitationDocuments.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Document not found." };

  await db
    .delete(solicitationDocuments)
    .where(
      and(
        eq(solicitationDocuments.id, documentId),
        eq(solicitationDocuments.organizationId, organizationId),
      ),
    );

  // Remerge after deletion so the parent requirements stay accurate.
  runInBackground("[deleteSolicitationDocumentAction] remerge", () =>
    mergeDocumentRequirementsHelper(row.solicitationId, organizationId),
  );

  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "solicitation.document.delete",
    resourceType: "solicitation_document",
    resourceId: documentId,
    metadata: { solicitationId: row.solicitationId },
  });

  revalidatePath(`/solicitations/${row.solicitationId}`);
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// Reparse
// ────────────────────────────────────────────────────────────────────────────

export async function reparseSolicitationDocumentAction(
  documentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [row] = await db
    .select({
      id: solicitationDocuments.id,
      solicitationId: solicitationDocuments.solicitationId,
      storagePath: solicitationDocuments.storagePath,
      fileName: solicitationDocuments.fileName,
      contentType: solicitationDocuments.contentType,
    })
    .from(solicitationDocuments)
    .where(
      and(
        eq(solicitationDocuments.id, documentId),
        eq(solicitationDocuments.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Document not found." };
  if (!row.storagePath)
    return { ok: false, error: "No file stored for this document." };

  // BL-STAB-2d — check the file is there without downloading it; the job
  // reads it (within its read budget, verified) from storage. A storage
  // error is not a missing file.
  let head: Awaited<ReturnType<ReturnType<typeof getStorageProvider>["head"]>>;
  try {
    head = await getStorageProvider().head(row.storagePath);
  } catch (err) {
    log.warn("[reparseSolicitationDocumentAction]", "storage check failed", { error: err });
    return { ok: false, error: "File storage could not be reached just now. Try Reparse again in a minute." };
  }
  if (!head) {
    return {
      ok: false,
      error:
        getStorageProvider().name === "memory"
          ? "File bytes are no longer in storage — re-upload the document. (Memory storage doesn't survive redeploys.)"
          : "The stored file is no longer in storage — re-upload the document.",
    };
  }
  const bytes = await inlineBytesForMemoryMode({ organizationId, storagePath: row.storagePath });

  await runDurable(
    "[reparseSolicitationDocumentAction] parse",
    {
      organizationId,
      kind: "solicitation_document_parse",
      resourceId: row.id,
      payload: { solicitationId: row.solicitationId },
      requestedByUserId: user.id,
    },
    bytes ? { bytes } : {},
  );
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// Merge requirements from all companion documents into the parent row
// ────────────────────────────────────────────────────────────────────────────

// BL-AIP-5 — the merge lives in src/lib/solicitation-requirements.ts so
// the parent's own re-parse can call it too (it used to wipe every
// companion document's clauses), and deleting a document now drops that
// document's clauses instead of leaving them in the list for good.
async function mergeDocumentRequirementsHelper(
  solicitationId: string,
  organizationId: string,
): Promise<void> {
  await mergeSolicitationRequirements(solicitationId, organizationId);
}

// ────────────────────────────────────────────────────────────────────────────
// Trigger merge on demand (public action)
// ────────────────────────────────────────────────────────────────────────────

export async function mergeSolicitationDocumentsAction(
  solicitationId: string,
): Promise<{ ok: true; mergedCount: number } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [parentRow] = await db
    .select({ id: solicitations.id })
    .from(solicitations)
    .where(
      and(
        eq(solicitations.id, solicitationId),
        eq(solicitations.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!parentRow) return { ok: false, error: "Solicitation not found." };

  await mergeDocumentRequirementsHelper(solicitationId, organizationId);

  const [updated] = await db
    .select({ extractedRequirements: solicitations.extractedRequirements })
    .from(solicitations)
    .where(eq(solicitations.id, solicitationId))
    .limit(1);

  revalidatePath(`/solicitations/${solicitationId}`);
  return {
    ok: true,
    // BL-AIX Phase 2c — the same count the requirement list shows (rejected left out).
    mergedCount: activeRequirements((updated?.extractedRequirements ?? []) as ReviewedRequirement[]).length,
  };
}
