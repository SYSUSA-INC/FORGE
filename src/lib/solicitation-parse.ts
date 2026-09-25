/**
 * Solicitation parsing — bytes in, extracted record out.
 *
 * Moved out of `solicitations/actions.ts` in BL-AIP-1 so every path that
 * stores a solicitation file can run the same extraction: the upload
 * form, Re-parse, and the GSA email-paste import, which used to store
 * its attachments as `parseStatus: "uploaded"` and never parse them, so
 * the opportunity's Documents & AI review buttons stayed disabled for
 * good. A `"use server"` file cannot export a non-action helper (every
 * export becomes a client-callable endpoint), hence a server-only lib.
 *
 * Flow: format-aware text extraction → vision OCR for images and sparse
 * PDFs → AI extraction → the row is updated to `parsed` or `failed`
 * with the reason. Every write is scoped by organizationId.
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  solicitations,
  type SolicitationKeyDate,
  type SolicitationType,
} from "@/db/schema";
import type { AIDocumentMedia } from "@/lib/ai";
import { log } from "@/lib/log";
import {
  aiExtractSolicitation,
  aiExtractSolicitationFromImage,
  aiExtractSolicitationFromPdf,
  extractTextFromAny,
} from "@/lib/solicitation-extract";
import { mergeSolicitationRequirements } from "@/lib/solicitation-requirements";
import { detectFormat } from "@/lib/text-extract";

// Below this many extracted characters we treat the PDF as effectively
// empty (likely scanned-image) and fall through to vision OCR.
const TEXT_LAYER_MIN_CHARS = 200;
const RAW_TEXT_CAP = 500_000;

export async function parseSolicitationFromBytes(
  solicitationId: string,
  organizationId: string,
  bytes: Uint8Array,
): Promise<void> {
  // The tenant predicate is written out on every update (rather than
  // held in a variable) so scripts/check-isolation.mjs can see it.
  await db
    .update(solicitations)
    .set({ parseStatus: "parsing", parseError: "", updatedAt: new Date() })
    .where(
      and(
        eq(solicitations.organizationId, organizationId),
        eq(solicitations.id, solicitationId),
      ),
    );

  // Look up the file's stored name + content type so we can dispatch.
  const meta = await getFileMeta(solicitationId, organizationId);
  const fileName = meta.fileName || "solicitation";
  const contentType = meta.contentType || "";

  // Format-aware text extraction. PDF/DOCX/XLSX/PPTX/text get a cheap
  // local pass; images skip straight to vision.
  let rawText = "";
  let format: ReturnType<typeof detectFormat> = null;
  try {
    const res = await extractTextFromAny(bytes, contentType, fileName);
    rawText = res.text;
    format = res.format;
  } catch (err) {
    log.warn(
      "[parseSolicitationFromBytes]",
      "text extraction failed, will try vision if applicable",
      { error: err },
    );
    format = detectFormat(contentType, fileName);
  }

  // Image: vision is the ONLY path. No text layer to fall back to.
  if (format === "image") {
    const mediaType = (contentType || "image/png") as AIDocumentMedia;
    const visionRes = await aiExtractSolicitationFromImage(
      organizationId,
      bytes,
      fileName,
      mediaType,
    );
    if (!visionRes.ok) {
      await db
        .update(solicitations)
        .set({
          parseStatus: "failed",
          parseError: visionRes.error,
          updatedAt: new Date(),
        })
        .where(
      and(
        eq(solicitations.organizationId, organizationId),
        eq(solicitations.id, solicitationId),
      ),
    );
      return;
    }
    const d = visionRes.data;
    await db
      .update(solicitations)
      .set({
        parseStatus: "parsed",
        parseError: "",
        rawText: buildRawTextFromExtraction(d),
        title: d.title || stripExt(fileName),
        agency: d.agency,
        office: d.office,
        type: d.type as SolicitationType,
        solicitationNumber: d.solicitationNumber,
        naicsCode: d.naicsCode,
        setAside: d.setAside,
        responseDueDate: d.responseDueDate ? new Date(d.responseDueDate) : null,
        sectionLSummary:
          (d.sectionLSummary || "") +
          "\n\n[Extracted from image via vision OCR.]",
        sectionMSummary: d.sectionMSummary,
        extractedRequirements: d.requirements,
        keyDates: (d.keyDates ?? []) as SolicitationKeyDate[],
        updatedAt: new Date(),
      })
      .where(
      and(
        eq(solicitations.organizationId, organizationId),
        eq(solicitations.id, solicitationId),
      ),
    );
    revalidatePath(`/solicitations/${solicitationId}`);
    return;
  }

  // PDF: if the text layer is sparse, fall back to vision OCR.
  if (format === "pdf" && rawText.trim().length < TEXT_LAYER_MIN_CHARS) {
    const visionRes = await aiExtractSolicitationFromPdf(organizationId, bytes, fileName);
    if (!visionRes.ok) {
      await db
        .update(solicitations)
        .set({
          parseStatus: "failed",
          parseError: visionRes.error,
          rawText: rawText.slice(0, RAW_TEXT_CAP),
          updatedAt: new Date(),
        })
        .where(
      and(
        eq(solicitations.organizationId, organizationId),
        eq(solicitations.id, solicitationId),
      ),
    );
      return;
    }
    const d = visionRes.data;
    await db
      .update(solicitations)
      .set({
        parseStatus: "parsed",
        parseError: "",
        rawText: buildRawTextFromExtraction(d),
        title: d.title || stripExt(fileName),
        agency: d.agency,
        office: d.office,
        type: d.type as SolicitationType,
        solicitationNumber: d.solicitationNumber,
        naicsCode: d.naicsCode,
        setAside: d.setAside,
        responseDueDate: d.responseDueDate ? new Date(d.responseDueDate) : null,
        sectionLSummary:
          (d.sectionLSummary || "") +
          "\n\n[Extracted via vision OCR — text layer was unreadable.]",
        sectionMSummary: d.sectionMSummary,
        extractedRequirements: d.requirements,
        keyDates: (d.keyDates ?? []) as SolicitationKeyDate[],
        updatedAt: new Date(),
      })
      .where(
      and(
        eq(solicitations.organizationId, organizationId),
        eq(solicitations.id, solicitationId),
      ),
    );
    revalidatePath(`/solicitations/${solicitationId}`);
    return;
  }

  // DOCX / XLSX / PPTX / TEXT — text-layer is reliable. If extraction
  // returned nothing usable, the document is likely empty or corrupted.
  if (format !== "pdf" && rawText.trim().length < TEXT_LAYER_MIN_CHARS) {
    await db
      .update(solicitations)
      .set({
        parseStatus: "failed",
        parseError: `${format?.toUpperCase() ?? "Document"} appears to have no extractable text. Confirm the file isn't password-protected or empty.`,
        updatedAt: new Date(),
      })
      .where(
      and(
        eq(solicitations.organizationId, organizationId),
        eq(solicitations.id, solicitationId),
      ),
    );
    return;
  }

  const aiRes = await aiExtractSolicitation(organizationId, rawText, {
    documentLabel: fileName,
  });
  if (!aiRes.ok) {
    await db
      .update(solicitations)
      .set({
        parseStatus: "failed",
        parseError: aiRes.error,
        rawText: rawText.slice(0, RAW_TEXT_CAP),
        updatedAt: new Date(),
      })
      .where(
      and(
        eq(solicitations.organizationId, organizationId),
        eq(solicitations.id, solicitationId),
      ),
    );
    return;
  }

  const d = aiRes.data;
  await db
    .update(solicitations)
    .set({
      parseStatus: "parsed",
      parseError: "",
      rawText: rawText.slice(0, RAW_TEXT_CAP),
      title: d.title || stripExt(fileName),
      agency: d.agency,
      office: d.office,
      type: d.type as SolicitationType,
      solicitationNumber: d.solicitationNumber,
      naicsCode: d.naicsCode,
      setAside: d.setAside,
      responseDueDate: d.responseDueDate ? new Date(d.responseDueDate) : null,
      sectionLSummary: d.sectionLSummary,
      sectionMSummary: d.sectionMSummary,
      extractedRequirements: d.requirements,
      keyDates: (d.keyDates ?? []) as SolicitationKeyDate[],
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(solicitations.organizationId, organizationId),
        eq(solicitations.id, solicitationId),
      ),
    );
  // BL-AIP-5 — a re-parse used to overwrite the list and lose every
  // companion document's clauses; roll them back in.
  try {
    await mergeSolicitationRequirements(solicitationId, organizationId);
  } catch (err) {
    log.warn("[parseSolicitationFromBytes]", "companion merge failed", { error: err });
  }
  revalidatePath(`/solicitations/${solicitationId}`);
}

async function getFileMeta(
  id: string,
  organizationId: string,
): Promise<{ fileName: string; contentType: string }> {
  const [row] = await db
    .select({
      fileName: solicitations.fileName,
      contentType: solicitations.contentType,
    })
    .from(solicitations)
    .where(and(eq(solicitations.id, id), eq(solicitations.organizationId, organizationId)))
    .limit(1);
  return {
    fileName: row?.fileName ?? "",
    contentType: row?.contentType ?? "",
  };
}

export function stripExt(name: string): string {
  return name.replace(/\.[^./]+$/, "");
}

/**
 * Reconstructs a usable rawText string from AI-extracted structured fields.
 * Used for vision-OCR paths (image uploads, scanned PDFs) where no text
 * layer exists — the review action requires non-empty rawText to run.
 */
