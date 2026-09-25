/**
 * Solicitation extraction pipeline.
 *
 *   bytes (PDF/DOCX/XLSX/PPTX/image/text) → text → AI gateway → structured JSON
 *
 * The text extraction step dispatches by file format. PDFs use
 * pdf-parse-fork with a vision-OCR fallback for scans. DOCX uses
 * mammoth, XLSX uses exceljs, PPTX is parsed as zipped XML, images
 * route straight to vision OCR via the AI gateway.
 */
import {
  buildRequirementsChunkPrompt,
  buildSolicitationExtractPrompt,
  buildSolicitationVisionPrompt,
  requirementsChunkSchema,
  solicitationExtractionSchema,
  type SolicitationExtractionResult,
} from "@/lib/ai-prompts";
import {
  completeStructuredForTenant,
  getAIProviderStatus,
  type AIDocumentMedia,
} from "@/lib/ai";
import { isTruncatedStop } from "@/lib/ai-stop";
import {
  chunkText,
  mergeRequirementLists,
  normalizeRequirementList,
  type RequirementLike,
} from "@/lib/requirements-text";
import {
  detectFormat,
  extractTextFromDocx,
  extractTextFromPlainText,
  extractTextFromPptx,
  extractTextFromXlsx,
  type ExtractFormat,
} from "@/lib/text-extract";
import { log } from "@/lib/log";

export async function extractTextFromPdf(bytes: Uint8Array): Promise<string> {
  // pdf-parse-fork is a CommonJS module that exports a function. Different
  // bundlers wrap it differently; pick the callable form regardless.
  const mod = (await import("pdf-parse-fork")) as unknown;
  const candidate =
    typeof mod === "function"
      ? (mod as (b: Buffer) => Promise<{ text?: string }>)
      : ((mod as { default?: (b: Buffer) => Promise<{ text?: string }> })
          .default ??
        ((mod as unknown) as (b: Buffer) => Promise<{ text?: string }>));
  const buf = Buffer.from(bytes);
  const result = await candidate(buf);
  return (result?.text ?? "").trim();
}

/**
 * Format-aware text extraction. Returns the format we used so callers
 * can branch (e.g. images skip the cheap-text path and go straight to
 * vision OCR).
 */
export async function extractTextFromAny(
  bytes: Uint8Array,
  contentType: string,
  fileName: string,
): Promise<{ format: ExtractFormat | null; text: string }> {
  const format = detectFormat(contentType, fileName);
  if (!format) return { format: null, text: "" };

  switch (format) {
    case "pdf":
      return { format, text: await extractTextFromPdf(bytes) };
    case "docx":
      return { format, text: await extractTextFromDocx(bytes) };
    case "xlsx":
      return { format, text: await extractTextFromXlsx(bytes) };
    case "pptx":
      return { format, text: await extractTextFromPptx(bytes) };
    case "text":
      return { format, text: await extractTextFromPlainText(bytes) };
    case "image":
      // Images skip text extraction — caller should route to vision.
      return { format, text: "" };
  }
}

/** Ceiling on requirements kept from one document after the sweep. */
export const MAX_REQUIREMENTS_PER_DOCUMENT = 400;
const REQUIREMENTS_PER_CHUNK = 150;
const CHUNK_MAX_TOKENS = 4000;
/** Below this a failed window is not split again. */
const MIN_SPLIT_CHARS = 8_000;

export type FullTextRequirementsResult = {
  requirements: RequirementLike[];
  chunks: number;
  failedChunks: number;
  /** Windows that hit the output ceiling and were split and re-read. */
  splitChunks: number;
  stubbed: boolean;
};

/**
 * BL-AIP-5 — read the WHOLE document for requirements, one window at a
 * time, and merge the windows' lists without duplicates. A window whose
 * answer hit the output ceiling (`stopReason`) or failed to validate is
 * split in two and re-read once; a window that still fails is counted
 * and skipped rather than failing the document.
 */
