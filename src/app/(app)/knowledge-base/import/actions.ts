"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  knowledgeArtifacts,
  type KnowledgeArtifactKind,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { getStorageProvider } from "@/lib/storage";
import {
  detectFormat,
  extractTextFromDocx,
  extractTextFromPlainText,
  extractTextFromPptx,
  extractTextFromXlsx,
  type ExtractFormat,
} from "@/lib/text-extract";
import { extractTextFromPdf } from "@/lib/solicitation-extract";
import { extractTextFromImageViaVision } from "@/lib/image-ocr";
import type { AIDocumentMedia } from "@/lib/ai";
import {
  classifyArtifactKind,
  CLASSIFY_CONFIDENCE_THRESHOLD,
} from "@/lib/knowledge-classify";
import { log } from "@/lib/log";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB cap; corpus runs bigger than solicitations.
const RAW_TEXT_CAP = 500_000;

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

export async function uploadKnowledgeArtifactAction(
  formData: FormData,
): Promise<ArtifactUploadResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "Pick a file to upload." };
  }
  if (file.size === 0) return { ok: false, error: "File is empty." };
  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      error: `File is larger than ${MAX_BYTES / 1024 / 1024} MB. Split or compress before uploading.`,
    };
  }

  const format = detectFormat(file.type, file.name);
  if (!format) {
    return {
      ok: false,
      error:
        "Unsupported file type. Accepted: PDF, DOCX, XLSX, PPTX, TXT/MD, or image.",
    };
  }

  // Optional fields posted alongside the file.
  const rawKind = (formData.get("kind") as string | null)?.trim() || "";
  const rawTags = (formData.get("tags") as string | null) || "";
  const rawTitle = (formData.get("title") as string | null) || "";

  const kind = isValidKind(rawKind)
    ? (rawKind as KnowledgeArtifactKind)
    : defaultKindFromFormat(format);
  const tags = rawTags
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 32);
  const title = (rawTitle || stripExt(file.name)).slice(0, 256);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = file.type || guessContentType(format);

  // Insert immediately so the user sees an entry. Storage + extraction
  // happens after.
  const [row] = await db
    .insert(knowledgeArtifacts)
    .values({
      organizationId,
      kind,
      source: "uploaded",
      title,
      tags,
      fileName: file.name,
      fileSize: file.size,
      contentType,
      status: "uploaded",
      uploadedByUserId: user.id,
    })
    .returning({ id: knowledgeArtifacts.id });
  if (!row) return { ok: false, error: "Could not record artifact." };

  // Persist bytes.
  try {
    const storage = getStorageProvider();
    const key = `org/${organizationId}/knowledge/${row.id}/${file.name}`;
    const stored = await storage.put({
      key,
      bytes,
      contentType,
    });
    await db
      .update(knowledgeArtifacts)
      .set({ storagePath: stored.storagePath, updatedAt: new Date() })
      .where(eq(knowledgeArtifacts.id, row.id));
  } catch (err) {
    log.error("[uploadKnowledgeArtifact]", "storage", { error: err });
    await db
      .update(knowledgeArtifacts)
      .set({
        status: "failed",
        statusError:
          err instanceof Error ? err.message : "Storage write failed.",
        updatedAt: new Date(),
      })
      .where(eq(knowledgeArtifacts.id, row.id));
    return {
      ok: false,
      error: "Saved metadata but failed to store the file bytes.",
    };
  }

  // Extract text inline (fast for most formats; images skip — Phase 10c
  // will run the AI vision pass async).
  //
  // BL-10 Phase A: when the user picked "Auto-detect", the kind we
  // wrote at insert time is the file-extension heuristic from
  // defaultKindFromFormat. After extraction, classifyArtifactKind
  // gives a content-based answer that supersedes the heuristic when
  // confidence is high enough. We pass `wasAutoKind` so the
  // classifier only runs in the auto path.
  const wasAutoKind = !isValidKind(rawKind);
  await extractAndIndex(
    row.id,
    bytes,
    format,
    contentType,
    file.name,
    wasAutoKind,
  );

  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "knowledge_artifact.upload",
    resourceType: "knowledge_artifact",
    resourceId: row.id,
    metadata: {
      kind,
      fileName: file.name,
      fileSize: file.size,
      format,
    },
  });

  revalidatePath("/knowledge-base");
  revalidatePath("/knowledge-base/import");
  return { ok: true, id: row.id };
}