export function buildRawTextFromExtraction(d: {
  title: string;
  agency: string;
  office: string;
  solicitationNumber: string;
  type: string;
  naicsCode: string;
  setAside: string;
  responseDueDate: string | null;
  sectionLSummary: string;
  sectionMSummary: string;
  requirements: { kind: string; text: string; ref: string }[];
}): string {
  const header = [
    d.title && `TITLE: ${d.title}`,
    d.agency && `AGENCY: ${d.agency}`,
    d.office && `OFFICE: ${d.office}`,
    d.solicitationNumber && `SOLICITATION NUMBER: ${d.solicitationNumber}`,
    d.type && `TYPE: ${d.type.toUpperCase()}`,
    d.naicsCode && `NAICS: ${d.naicsCode}`,
    d.setAside && `SET-ASIDE: ${d.setAside}`,
    d.responseDueDate && `DUE DATE: ${d.responseDueDate}`,
  ]
    .filter(Boolean)
    .join("\n");

  const sections = [
    d.sectionLSummary && `SECTION L (Instructions to Offerors):\n${d.sectionLSummary}`,
    d.sectionMSummary && `SECTION M (Evaluation Criteria):\n${d.sectionMSummary}`,
    d.requirements.length > 0 &&
      `REQUIREMENTS:\n${d.requirements
        .map((r, i) => `${i + 1}. [${r.ref || "?"}] ${r.kind.toUpperCase()}: ${r.text}`)
        .join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return [header, sections].filter(Boolean).join("\n\n");
}