export async function extractRequirementsFullText(
  organizationId: string,
  rawText: string,
  options?: { documentLabel?: string },
): Promise<FullTextRequirementsResult> {
  const chunks = chunkText(rawText);
  const label = options?.documentLabel ?? "solicitation";
  const lists: RequirementLike[][] = [];
  let failedChunks = 0;
  let splitChunks = 0;
  let stubbed = false;

  const readWindow = async (
    text: string,
    index: number,
    count: number,
    depth: number,
  ): Promise<RequirementLike[] | null> => {
    const prompt = buildRequirementsChunkPrompt({
      chunkText: text,
      chunkIndex: index,
      chunkCount: count,
      documentLabel: label,
    });
    const res = await completeStructuredForTenant({
      organizationId,
      feature: "solicitation_extract",
      variant: depth === 0 ? "requirements_chunk" : "requirements_chunk_split",
      schema: requirementsChunkSchema,
      toolName: "record_requirements",
      toolDescription: "Record every requirement found in this window of the document.",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: CHUNK_MAX_TOKENS,
      temperature: 0,
      cacheSystem: true,
    });
    if (res.stubbed) {
      stubbed = true;
      return [];
    }
    const truncated = isTruncatedStop(res.stopReason);
    if (res.data && !truncated) {
      return normalizeRequirementList(res.data.requirements, { maxItems: REQUIREMENTS_PER_CHUNK });
    }
    // Too much for one answer, or unparseable: halve the window and try
    // each half once. Keep whatever validated from the long answer as a
    // floor so a split that also fails still yields something.
    if (depth === 0 && text.length >= MIN_SPLIT_CHARS) {
      splitChunks += 1;
      const mid = Math.floor(text.length / 2);
      const cut = text.lastIndexOf("\n", mid);
      const at = cut > text.length * 0.3 ? cut : mid;
      const [a, b] = await Promise.all([
        readWindow(text.slice(0, at), index, count, 1),
        readWindow(text.slice(at), index, count, 1),
      ]);
      const parts = [a ?? [], b ?? []];
      const merged = mergeRequirementLists(parts);
      if (merged.length > 0 || (a && b)) return merged;
    }
    if (res.data) {
      // Truncated but parseable: partial list is better than none.
      return normalizeRequirementList(res.data.requirements, { maxItems: REQUIREMENTS_PER_CHUNK });
    }
    log.warn("[extractRequirementsFullText]", "window failed", {
      index,
      depth,
      parseError: res.parseError,
      stopReason: res.stopReason,
    });
    return null;
  };

  for (const chunk of chunks) {
    if (stubbed) break;
    try {
      const list = await readWindow(chunk.text, chunk.index, chunks.length, 0);
      if (list === null) failedChunks += 1;
      else lists.push(list);
    } catch (err) {
      failedChunks += 1;
      log.warn("[extractRequirementsFullText]", "window threw", { error: err, index: chunk.index });
    }
  }

  return {
    requirements: mergeRequirementLists(lists).slice(0, MAX_REQUIREMENTS_PER_DOCUMENT),
    chunks: chunks.length,
    failedChunks,
    splitChunks,
    stubbed,
  };
}

export async function aiExtractSolicitation(
  organizationId: string,
  rawText: string,
  options?: { documentLabel?: string },
): Promise<{ ok: true; data: SolicitationExtractionResult; provider: string; model: string; stubbed: boolean } | { ok: false; error: string }> {
  if (!rawText.trim()) return { ok: false, error: "No text extracted from the file." };
  try {
    const prompt = buildSolicitationExtractPrompt(rawText);
    const ai = await completeStructuredForTenant({
      organizationId,
      feature: "solicitation_extract",
      variant: "text",
      schema: solicitationExtractionSchema,
      toolName: "record_solicitation",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 2400,
      temperature: 0.1,
      cacheSystem: true,
    });

    if (ai.stubbed) {
      // Stub-mode: return a deterministic empty payload so the UI shows
      // the file uploaded but no AI fields populated. User can flip to
      // live AI by setting ANTHROPIC_API_KEY.
      return {
        ok: true,
        provider: ai.provider,
        model: ai.model,
        stubbed: true,
        data: {
          title: "",
          agency: "",
          office: "",
          solicitationNumber: "",
          type: "other",
          naicsCode: "",
          setAside: "",
          responseDueDate: null,
          sectionLSummary:
            "AI extraction is in stub mode. Set ANTHROPIC_API_KEY on Vercel to enable live extraction.",
          sectionMSummary: "",
          requirements: [],
          keyDates: [],
        },
      };
    }

    if (!ai.data) {
      log.error("[aiExtractSolicitation]", "parse", {
        error: ai.parseError,
        viaTool: ai.viaTool,
      });
      return {
        ok: false,
        error: ai.parseError ?? "AI response did not match the expected shape.",
      };
    }

    const data = normalizeExtraction(ai.data);

    // BL-AIP-5 — the front-matter pass above sees the first 80k
    // characters and returns a ranked sample. The sweep reads every
    // window of the document; its list replaces the sample whenever it
    // found at least as much, so a PWS on page 140 reaches the matrix.
    try {
      const sweep = await extractRequirementsFullText(organizationId, rawText, {
        documentLabel: options?.documentLabel ?? data.title,
      });
      if (!sweep.stubbed && sweep.requirements.length >= data.requirements.length) {
        data.requirements = sweep.requirements;
      }
      log.info("[aiExtractSolicitation]", "requirement sweep", {
        chunks: sweep.chunks,
        failedChunks: sweep.failedChunks,
        splitChunks: sweep.splitChunks,
        fromSweep: sweep.requirements.length,
        kept: data.requirements.length,
      });
    } catch (err) {
      log.warn("[aiExtractSolicitation]", "requirement sweep failed; keeping front-matter list", {
        error: err,
      });
    }

    return {
      ok: true,
      provider: ai.provider,
      model: ai.model,
      stubbed: false,
      data,
    };
  } catch (err) {
    log.error("[aiExtractSolicitation]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "AI extraction failed.",
    };
  }
}

