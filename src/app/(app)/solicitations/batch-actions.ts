"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { solicitations } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { classifyStoredUpload, type ClassifiedUpload } from "@/lib/solicitation-batch";
import { batchProblem, companionTypeFor, inAmendmentOrder, isFileLabel, type FileLabel } from "@/lib/solicitation-file-classify";
import { peekStoredUploads } from "@/lib/uploads";
import { createSolicitationFromUploadAction } from "./actions";
import { addSolicitationDocumentFromUploadAction } from "./[id]/document-actions";

export type ClassifyFileResult = { ok: true; file: ClassifiedUpload } | { ok: false; error: string };

/**
 * BL-STAB-3 — say what one uploaded file is, before anything is filed.
 * The file is already in storage (the browser sent it there); this reads
 * its text and applies the rules, and returns the label with its
 * confidence and the lines it was read from. Nothing is claimed or
 * created: the person confirms every label first.
 */
export async function classifyUploadedFileAction(input: { uploadId: string }): Promise<ClassifyFileResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const uploadId = String(input?.uploadId ?? "");
  const { ready, bad } = await peekStoredUploads({ organizationId, userId: user.id, uploadIds: [uploadId], resourceType: "solicitation" });
  const upload = ready[0];
  if (!upload) return { ok: false, error: bad[0]?.reason ?? "Upload not found." };
  return { ok: true, file: await classifyStoredUpload(organizationId, upload) };
}

export type BatchFile = { uploadId: string; label: string; amendmentNumber?: string };
export type FiledFile = { uploadId: string; label: FileLabel; id: string };
export type FileBatchResult =
  | { ok: true; solicitationId: string; filed: FiledFile[]; failed: { uploadId: string; error: string }[] }
  | { ok: false; error: string };

/**
 * BL-STAB-3 — file a confirmed batch. The base solicitation first; then
 * the amendments under it, in number order, each a child solicitation
 * with its own parse (as Add amendment files them); then every other
 * file as a companion document of its type. Each file is filed by its
 * upload id through the same path a single upload takes (claimed once,
 * audited, parsed from storage), so sending the same batch again after a
 * partial failure files only what is missing. If the base cannot be
 * filed, nothing else is.
 */
export async function fileSolicitationBatchAction(input: { files: BatchFile[] }): Promise<FileBatchResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const seen = new Set<string>();
  const files: { uploadId: string; label: FileLabel; amendmentNumber: string; fileName: string }[] = [];
  for (const f of Array.isArray(input?.files) ? input.files.slice(0, 100) : []) {
    const uploadId = String(f?.uploadId ?? "");
    if (!uploadId || seen.has(uploadId)) continue;
    if (!isFileLabel(f?.label)) return { ok: false, error: "Every file needs a label before it is filed." };
    seen.add(uploadId);
    files.push({ uploadId, label: f.label, amendmentNumber: typeof f.amendmentNumber === "string" ? f.amendmentNumber.trim().slice(0, 64) : "", fileName: "" });
  }
  const problem = batchProblem(files);
  if (problem) return { ok: false, error: problem };

  const base = files.find((f) => f.label === "base")!;
  const baseRes = await createSolicitationFromUploadAction({ uploadId: base.uploadId });
  if (!baseRes.ok) return { ok: false, error: `The base solicitation could not be filed: ${baseRes.error}` };
  // A retry returns the id the upload was filed under: make sure that is
  // a base solicitation of this organization before filing under it.
  const [baseRow] = await db
    .select({ id: solicitations.id, parentSolicitationId: solicitations.parentSolicitationId })
    .from(solicitations)
    .where(and(eq(solicitations.id, baseRes.id), eq(solicitations.organizationId, organizationId)))
    .limit(1);
  if (!baseRow || baseRow.parentSolicitationId) return { ok: false, error: "The file marked as the base solicitation was already filed as something else." };
  const solicitationId = baseRow.id;

  const filed: FiledFile[] = [{ uploadId: base.uploadId, label: "base", id: solicitationId }];
  const failed: { uploadId: string; error: string }[] = [];
  // One after another: amendments land in number order, and no two
  // filings race for the same parent.
  for (const f of inAmendmentOrder(files.filter((x) => x.label === "amendment"))) {
    const res = await createSolicitationFromUploadAction({ uploadId: f.uploadId, parentSolicitationId: solicitationId, amendmentNumber: f.amendmentNumber });
    if (res.ok) filed.push({ uploadId: f.uploadId, label: "amendment", id: res.id });
    else failed.push({ uploadId: f.uploadId, error: res.error });
  }
  let sortOrder = 0;
  for (const f of files) {
    if (f.label === "base" || f.label === "amendment") continue;
    const res = await addSolicitationDocumentFromUploadAction(solicitationId, { uploadId: f.uploadId, documentType: companionTypeFor(f.label), sortOrder: sortOrder++ });
    if (res.ok) filed.push({ uploadId: f.uploadId, label: f.label, id: res.id });
    else failed.push({ uploadId: f.uploadId, error: res.error });
  }

  const count = (label: FileLabel) => filed.filter((x) => x.label === label).length;
  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "solicitation.batch.upload",
    resourceType: "solicitation",
    resourceId: solicitationId,
    metadata: { files: files.length, filed: filed.length, failed: failed.length, amendments: count("amendment"), companions: filed.length - 1 - count("amendment") },
  });
  return { ok: true, solicitationId, filed, failed };
}
