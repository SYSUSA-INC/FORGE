/**
 * eBuy RFQ paste extractor.
 *
 * GSA eBuy has no public API — Schedule holders log in to view RFQs
 * targeted at their SINs. To bridge that gap, this helper takes raw
 * pasted text (RFQ body or forwarded eBuy email) and runs it through
 * the AI gateway to produce structured fields suitable for creating
 * an Opportunity.
 */
import { buildEbuyExtractPrompt, type EbuyExtractionResult } from "@/lib/ai-prompts";
import { complete } from "@/lib/ai";

export type EbuyExtractOk = {
  ok: true;
  data: EbuyExtractionResult;
  provider: string;
  model: string;
  stubbed: boolean;
};
export type EbuyExtractErr = { ok: false; error: string };

export async function aiExtractEbuy(
  rawText: string,
): Promise<EbuyExtractOk | EbuyExtractErr> {
  if (!rawText.trim()) {
    return { ok: false, error: "Paste the eBuy RFQ body before extracting." };
  }
  if (rawText.trim().length < 80) {
    return {
      ok: false,
      error:
        "Pasted text is too short to be an RFQ. Include the title, RFQ number, due date, and scope.",
    };
  }

  try {
    const prompt = buildEbuyExtractPrompt(rawText);
    const ai = await complete({
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 1800,
      temperature: 0.1,
      cacheSystem: true,
    });

    if (ai.stubbed) {
      // Stub-mode: return a deterministic empty payload with a hint so
      // the UI can flag it. User flips to live AI by setting
      // ANTHROPIC_API_KEY (or equivalent).
      return {
        ok: true,
        provider: ai.provider,
        model: ai.model,
        stubbed: true,
        data: {
          title: "",
          rfqNumber: "",
          buyingAgency: "",
          vehicle: "",
          naicsCode: "",
          setAside: "",
          responseDueDate: null,
          placeOfPerformance: "",
          scopeSummary:
            "AI extraction is in stub mode. Set ANTHROPIC_API_KEY on Vercel to enable live extraction.",
          clinSummary: "",
          notes: "",
        },
      };
    }

    const cleaned = stripCodeFences(ai.text);
    const parsed = JSON.parse(cleaned) as EbuyExtractionResult;
    return {
      ok: true,
      provider: ai.provider,
      model: ai.model,
      stubbed: false,
      data: normalize(parsed),
    };
  } catch (err) {
    console.error("[aiExtractEbuy]", err);
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

function normalize(raw: Partial<EbuyExtractionResult>): EbuyExtractionResult {
  const trimStr = (v: unknown, max: number): string =>
    typeof v === "string" ? v.slice(0, max) : "";

  const dueRaw = typeof raw.responseDueDate === "string" ? raw.responseDueDate : "";
  const due = dueRaw.match(/^\d{4}-\d{2}-\d{2}/) ? dueRaw.slice(0, 10) : null;

  return {
    title: trimStr(raw.title, 256),
    rfqNumber: trimStr(raw.rfqNumber, 128),
    buyingAgency: trimStr(raw.buyingAgency, 256),
    vehicle: trimStr(raw.vehicle, 64),
    naicsCode: trimStr(raw.naicsCode, 16),
    setAside: trimStr(raw.setAside, 64),
    responseDueDate: due,
    placeOfPerformance: trimStr(raw.placeOfPerformance, 256),
    scopeSummary: trimStr(raw.scopeSummary, 2000),
    clinSummary: trimStr(raw.clinSummary, 2000),
    notes: trimStr(raw.notes, 2000),
  };
}