/**
 * Vision fallback for scanned-image / unreadable PDFs. Attaches the PDF
 * directly to the prompt and lets the model OCR + extract in one pass.
 *
 * Only Anthropic accepts inline PDF documents today. If the configured
 * provider isn't Anthropic, we fail with a clear error so the caller
 * can surface "OCR needs Anthropic; configure ANTHROPIC_API_KEY".
 */
export async function aiExtractSolicitationFromPdf(
  organizationId: string,
  bytes: Uint8Array,
  fileName: string,
): Promise<
  | { ok: true; data: SolicitationExtractionResult; provider: string; model: string; stubbed: boolean }
  | { ok: false; error: string }
> {
  const status = getAIProviderStatus();
  if (status.active.name !== "anthropic") {
    return {
      ok: false,
      error:
        status.active.name === "stub"
          ? "Vision OCR needs a real AI provider. Set ANTHROPIC_API_KEY to enable scanned-PDF intake."
          : `Vision OCR currently requires Anthropic; active provider is ${status.active.name}.`,
    };
  }
  // Anthropic caps document blocks at 32 MB on the wire (base64 inflates
  // ~33%). Refuse early to avoid a confusing 400 from upstream.
  const RAW_LIMIT = 24 * 1024 * 1024;
  if (bytes.byteLength > RAW_LIMIT) {
    return {
      ok: false,
      error: `Scanned PDF is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB — vision OCR caps at ${RAW_LIMIT / 1024 / 1024} MB. Split the document and re-upload.`,
    };
  }

  try {
    const prompt = buildSolicitationVisionPrompt();
    const ai = await completeStructuredForTenant({
      organizationId,
      feature: "solicitation_extract",
      variant: "pdf_vision",
      schema: solicitationExtractionSchema,
      toolName: "record_solicitation",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 2400,
      temperature: 0.1,
      cacheSystem: true,
      documents: [
        { name: fileName, mediaType: "application/pdf", bytes },
      ],
    });
    if (ai.stubbed) {
      // Shouldn't happen given the provider check above, but stay safe.
      return { ok: false, error: "AI provider unexpectedly returned stub mode." };
    }
    if (!ai.data) {
      log.error("[aiExtractSolicitationFromPdf]", "parse", {
        error: ai.parseError,
        viaTool: ai.viaTool,
      });
      return {
        ok: false,
        error: ai.parseError ?? "AI response did not match the expected shape.",
      };
    }
    return {
      ok: true,
      provider: ai.provider,
      model: ai.model,
      stubbed: false,
      data: normalizeExtraction(ai.data),
    };
  } catch (err) {
    log.error("[aiExtractSolicitationFromPdf]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Vision OCR failed.",
    };
  }
}

/**
 * Vision pass for image uploads (jpeg/png/webp/gif). Mirrors the PDF
 * vision path but emits an image content block instead of a document
 * block. Useful for one-pagers, scanned cover sheets, or photographs
 * of printed RFQs.
 */
export async function aiExtractSolicitationFromImage(
  organizationId: string,
  bytes: Uint8Array,
  fileName: string,
  mediaType: AIDocumentMedia,
): Promise<
  | { ok: true; data: SolicitationExtractionResult; provider: string; model: string; stubbed: boolean }
  | { ok: false; error: string }
