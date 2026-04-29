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
  buildSolicitationExtractPrompt,
  buildSolicitationVisionPrompt,
  type SolicitationExtractionResult,
} from "@/lib/ai-prompts";
import { complete, getAIProviderStatus, type AIDocumentMedia } from "@/lib/ai";
import {
  detectFormat,
  extractTextFromDocx,
  extractTextFromPlainText,
  extractTextFromPptx,
  extractTextFromXlsx,
  type ExtractFormat,
} from "@/lib/text-extract";

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

export async function aiExtractSolicitation(
  rawText: string,
): Promise<{ ok: true; data: SolicitationExtractionResult; provider: string; model: string; stubbed: boolean } | { ok: false; error: string }> {
  if (!rawText.trim()) return { ok: false, error: "No text extracted from the file." };
  try {
    const prompt = buildSolicitationExtractPrompt(rawText);
    const ai = await complete({
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
        },
      };
    }

    // Strip code-fences if the model decided to wrap the JSON.
    const cleaned = stripCodeFences(ai.text);
    const parsed = JSON.parse(cleaned) as SolicitationExtractionResult;

    return {
      ok: true,
      provider: ai.provider,
      model: ai.model,
      stubbed: false,
      data: normalizeExtraction(parsed),
    };
  } catch (err) {
    console.error("[aiExtractSolicitation]", err);
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
    const ai = await complete({
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
    const cleaned = stripCodeFences(ai.text);
    const parsed = JSON.parse(cleaned) as SolicitationExtractionResult;
    return {
      ok: true,
      provider: ai.provider,
      model: ai.model,
      stubbed: false,
      data: normalizeExtraction(parsed),
    };
  } catch (err) {
    console.error("[aiExtractSolicitationFromPdf]", err);
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
    const ai = await complete({
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
    const cleaned = stripCodeFences(ai.text);
    const parsed = JSON.parse(cleaned) as SolicitationExtractionResult;
    return {
      ok: true,
      provider: ai.provider,
      model: ai.model,
      stubbed: false,
      data: normalizeExtraction(parsed),
    };
  } catch (err) {
    console.error("[aiExtractSolicitationFromImage]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Image vision failed.",
    };
  }
}

function stripCodeFences(text: string): string {
  const t = text.trim();
  if (t.startsWith("```")) {
    const without = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    return without.trim();
  }
  return t;
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
        .slice(0, 50)
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
  };
}
