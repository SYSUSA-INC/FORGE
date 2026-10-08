"use server";

import { headers } from "next/headers";
import { requireAuth, requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { log } from "@/lib/log";
import { templateAuthoringRefusal } from "@/lib/template-gate";
import { isUploadPurpose, type UploadPurpose } from "@/lib/upload-policy";
import {
  cancelUpload,
  completeUpload,
  createUploadIntent,
  type UploadCompleteResult,
  type UploadIntentResult,
} from "@/lib/uploads";

/**
 * BL-STAB-2b — ask to upload one file straight to storage. Returns a
 * short-lived link for exactly this file's key, type and size; the
 * browser PUTs the bytes there, then calls `completeUploadAction`.
 * Nothing here reads file bytes, so no file size is limited by the
 * request.
 */
export async function requestUploadAction(input: { purpose: UploadPurpose; fileName: string; size: number }): Promise<UploadIntentResult> {
  await requireAuth();
  const { user, organizationId, isImpersonating } = await requireCurrentOrg();
  if (isImpersonating) {
    // Middleware already blocks actions while impersonating; the upload
    // itself never passes through middleware, so refuse the link too.
    log.warn("[uploads]", "upload refused while impersonating", { organizationId });
    return { ok: false, code: "impersonating", error: "Uploads are not available while viewing as another organization." };
  }
  if (!isUploadPurpose(input?.purpose)) return { ok: false, code: "bad_purpose", error: "Unknown upload purpose." };
  if (input.purpose === "template_docx") {
    await requireOrgAdmin(organizationId);
    const refusal = await templateAuthoringRefusal(organizationId);
    if (refusal) return { ok: false, code: "feature", error: refusal };
  }
  if (input.purpose === "diagnostic" && !user.isSuperadmin) {
    return { ok: false, code: "forbidden", error: "Only platform admins can run storage checks." };
  }
  return createUploadIntent({
    organizationId,
    actor: { userId: user.id, email: user.email ?? null },
    purpose: input.purpose,
    fileName: String(input.fileName ?? ""),
    size: Number(input.size),
    origin: headers().get("origin") ?? "",
  });
}

/** BL-STAB-2b — the file is up: check it in storage and mark it ready to save. */
export async function completeUploadAction(uploadId: string): Promise<UploadCompleteResult> {
  await requireAuth();
  const { user, organizationId } = await requireCurrentOrg();
  return completeUpload({ organizationId, actor: { userId: user.id, email: user.email ?? null }, uploadId: String(uploadId ?? "") });
}

/** BL-STAB-2b — drop an upload the user no longer wants (and whatever of it arrived). */
export async function cancelUploadAction(uploadId: string): Promise<{ ok: true }> {
  await requireAuth();
  const { user, organizationId } = await requireCurrentOrg();
  return cancelUpload({ organizationId, actor: { userId: user.id, email: user.email ?? null }, uploadId: String(uploadId ?? "") });
}
