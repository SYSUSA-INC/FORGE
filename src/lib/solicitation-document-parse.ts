/**
 * Companion-document parsing — bytes in, parsed row + merged parent out.
 *
 * BL-AIP-4c moved this out of `solicitations/[id]/document-actions.ts`
 * so the durable jobs runner (`src/lib/jobs.ts`) can re-run a parse
 * whose instance died, from the stored file bytes. Same pipeline as the
 * primary solicitation parse: format-aware text extraction → vision OCR
 * for images and sparse PDFs → AI extraction → the document row lands
 * `parsed` or `failed` with the reason, and the parent solicitation's
 * requirement list is re-merged. Every write is scoped by
 * organizationId. Server-only; callers own auth.
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { solicitationDocuments, type SolicitationRequirement } from "@/db/schema";
import type { AIDocumentMedia } from "@/lib/ai";
import {
  aiExtractSolicitation,
  aiExtractSolicitationFromImage,
  aiExtractSolicitationFromPdf,
  extractTextFromAny,
} from "@/lib/solicitation-extract";
import { mergeSolicitationRequirements } from "@/lib/solicitation-requirements";
import { detectFormat } from "@/lib/text-extract";

const TEXT_LAYER_MIN_CHARS = 200;
const RAW_TEXT_CAP = 500_000;

export async function parseSolicitationDocumentFromBytes(
  documentId: string,
  solicitationId: string,
  organizationId: string,
  bytes: Uint8Array,
  fileName: string,
  contentType: string,
): Promise<void> {
  await db
    .update(solicitationDocuments)
    .set({ parseStatus: "parsing", parseError: "", updatedAt: new Date() })
    .where(and(eq(solicitationDocuments.organizationId, organizationId), eq(solicitationDocuments.id, documentId)));

  const fail = async (msg: string, rawText = "") => {
    await db
      .update(solicitationDocuments)
      .set({
        parseStatus: "failed",
        parseError: msg,
        rawText: rawText.slice(0, RAW_TEXT_CAP),
        updatedAt: new Date(),
      })
      .where(and(eq(solicitationDocuments.organizationId, organizationId), eq(solicitationDocuments.id, documentId)));
    revalidatePath(`/solicitations/${solicitationId}`);
  };

  let rawText = "";
  // BL-AIX Phase 2a — where each PDF page starts, for requirement provenance.
  let pageStarts: number[] | undefined;
  let format: ReturnType<typeof detectFormat> = null;
  try {
    const res = await extractTextFromAny(bytes, contentType, fileName);
    rawText = res.text;
    pageStarts = res.pageStarts;
    format = res.format;
  } catch {
    format = detectFormat(contentType, fileName);
  }

  if (format === "image") {
    const mediaType = (contentType || "image/png") as AIDocumentMedia;
    const visionRes = await aiExtractSolicitationFromImage(
      organizationId,
      bytes,
      fileName,
      mediaType,
    );
    if (!visionRes.ok) { await fail(visionRes.error); return; }
    await applyExtraction(documentId, solicitationId, organizationId, {
      rawText: "",
      sectionLSummary: visionRes.data.sectionLSummary + "\n\n[Extracted via vision OCR.]",
      sectionMSummary: visionRes.data.sectionMSummary,
      requirements: visionRes.data.requirements,
      coverage: { vision: true },
    });
    return;
  }

  if (format === "pdf" && rawText.trim().length < TEXT_LAYER_MIN_CHARS) {
    const visionRes = await aiExtractSolicitationFromPdf(organizationId, bytes, fileName);
    if (!visionRes.ok) { await fail(visionRes.error, rawText); return; }
    await applyExtraction(documentId, solicitationId, organizationId, {
      rawText: "",
      sectionLSummary:
        visionRes.data.sectionLSummary +
        "\n\n[Extracted via vision OCR — text layer was unreadable.]",
      sectionMSummary: visionRes.data.sectionMSummary,
      requirements: visionRes.data.requirements,
      coverage: { vision: true },
    });
    return;
  }

  if (format !== "pdf" && rawText.trim().length < TEXT_LAYER_MIN_CHARS) {
    await fail(
      `${format?.toUpperCase() ?? "Document"} has no extractable text. Confirm the file isn't password-protected.`,
    );
    return;
  }

  const aiRes = await aiExtractSolicitation(organizationId, rawText, { pageStarts });
  if (!aiRes.ok) { await fail(aiRes.error, rawText); return; }

  await applyExtraction(documentId, solicitationId, organizationId, {
    rawText: rawText.slice(0, RAW_TEXT_CAP),
    sectionLSummary: aiRes.data.sectionLSummary,
    sectionMSummary: aiRes.data.sectionMSummary,
    requirements: aiRes.data.requirements,
    coverage: aiRes.coverage ?? {},
  });
}

async function applyExtraction(
  documentId: string,
  solicitationId: string,
  organizationId: string,
  data: {
    rawText: string;
    sectionLSummary: string;
    sectionMSummary: string;
    requirements: { kind: string; text: string; ref: string }[];
    coverage: import("@/lib/extraction-coverage").ExtractionCoverage;
  },
): Promise<void> {
  const reqs: SolicitationRequirement[] = data.requirements.map((r) => ({
    kind: r.kind as SolicitationRequirement["kind"],
    text: r.text,
    ref: r.ref,
  }));

  await db
    .update(solicitationDocuments)
    .set({
      parseStatus: "parsed",
      parseError: "",
      rawText: data.rawText,
      sectionLSummary: data.sectionLSummary,
      sectionMSummary: data.sectionMSummary,
      extractedRequirements: reqs,
      extractionCoverage: data.coverage,
      updatedAt: new Date(),
    })
    .where(and(eq(solicitationDocuments.organizationId, organizationId), eq(solicitationDocuments.id, documentId)));

  // Roll merged requirements back up to the parent solicitation.
  await mergeSolicitationRequirements(solicitationId, organizationId);
  revalidatePath(`/solicitations/${solicitationId}`);
}