> {
  const status = getAIProviderStatus();
  if (status.active.name !== "anthropic") {
    return {
      ok: false,
      error:
        status.active.name === "stub"
          ? "Image vision needs a real AI provider. Set ANTHROPIC_API_KEY to enable image intake."
          : `Image vision currently requires Anthropic; active provider is ${status.active.name}.`,
    };
  }
  // Anthropic caps image content blocks at 5 MB on the wire.
  const RAW_LIMIT = 5 * 1024 * 1024;
  if (bytes.byteLength > RAW_LIMIT) {
    return {
      ok: false,
      error: `Image is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB — vision caps at ${RAW_LIMIT / 1024 / 1024} MB. Compress or shrink before re-uploading.`,
    };
  }

  try {
    const prompt = buildSolicitationVisionPrompt();
    const ai = await completeStructuredForTenant({
      organizationId,
      feature: "solicitation_extract",
      variant: "image_vision",
      schema: solicitationExtractionSchema,
      toolName: "record_solicitation",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 2400,
      temperature: 0.1,
      cacheSystem: true,
      documents: [{ name: fileName, mediaType, bytes }],
    });
    if (ai.stubbed) {
      return { ok: false, error: "AI provider unexpectedly returned stub mode." };
    }
    if (!ai.data) {
      log.error("[aiExtractSolicitationVision]", "parse", {
        error: ai.parseError,
        viaTool: ai.viaTool,
      });
      return {
        ok: false,
        error: ai.parseError ?? "AI response did not match the expected shape.",
      };
    }
    return {
      ok: true,
      provider: ai.provider,
      model: ai.model,
      stubbed: false,
      data: normalizeExtraction(ai.data),
    };
  } catch (err) {
    log.error("[aiExtractSolicitationFromImage]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Image vision failed.",
    };
  }
}

function normalizeExtraction(
  raw: Partial<SolicitationExtractionResult>,
): SolicitationExtractionResult {
  const allowedTypes = ["rfp", "rfi", "rfq", "sources_sought", "other"] as const;
  const allowedKinds = ["shall", "should", "may"] as const;
  const type = allowedTypes.includes(raw.type as (typeof allowedTypes)[number])
    ? (raw.type as (typeof allowedTypes)[number])
    : "other";
  const requirements = Array.isArray(raw.requirements)
    ? raw.requirements
        .filter((r) => r && typeof r === "object")
        .map((r) => ({
          kind: allowedKinds.includes(r.kind as (typeof allowedKinds)[number])
            ? (r.kind as (typeof allowedKinds)[number])
            : "shall",
          text: typeof r.text === "string" ? r.text.slice(0, 500) : "",
          ref: typeof r.ref === "string" ? r.ref.slice(0, 64) : "",
        }))
        .filter((r) => r.text.trim().length > 0)
        .slice(0, MAX_REQUIREMENTS_PER_DOCUMENT)
    : [];
  const allowedKeyDateTypes = [
    "qa_cutoff",
    "site_visit",
    "final_rfp",
    "proposal_due",
    "oral_presentation",
    "expected_award",
    "debrief_window",
    "protest_window",
    "other",
  ] as const;
  const keyDates = Array.isArray(raw.keyDates)
    ? raw.keyDates
        .filter((kd) => kd && typeof kd === "object" && typeof kd.label === "string")
        .map((kd) => ({
          label: (kd.label as string).slice(0, 128),
          isoDate:
            typeof kd.isoDate === "string" && kd.isoDate.match(/^\d{4}-\d{2}-\d{2}/)
              ? kd.isoDate.slice(0, 10)
              : null,
          type: allowedKeyDateTypes.includes(kd.type as (typeof allowedKeyDateTypes)[number])
            ? (kd.type as (typeof allowedKeyDateTypes)[number])
            : "other",
        }))
        .filter((kd) => kd.label.trim().length > 0)
        .slice(0, 20)
    : [];

  return {
    title: typeof raw.title === "string" ? raw.title.slice(0, 256) : "",
    agency: typeof raw.agency === "string" ? raw.agency.slice(0, 256) : "",
    office: typeof raw.office === "string" ? raw.office.slice(0, 256) : "",
    solicitationNumber:
      typeof raw.solicitationNumber === "string"
        ? raw.solicitationNumber.slice(0, 128)
        : "",
    type,
    naicsCode: typeof raw.naicsCode === "string" ? raw.naicsCode.slice(0, 16) : "",
    setAside: typeof raw.setAside === "string" ? raw.setAside.slice(0, 64) : "",
    responseDueDate:
      typeof raw.responseDueDate === "string" && raw.responseDueDate.match(/^\d{4}-\d{2}-\d{2}/)
        ? raw.responseDueDate.slice(0, 10)
        : null,
    sectionLSummary:
      typeof raw.sectionLSummary === "string"
        ? raw.sectionLSummary.slice(0, 2000)
        : "",
    sectionMSummary:
      typeof raw.sectionMSummary === "string"
        ? raw.sectionMSummary.slice(0, 2000)
        : "",
    requirements,
    keyDates,
  };
}
