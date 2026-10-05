"use server";

import { and, asc, eq } from "drizzle-orm";
import { describeCoverage } from "@/lib/extraction-coverage";
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
import { detectFormat } from "@/lib/text-extract";
import { runInBackground } from "@/lib/background";
import { runDurable } from "@/lib/jobs";
import { log } from "@/lib/log";

// BL-AIP-4c — the parse pipeline itself lives in
// src/lib/solicitation-document-parse.ts so the jobs cron can re-run it.
const MAX_BYTES = 25 * 1024 * 1024;

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
    sortOrder: r.sortOrder,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ────────────────────────────────────────────────────────────────────────────
// Add (upload + async parse)
// ────────────────────────────────────────────────────────────────────────────

export async function addSolicitationDocumentAction(
  solicitationId: string,
  formData: FormData,
): Promise<AddDocumentResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // Verify parent solicitation belongs to this org.
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

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Pick a file to upload." };
  if (file.size === 0) return { ok: false, error: "Selected file is empty." };
  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      error: `File exceeds ${MAX_BYTES / 1024 / 1024} MB limit.`,
    };
  }
  const format = detectFormat(file.type, file.name);
  if (!format) {
    return {
      ok: false,
      error: "Unsupported file type. Accepted: PDF, DOCX, XLSX, PPTX, TXT/MD, or image.",
    };
  }

  const documentTypeRaw = formData.get("documentType");
  const documentType: SolicitationDocumentType =
    typeof documentTypeRaw === "string" &&
    ["rfp", "pws", "sow", "cdrl", "j_attachment", "amendment", "other"].includes(
      documentTypeRaw,
    )
      ? (documentTypeRaw as SolicitationDocumentType)
      : "other";

  const sortOrderRaw = formData.get("sortOrder");
  const sortOrder =
    typeof sortOrderRaw === "string" ? parseInt(sortOrderRaw, 10) || 0 : 0;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const resolvedContentType = file.type || "application/octet-stream";

  const [row] = await db
    .insert(solicitationDocuments)
    .values({
      organizationId,
      solicitationId,
      documentType,
      fileName: file.name,
      fileSize: file.size,
      contentType: resolvedContentType,
      parseStatus: "uploaded",
      uploadedByUserId: user.id,
      sortOrder,
    })
    .returning({ id: solicitationDocuments.id });
  if (!row) return { ok: false, error: "Could not create document record." };

  try {
    const storage = getStorageProvider();
    const key = `org/${organizationId}/solicitation/${solicitationId}/documents/${row.id}/${file.name}`;
    const stored = await storage.put({ key, bytes, contentType: resolvedContentType });
    await db
      .update(solicitationDocuments)
      .set({ storagePath: stored.storagePath, updatedAt: new Date() })
      .where(and(eq(solicitationDocuments.organizationId, organizationId), eq(solicitationDocuments.id, row.id)));
  } catch (err) {
    log.error("[addSolicitationDocumentAction]", "storage", { error: err });
    await db
      .update(solicitationDocuments)
      .set({
        parseStatus: "failed",
        parseError: err instanceof Error ? err.message : "Storage write failed.",
        updatedAt: new Date(),
      })
      .where(and(eq(solicitationDocuments.organizationId, organizationId), eq(solicitationDocuments.id, row.id)));
    return { ok: false, error: "Upload saved metadata but file storage failed." };
  }

  // BL-AIP-4c — a background_job row: runs now from the bytes in hand;
  // the jobs cron re-runs it from storage if this instance dies.
  await runDurable(
    "[addSolicitationDocumentAction] inline parse",
    {
      organizationId,
      kind: "solicitation_document_parse",
      resourceId: row.id,
      payload: { solicitationId },
      requestedByUserId: user.id,
    },
    { bytes },
  );

  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "solicitation.document.upload",
    resourceType: "solicitation_document",
    resourceId: row.id,
    metadata: { solicitationId, documentType, fileName: file.name, fileSize: file.size },
  });

  revalidatePath(`/solicitations/${solicitationId}`);
  return { ok: true, id: row.id };
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

  const storage = getStorageProvider();
  const obj = await storage.get(row.storagePath);
  if (!obj) {
    return {
      ok: false,
      error: "File bytes are no longer in storage — re-upload the document.",
    };
  }

  await runDurable(
    "[reparseSolicitationDocumentAction] parse",
    {
      organizationId,
      kind: "solicitation_document_parse",
      resourceId: row.id,
      payload: { solicitationId: row.solicitationId },
      requestedByUserId: user.id,
    },
    { bytes: obj.bytes },
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
    mergedCount: (updated?.extractedRequirements ?? []).length,
  };
}
