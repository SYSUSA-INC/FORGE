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
  choiceOf,
  KEY_DATE_TYPES,
  requirementsChunkSchema,
  SOLICITATION_TYPES,
  solicitationExtractionSchema,
  solicitationFrontMatterSchema,
  type SolicitationExtractionAnswer,
  type SolicitationExtractionResult,
} from "@/lib/ai-prompts";
import {
  completeStructuredForTenant,
  getAIProviderStatus,
  type AIDocumentMedia,
} from "@/lib/ai";
import { isTruncatedStop } from "@/lib/ai-stop";
import { coverageFromSweep, type ExtractionCoverage } from "@/lib/extraction-coverage";
import {
  mergeRequirementLists,
  normalizeRequirementList,
  requirementKindOf,
  type RequirementLike,
} from "@/lib/requirements-text";
import { attachProvenance, pageStartsFromLengths } from "@/lib/requirement-provenance";
import { planSweepWindows, segmentSolicitation } from "@/lib/solicitation-segments";
import { extractLmStructure } from "@/lib/solicitation-lm-extract";
import type { LmStructure } from "@/lib/solicitation-lm";
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
  return (await extractPdfText(bytes)).text;
}

type PdfTextItem = { str: string; transform: number[] };
type PdfPage = { pageNumber: number; getTextContent(options: object): Promise<{ items: PdfTextItem[] }> };
type PdfParse = (b: Buffer, options?: { pagerender?: (page: PdfPage) => Promise<string> }) => Promise<{ text?: string; numrender?: number }>;

/**
 * pdf-parse's own page renderer, unchanged, so the text is exactly what
 * it has always produced: items on one baseline joined, a new line when
 * the baseline moves.
 */
async function renderPdfPage(page: PdfPage): Promise<string> {
  const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
  let lastY: number | undefined;
  let text = "";
  for (const item of content.items) {
    text += lastY === item.transform[5] || !lastY ? item.str : `\n${item.str}`;
    lastY = item.transform[5];
  }
  return text;
}

/**
 * BL-AIX Phase 2a — the PDF's text and where each page starts in it, so
 * a requirement can be traced to its page. The text is unchanged.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pageStarts: number[] }> {
  // pdf-parse-fork is a CommonJS module that exports a function. Different
  // bundlers wrap it differently; pick the callable form regardless.
  const mod = (await import("pdf-parse-fork")) as unknown;
  const candidate =
    typeof mod === "function"
      ? (mod as PdfParse)
      : ((mod as { default?: PdfParse }).default ?? ((mod as unknown) as PdfParse));
  const lengths: number[] = [];
  const result = await candidate(Buffer.from(bytes), {
    pagerender: async (page) => {
      const text = await renderPdfPage(page);
      lengths[page.pageNumber - 1] = text.length;
      return text;
    },
  });
  const raw = result?.text ?? "";
  const text = raw.trim();
  const leadingTrim = raw.length - raw.trimStart().length;
  // A page that failed to render contributes "" and never reached pagerender.
  const pages = Array.from({ length: Math.max(result?.numrender ?? 0, lengths.length) }, (_, i) => lengths[i] ?? 0);
  const pageStarts = pageStartsFromLengths(pages, leadingTrim).map((n) => Math.min(n, text.length));
  return { text, pageStarts };
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
): Promise<{ format: ExtractFormat | null; text: string; pageStarts?: number[] }> {
  const format = detectFormat(contentType, fileName);
  if (!format) return { format: null, text: "" };

  switch (format) {
    case "pdf":
      return { format, ...(await extractPdfText(bytes)) };
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
  /** BL-AIX Phase 0d — what the windows covered, and requirements before the cap. */
  readChars: number;
  totalChars: number;
  found: number;
  /** Windows that hit the output ceiling and were split and re-read. */
  splitChunks: number;
  stubbed: boolean;
  /** Why the last failed window failed, when one did. */
  lastError?: string;
};

/**
 * BL-AIP-5 — read the WHOLE document for requirements, one window at a
 * time, and merge the windows' lists without duplicates. A window whose
 * answer hit the output ceiling (`stopReason`) or failed to validate is
 * split in two and re-read once (or, when too short to split, read once
 * more); a window that still fails is counted and skipped rather than
 * failing the document.
 */
/**
 * BL-AIX Phase 1e-3 — one window of the requirement sweep, exported so the
 * gold-set accuracy run reads a document exactly as intake does. A window
 * whose answer hit the output ceiling or failed to validate is split in
 * two and re-read once, or read once more when shorter than
 * MIN_SPLIT_CHARS; `list` is null when it still fails.
 */