async function extractAndIndex(
  id: string,
  bytes: Uint8Array,
  format: ExtractFormat,
  contentType: string,
  fileName: string,
  wasAutoKind: boolean = false,
): Promise<void> {
  await db
    .update(knowledgeArtifacts)
    .set({
      status: "extracting_text",
      statusError: "",
      updatedAt: new Date(),
    })
    .where(eq(knowledgeArtifacts.id, id));

  let rawText = "";
  try {
    switch (format) {
      case "pdf":
        rawText = await extractTextFromPdf(bytes);
        break;
      case "docx":
        rawText = await extractTextFromDocx(bytes);
        break;
      case "xlsx":
        rawText = await extractTextFromXlsx(bytes);
        break;
      case "pptx":
        rawText = await extractTextFromPptx(bytes);
        break;
      case "text":
        rawText = await extractTextFromPlainText(bytes);
        break;
      case "image": {
        // Phase 10g: hand the image to Claude vision. Returns plain
        // text the corpus can index + Brain Extraction can mine.
        // Falls back gracefully when AI provider isn't configured —
        // the artifact still lands but with an explanatory note.
        const ocr = await extractTextFromImageViaVision({
          bytes,
          mediaType: (contentType || "image/png") as AIDocumentMedia,
          fileName,
        });
        if (ocr.ok) {
          rawText = ocr.text;
        } else {
          rawText = "";
          await db
            .update(knowledgeArtifacts)
            .set({
              statusError: ocr.error,
              updatedAt: new Date(),
            })
            .where(eq(knowledgeArtifacts.id, id));
        }
        break;
      }
    }
  } catch (err) {
    log.error("[knowledge-artifact extract]", "error", { error: err });
    await db
      .update(knowledgeArtifacts)
      .set({
        status: "failed",
        statusError:
          err instanceof Error
            ? `Text extraction failed: ${err.message}`
            : "Text extraction failed.",
        updatedAt: new Date(),
      })
      .where(eq(knowledgeArtifacts.id, id));
    return;
  }

  await db
    .update(knowledgeArtifacts)
    .set({
      rawText: rawText.slice(0, RAW_TEXT_CAP),
      status: "indexed",
      indexedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(knowledgeArtifacts.id, id));

  // BL-10 Phase A — AI kind classification on auto-detect uploads.
  // Best-effort: any failure here logs and leaves the heuristic kind in
  // place. Skipped in stub mode, skipped on empty text, skipped when
  // confidence is below the threshold.
  if (wasAutoKind && rawText.trim().length > 0) {
    try {
      const classified = await classifyArtifactKind({
        fileName,
        contentType,
        rawText,
      });
      if (
        classified.ok &&
        !classified.stubbed &&
        classified.confidence >= CLASSIFY_CONFIDENCE_THRESHOLD
      ) {
        await db
          .update(knowledgeArtifacts)
          .set({ kind: classified.kind, updatedAt: new Date() })
          .where(eq(knowledgeArtifacts.id, id));
      }
    } catch (err) {
      log.error("[knowledge-artifact classify]", "error", { error: err });
    }
  }
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
  }));
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

function guessContentType(format: ExtractFormat): string {
  switch (format) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "image":
      return "image/png";
    case "text":
      return "text/plain";
  }
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
 * Loads bytes from the storage provider and calls the same
 * extractAndIndex used at upload time. Idempotent — safe to re-run.
 */
export async function reextractArtifactTextAction(
  artifactId: string,
): Promise<{ ok: true; chars: number } | { ok: false; error: string }> {
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

  const storage = getStorageProvider();
  const obj = await storage.get(artifact.storagePath);
  if (!obj) {
    return {
      ok: false,
      error:
        "Storage no longer has the file bytes (likely after a redeploy of the memory-mode stub). Re-upload to retry.",
    };
  }

  const format = detectFormat(artifact.contentType, artifact.fileName);
  if (!format) {
    return {
      ok: false,
      error: "Unrecognized file format. Cannot re-extract.",
    };
  }

  await extractAndIndex(
    artifact.id,
    obj.bytes,
    format,
    artifact.contentType,
    artifact.fileName,
  );

  // Reload to return the new char count.
  const [updated] = await db
    .select({ rawText: knowledgeArtifacts.rawText })
    .from(knowledgeArtifacts)
    .where(eq(knowledgeArtifacts.id, artifactId))
    .limit(1);

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "knowledge_artifact.reextract",
    resourceType: "knowledge_artifact",
    resourceId: artifactId,
    metadata: { chars: updated?.rawText?.length ?? 0, format },
  });

  revalidatePath(`/knowledge-base/import/${artifactId}`);
  revalidatePath("/knowledge-base/import");
  return { ok: true, chars: updated?.rawText?.length ?? 0 };
}
