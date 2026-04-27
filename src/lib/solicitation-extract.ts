/**
 * Solicitation extraction pipeline.
 *
 *   bytes (PDF) → text (pdf-parse) → AI gateway → structured JSON
 *
 * Intentionally flat — no queueing, no background workers in v1.
 * The upload action calls this synchronously and updates the
 * solicitation row. For larger files / scanned PDFs we'd add an
 * OCR step (Tesseract) and move parsing to a background job;
 * leaving that as an explicit follow-up.
 */
import {
  buildSolicitationExtractPrompt,
  type SolicitationExtractionResult,
} from "@/lib/ai-prompts";
import { complete } from "@/lib/ai";

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