export async function readRequirementsWindow(input: {
  organizationId: string;
  text: string;
  index: number;
  count: number;
  documentLabel: string;
  /** BL-AIX Phase 2a — the part(s) of the document the window holds. */
  partLabel?: string;
  depth?: number;
  /** BL-AIX Phase 1i-2 — pin a candidate model (eval runs); unset follows routing. */
  model?: string;
  /** BL-STAB-1 — this is the second read of a window too short to split. */
  retry?: boolean;
}): Promise<{ list: RequirementLike[] | null; stubbed: boolean; split: number; error?: string }> {
  const { organizationId, text, index, count } = input;
  const depth = input.depth ?? 0;
  const prompt = buildRequirementsChunkPrompt({
    chunkText: text,
    chunkIndex: index,
    chunkCount: count,
    documentLabel: input.documentLabel,
    partLabel: input.partLabel,
  });
  const res = await completeStructuredForTenant({
    organizationId,
    feature: "solicitation_extract",
    variant: input.retry ? "requirements_chunk_retry" : depth === 0 ? "requirements_chunk" : "requirements_chunk_split",
    model: input.model || undefined,
    schema: requirementsChunkSchema,
    toolName: "record_requirements",
    toolDescription: "Record every requirement found in this window of the document.",
    system: prompt.system,
    messages: prompt.messages,
    maxTokens: CHUNK_MAX_TOKENS,
    temperature: 0,
    cacheSystem: true,
  });
  if (res.stubbed) return { list: [], stubbed: true, split: 0 };
  const truncated = isTruncatedStop(res.stopReason);
  if (res.data && !truncated) {
    return { list: normalizeRequirementList(res.data.requirements, { maxItems: REQUIREMENTS_PER_CHUNK }), stubbed: false, split: 0 };
  }
  // Too much for one answer, or unparseable: halve the window and try
  // each half once. Keep whatever validated from the long answer as a
  // floor so a split that also fails still yields something.
  let split = 0;
  if (depth === 0 && text.length >= MIN_SPLIT_CHARS) {
    split = 1;
    const mid = Math.floor(text.length / 2);
    const cut = text.lastIndexOf("\n", mid);
    const at = cut > text.length * 0.3 ? cut : mid;
    const [a, b] = await Promise.all([
      readRequirementsWindow({ ...input, text: text.slice(0, at), depth: 1 }),
      readRequirementsWindow({ ...input, text: text.slice(at), depth: 1 }),
    ]);
    const merged = mergeRequirementLists([a.list ?? [], b.list ?? []]);
    if (merged.length > 0 || (a.list && b.list)) return { list: merged, stubbed: a.stubbed || b.stubbed, split };
  }
  if (res.data) {
    // Truncated but parseable: partial list is better than none.
    return { list: normalizeRequirementList(res.data.requirements, { maxItems: REQUIREMENTS_PER_CHUNK }), stubbed: false, split };
  }
  // BL-STAB-1 — a window too short to split is read once more: an
  // unreadable answer is usually a one-off, and for a short document this
  // window is all the sweep has.
  if (depth === 0 && !input.retry && text.length < MIN_SPLIT_CHARS) {
    return readRequirementsWindow({ ...input, retry: true });
  }
  log.warn("[extractRequirementsFullText]", "window failed", {
    index,
    depth,
    parseError: res.parseError,
    stopReason: res.stopReason,
  });
  return { list: null, stubbed: false, split, error: res.parseError ?? `stopped: ${res.stopReason ?? "unknown"}` };
}

export async function extractRequirementsFullText(
  organizationId: string,
  rawText: string,
  options?: { documentLabel?: string },
): Promise<FullTextRequirementsResult> {
  // BL-AIX Phase 2a — windows follow the document's parts and say which.
  const chunks = planSweepWindows(rawText);
  const label = options?.documentLabel ?? "solicitation";
  const lists: RequirementLike[][] = [];
  let failedChunks = 0;
  let splitChunks = 0;
  let stubbed = false;
  let lastError: string | undefined;

  for (const chunk of chunks) {
    if (stubbed) break;
    try {
      const read = await readRequirementsWindow({
        organizationId,
        text: chunk.text,
        index: chunk.index,
        count: chunks.length,
        documentLabel: label,
        partLabel: chunk.label,
      });
      stubbed = stubbed || read.stubbed;
      splitChunks += read.split;
      if (read.list === null) {
        failedChunks += 1;
        lastError = read.error;
      } else if (!read.stubbed) lists.push(read.list);
    } catch (err) {
      failedChunks += 1;
      lastError = err instanceof Error ? err.message : String(err);
      log.warn("[extractRequirementsFullText]", "window threw", { error: err, index: chunk.index });
    }
  }

  const merged = mergeRequirementLists(lists);
  return {
    requirements: merged.slice(0, MAX_REQUIREMENTS_PER_DOCUMENT),
    found: merged.length,
    readChars: chunks.length > 0 ? chunks[chunks.length - 1]!.end : 0,
    totalChars: rawText.length,
    chunks: chunks.length,
    failedChunks,
    splitChunks,
    stubbed,
    ...(lastError ? { lastError } : {}),
  };
}

export async function aiExtractSolicitation(
  organizationId: string,
  rawText: string,
  options?: { documentLabel?: string; pageStarts?: number[] },
): Promise<
  | {
      ok: true;
      data: SolicitationExtractionResult;
      provider: string;
      model: string;
      stubbed: boolean;
      coverage?: ExtractionCoverage;
      /** BL-AIX Phase 2b — Sections L and M as structured data, when found. */
      lm?: LmStructure;
    }
  | { ok: false; error: string }
