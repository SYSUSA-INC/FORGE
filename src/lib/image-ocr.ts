/**
 * Generic image-to-text OCR via the AI gateway's vision support.
 *
 * Used for knowledge corpus artifacts that come in as images
 * (capability briefs, scanned cover sheets, photos of whiteboards,
 * decks exported as PNGs). Different from
 * aiExtractSolicitationFromImage — that extracts structured RFP
 * fields. This one just returns plain text the corpus can index +
 * Brain Extraction can mine.
 *
 * Anthropic-only at the moment; falls back to a clear error in
 * stub or non-Anthropic mode.
 */
import { completeForTenant, getAIProviderStatus, type AIDocumentMedia } from "@/lib/ai";
import { buildImageOcrPrompt } from "@/lib/ai-prompts";
import { log } from "@/lib/log";

export type ImageOcrResult =
  | {
      ok: true;
      text: string;
      provider: string;
      model: string;
      stubbed: boolean;
    }
  | { ok: false; error: string };

export async function extractTextFromImageViaVision(input: {
  organizationId: string;
  bytes: Uint8Array;
  mediaType: AIDocumentMedia;
  fileName: string;
}): Promise<ImageOcrResult> {
  const status = getAIProviderStatus();
  if (status.active.name !== "anthropic") {
    return {
      ok: false,
      error:
        status.active.name === "stub"
          ? "Vision OCR needs a real AI provider. Set ANTHROPIC_API_KEY to enable image intake."
          : `Vision OCR currently requires Anthropic; active provider is ${status.active.name}.`,
    };
  }

  // Anthropic image content blocks cap at 5 MB on the wire.
  const RAW_LIMIT = 5 * 1024 * 1024;
  if (input.bytes.byteLength > RAW_LIMIT) {
    return {
      ok: false,
      error: `Image is ${(input.bytes.byteLength / 1024 / 1024).toFixed(1)} MB — vision caps at ${RAW_LIMIT / 1024 / 1024} MB. Compress or shrink before re-uploading.`,
    };
  }

  try {
    const ai = await completeForTenant({
      organizationId: input.organizationId,
      feature: "image_ocr",
      ...buildImageOcrPrompt(),
      maxTokens: 3000,
      temperature: 0.1,
      cacheSystem: true,
      documents: [
        {
          name: input.fileName || "image",
          mediaType: input.mediaType,
          bytes: input.bytes,
        },
      ],
    });

    if (ai.stubbed) {
      return { ok: false, error: "AI provider unexpectedly returned stub mode." };
    }

    return {
      ok: true,
      text: (ai.text || "").trim().slice(0, 8000),
      provider: ai.provider,
      model: ai.model,
      stubbed: false,
    };
  } catch (err) {
    log.error("[extractTextFromImageViaVision]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Vision OCR failed.",
    };
  }
}
