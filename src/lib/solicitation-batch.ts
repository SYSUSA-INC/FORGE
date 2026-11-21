/**
 * BL-STAB-3 — read a stored, not yet filed upload far enough to label it.
 *
 * The file is already in storage and checked (the upload ledger); this
 * reads it with the same checks the parse uses (the organization's own
 * key, unchanged since the upload, within the format's read budget),
 * takes its text and applies the rules in `solicitation-file-classify`.
 * A file that cannot be read here (an image, a scan, one too large) is
 * labelled from its name alone, and `note` says so. Nothing is claimed
 * or created. Server-only; callers own auth.
 */
import "server-only";

import { log } from "@/lib/log";
import { extractTextFromAny } from "@/lib/solicitation-extract";
import { classifySolicitationFile, type FileClassification } from "@/lib/solicitation-file-classify";
import { parseBudgetBytes } from "@/lib/upload-policy";
import { getVerifiedObject, type StoredUploadPreview } from "@/lib/uploads";

/** Reading for a label happens inside the request, so it stops well short of the parse's budget. */
const CLASSIFY_MAX_BYTES = 40 * 1024 * 1024;

export type ClassifiedUpload = FileClassification & {
  uploadId: string;
  fileName: string;
  size: number;
  /** Why the text was not read ("" when it was). */
  note: string;
};

export async function classifyStoredUpload(organizationId: string, upload: StoredUploadPreview): Promise<ClassifiedUpload> {
  let text = "";
  let note = "";
  if (upload.format === "image") {
    note = "An image: labelled from its name only.";
  } else if (upload.size > Math.min(CLASSIFY_MAX_BYTES, parseBudgetBytes(upload.format, process.env))) {
    note = "Too large to read before filing: labelled from its name only.";
  } else {
    const got = await getVerifiedObject({ organizationId, storagePath: upload.storageKey });
    if (!got.ok) {
      note = got.reason === "changed" ? "The stored file changed after it was uploaded; upload it again." : "The stored file could not be read: labelled from its name only.";
    } else {
      try {
        text = (await extractTextFromAny(got.bytes, upload.contentType, upload.fileName)).text;
        if (!text.trim()) note = "No text could be read (a scan?): labelled from its name only.";
      } catch (err) {
        log.warn("[solicitation-batch]", "text extraction for a label failed", { error: err });
        note = "Its text could not be read: labelled from its name only.";
      }
    }
  }
  const classification = classifySolicitationFile({ fileName: upload.fileName, text, format: upload.format });
  return { uploadId: upload.uploadId, fileName: upload.fileName, size: upload.size, note, ...classification };
}