> {
  if (!rawText.trim()) return { ok: false, error: "No text extracted from the file." };
  try {
    const prompt = buildSolicitationExtractPrompt(rawText);
    const ai = await completeStructuredForTenant({
      organizationId,
      feature: "solicitation_extract",
      variant: "text",
      schema: solicitationFrontMatterSchema,
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
      return {
        ok: false,
        error: ai.parseError ?? "AI response did not match the expected shape.",
      };
    }

    const data = normalizeExtraction(ai.data);

    // BL-AIP-5 / BL-STAB-1 — the requirements come from the sweep alone:
    // it reads every window of the document (the front matter above sees
    // the first 80k characters), and a window that fails is split and
    // re-read on its own instead of sinking the whole parse.
    const sweep = await extractRequirementsFullText(organizationId, rawText, {
      documentLabel: options?.documentLabel ?? data.title,
    });
    let coverage: ExtractionCoverage | undefined;
    if (!sweep.stubbed) {
      // Every window failing is a failed read, not a document without
      // requirements; say so rather than store an empty list as parsed.
      if (sweep.chunks > 0 && sweep.failedChunks === sweep.chunks) {
        return {
          ok: false,
          error: `Couldn't read the requirements from any part of the document${sweep.lastError ? ` (${sweep.lastError})` : ""}. Re-parse to try again.`,
        };
      }
      data.requirements = sweep.requirements;
      coverage = coverageFromSweep({
        totalChars: sweep.totalChars,
        readChars: sweep.readChars,
        windows: sweep.chunks,
        failedWindows: sweep.failedChunks,
        requirementsFound: sweep.found,
        requirementsKept: data.requirements.length,
      });
    }
    log.info("[aiExtractSolicitation]", "requirement sweep", {
      chunks: sweep.chunks,
      failedChunks: sweep.failedChunks,
      splitChunks: sweep.splitChunks,
      kept: data.requirements.length,
    });

    // BL-AIX Phase 2a — find each requirement in the text: its page, part
    // and paragraph, and whether the document says it word for word.
    const segments = segmentSolicitation(rawText);
    const located = attachProvenance(rawText, data.requirements, { pageStarts: options?.pageStarts, segments });
    data.requirements = located.requirements;
    coverage = {
      ...(coverage ?? {}),
      quotes: located.counts,
      parts: segments.filter((g) => g.kind !== "front").map((g) => g.key),
    };

    // BL-AIX Phase 2b — Sections L and M, read on their own. Never fails the parse.
    let lm: LmStructure | undefined;
    try {
      const read = await extractLmStructure({
        organizationId,
        rawText,
        documentLabel: options?.documentLabel ?? data.title,
        pageStarts: options?.pageStarts,
        segments,
      });
      if (!read.stubbed) lm = read.structure;
    } catch (err) {
      log.warn("[aiExtractSolicitation]", "Section L/M pass failed", { error: err });
    }

    return {
      ok: true,
      provider: ai.provider,
      model: ai.model,
      stubbed: false,
      data,
      coverage,
      lm,
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

/**
 * Clamp a validated answer to the lengths the columns hold, map the kinds
 * and types the model wrote in its own words to the allowed values, keep
 * dates that are real YYYY-MM-DD dates, and drop the entries the schema
 * could not read (null) or that came back empty.
 */
function normalizeExtraction(raw: SolicitationExtractionAnswer | Omit<SolicitationExtractionAnswer, "requirements">): SolicitationExtractionResult {
  const isoDay = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
  const requirements = ("requirements" in raw ? raw.requirements : [])
    .filter((r) => r !== null)
    .map((r) => ({ kind: requirementKindOf(r.kind), text: r.text.slice(0, 500), ref: r.ref.slice(0, 64) }))
    .filter((r) => r.text.trim().length > 0)
    .slice(0, MAX_REQUIREMENTS_PER_DOCUMENT);
  const keyDates = raw.keyDates
    .filter((kd) => kd !== null)
    .map((kd) => ({ label: kd.label.slice(0, 128), isoDate: isoDay(kd.isoDate), type: choiceOf(KEY_DATE_TYPES, kd.type, "other") }))
    .filter((kd) => kd.label.trim().length > 0)
    .slice(0, 20);

  return {
    title: raw.title.slice(0, 256),
    agency: raw.agency.slice(0, 256),
    office: raw.office.slice(0, 256),
    solicitationNumber: raw.solicitationNumber.slice(0, 128),
    type: choiceOf(SOLICITATION_TYPES, raw.type, "other"),
    naicsCode: raw.naicsCode.slice(0, 16),
    setAside: raw.setAside.slice(0, 64),
    responseDueDate: isoDay(raw.responseDueDate),
    sectionLSummary: raw.sectionLSummary.slice(0, 2000),
    sectionMSummary: raw.sectionMSummary.slice(0, 2000),
    requirements,
    keyDates,
  };
}
