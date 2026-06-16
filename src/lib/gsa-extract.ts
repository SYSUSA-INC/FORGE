/**
 * GSA email paste extractor.
 *
 * Broader than the eBuy extractor — handles any forwarded GSA email
 * about a contracting opportunity (eBuy RFQ, Schedule sub-CO note,
 * OASIS+/Polaris task order announcement, sources sought, generic
 * GSA acquisition email pointing at SAM.gov, etc.). Returns a
 * structured shape suitable for creating an Opportunity row.
 *
 * Pattern mirrors `aiExtractEbuy` — same stub-mode handling, same
 * zod validation, same shape of result. Different prompt + schema.
 */
import {
  buildGsaExtractPrompt,
  gsaExtractionSchema,
  parseAiJson,
  type GsaExtractionResult,
} from "@/lib/ai-prompts";
import { completeForTenant } from "@/lib/ai";
import { log } from "@/lib/log";

export type GsaExtractOk = {
  ok: true;
  data: GsaExtractionResult;
  provider: string;
  model: string;
  stubbed: boolean;
};
export type GsaExtractErr = { ok: false; error: string };

const VALID_NOTICE_TYPES = new Set([
  "rfp",
  "rfq",
  "rfi",
  "sources_sought",
  "task_order",
  "other",
]);

export async function aiExtractGsa(
  organizationId: string,
  rawText: string,
): Promise<GsaExtractOk | GsaExtractErr> {
  if (!rawText.trim()) {
    return { ok: false, error: "Paste the forwarded GSA email body before extracting." };
  }
  if (rawText.trim().length < 80) {
    return {
      ok: false,
      error:
        "Pasted text is too short to be a GSA opportunity email. Include the title, agency, and any due date or scope details from the email body.",
    };
  }

  try {
    const prompt = buildGsaExtractPrompt(rawText);
    const ai = await completeForTenant({
      organizationId,
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 1800,
      temperature: 0.1,
      cacheSystem: true,
    });

    if (ai.stubbed) {
      // Stub-mode: return a deterministic empty payload with a hint
      // so the UI can flag it. User flips to live AI by setting
      // ANTHROPIC_API_KEY (or equivalent).
      return {
        ok: true,
        provider: ai.provider,
        model: ai.model,
        stubbed: true,
        data: {
          title: "",
          noticeType: "other",
          solicitationNumber: "",
          buyingAgency: "",
          office: "",
          vehicle: "",
          naicsCode: "",
          setAside: "",
          responseDueDate: null,
          placeOfPerformance: "",
          scopeSummary:
            "AI extraction is in stub mode. Set ANTHROPIC_API_KEY on Vercel to enable live extraction.",
          notes: "",
        },
      };
    }

    const cleaned = stripCodeFences(ai.text);
    const parseResult = parseAiJson(cleaned, gsaExtractionSchema);
    if (!parseResult.ok) {
      log.error("[aiExtractGsa]", "parse", { error: parseResult.error });
      return { ok: false, error: parseResult.error };
    }
    return {
      ok: true,
      provider: ai.provider,
      model: ai.model,
      stubbed: false,
      data: normalize(parseResult.data),
    };
  } catch (err) {
    log.error("[aiExtractGsa]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "AI extraction failed.",
    };
  }
}

function stripCodeFences(t: string): string {
  const s = t.trim();
  if (s.startsWith("```")) {
    return s
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
  }
  return s;
}

function normalize(raw: GsaExtractionResult): GsaExtractionResult {
  const trimStr = (v: unknown, max: number): string =>
    typeof v === "string" ? v.slice(0, max) : "";

  const dueRaw = typeof raw.responseDueDate === "string" ? raw.responseDueDate : "";
  const due = dueRaw.match(/^\d{4}-\d{2}-\d{2}/) ? dueRaw.slice(0, 10) : null;

  const noticeType = VALID_NOTICE_TYPES.has(raw.noticeType)
    ? raw.noticeType
    : "other";

  return {
    title: trimStr(raw.title, 256),
    noticeType,
    solicitationNumber: trimStr(raw.solicitationNumber, 128),
    buyingAgency: trimStr(raw.buyingAgency, 256),
    office: trimStr(raw.office, 256),
    vehicle: trimStr(raw.vehicle, 64),
    naicsCode: trimStr(raw.naicsCode, 16),
    setAside: trimStr(raw.setAside, 64),
    responseDueDate: due,
    placeOfPerformance: trimStr(raw.placeOfPerformance, 256),
    scopeSummary: trimStr(raw.scopeSummary, 2000),
    notes: trimStr(raw.notes, 2000),
  };
}
