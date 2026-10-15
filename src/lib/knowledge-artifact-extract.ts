/**
 * BL-STAB-2e — a knowledge-base file's text extraction, run by the
 * `knowledge_artifact_extract` background job (moved unchanged from the
 * upload action, which read the file inside the request). Records its
 * own outcome on the artifact: `indexed` with the text, or `failed` with
 * the reason. Server-only; the caller has loaded and checked the bytes.
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeArtifacts } from "@/db/schema";
import type { AIDocumentMedia } from "@/lib/ai";
import { extractTextFromImageViaVision } from "@/lib/image-ocr";
import { CLASSIFY_CONFIDENCE_THRESHOLD, classifyArtifactKind } from "@/lib/knowledge-classify";
import { log } from "@/lib/log";
import { extractTextFromPdf } from "@/lib/solicitation-extract";
import {
  extractTextFromDocx,
  extractTextFromPlainText,
  extractTextFromPptx,
  extractTextFromXlsx,
  type ExtractFormat,
} from "@/lib/text-extract";

const RAW_TEXT_CAP = 500_000;

export async function extractAndIndex(
  id: string,
  bytes: Uint8Array,
  format: ExtractFormat,
  contentType: string,
  fileName: string,
  organizationId: string,
  /**
   * The batch's kind was Auto-detect (the classifier may replace the
   * file-type guess); `"suggest"` when the choice isn't known (a read the
   * upload sweep queued for a filing that died): the classifier's answer
   * is stored as a suggestion only, never applied over a chosen kind.
   */
  wasAutoKind: boolean | "suggest" = false,
): Promise<void> {
  await db
    .update(knowledgeArtifacts)
    .set({
      status: "extracting_text",
      statusError: "",
      updatedAt: new Date(),
    })
    .where(and(eq(knowledgeArtifacts.organizationId, organizationId), eq(knowledgeArtifacts.id, id)));

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
          organizationId,
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
            .where(and(eq(knowledgeArtifacts.organizationId, organizationId), eq(knowledgeArtifacts.id, id)));
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
      .where(and(eq(knowledgeArtifacts.organizationId, organizationId), eq(knowledgeArtifacts.id, id)));
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
    .where(and(eq(knowledgeArtifacts.organizationId, organizationId), eq(knowledgeArtifacts.id, id)));

  // BL-10 Phase A — AI kind classification on auto-detect uploads.
  // Best-effort: any failure here logs and leaves the heuristic kind in
  // place. Skipped in stub mode, skipped on empty text.
  //
  // BL-10 Phase B-1 — ALSO persist the classifier output to the new
  // ai_suggested_kind / ai_classification_confidence /
  // ai_classification_reasoning columns regardless of whether we
  // applied it. UI uses these to surface low-confidence suggestions
  // as accept-able pills.
  if (wasAutoKind && rawText.trim().length > 0) {
    try {
      const classified = await classifyArtifactKind({
        organizationId,
        fileName,
        contentType,
        rawText,
      });
      if (classified.ok && !classified.stubbed) {
        const shouldApply =
          wasAutoKind === true && classified.confidence >= CLASSIFY_CONFIDENCE_THRESHOLD;
        await db
          .update(knowledgeArtifacts)
          .set({
            ...(shouldApply ? { kind: classified.kind } : {}),
            aiSuggestedKind: classified.kind,
            aiClassificationConfidence: classified.confidence,
            aiClassificationReasoning: classified.reasoning,
            updatedAt: new Date(),
          })
          .where(and(eq(knowledgeArtifacts.organizationId, organizationId), eq(knowledgeArtifacts.id, id)));
      }
    } catch (err) {
      log.error("[knowledge-artifact classify]", "error", { error: err });
    }
  }
}
