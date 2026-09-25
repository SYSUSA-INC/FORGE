/**
 * BL-AIP-5 — verifier pass for citation-mode drafts.
 *
 * Marker counts were the only check on a cited draft: the model could
 * write "[S3]" after a number the source never mentions and nothing
 * noticed. This pass (1) drops markers that name no listed source and
 * (2) asks the model, per cited sentence, whether the cited excerpt
 * actually supports it; unsupported sentences lose their markers and
 * gain [NEEDS CITATION]. Best-effort: any failure returns the text as
 * it was, with `skipped` saying why.
 *
 * One extra call per cited draft, metered under section_draft / verify.
 * Server-only; the caller has already passed the feature and quota
 * gates for the draft itself.
 */
import "server-only";

import { completeStructuredForTenant } from "@/lib/ai";
import {
  buildCitationVerifyPrompt,
  citationVerifySchema,
  type CitationVerifyClaim,
} from "@/lib/ai-prompts";
import {
  citedClaims,
  demoteClaims,
  dropInvalidMarkers,
  type CitationVerification,
  type DraftSource,
} from "@/lib/citations";
import { log } from "@/lib/log";

export type { CitationVerification } from "@/lib/citations";

export const MAX_VERIFIED_CLAIMS = 40;

export async function verifyDraftCitations(input: {
  organizationId: string;
  text: string;
  sources: DraftSource[];
}): Promise<{ text: string; verification: CitationVerification }> {
  const { text: cleaned, dropped } = dropInvalidMarkers(input.text, input.sources.length);
  const base: CitationVerification = {
    checked: 0,
    unsupported: 0,
    invalidMarkers: dropped,
    stubbed: false,
  };

  const claims = citedClaims(cleaned).slice(0, MAX_VERIFIED_CLAIMS);
  if (claims.length === 0 || input.sources.length === 0) {
    return { text: cleaned, verification: { ...base, skipped: claims.length === 0 ? "no cited claims" : "no sources" } };
  }

  const byIndex = new Map(input.sources.map((s) => [s.index, s]));
  const verifyClaims: CitationVerifyClaim[] = claims.map((c) => ({
    id: c.id,
    claim: c.claim,
    sources: c.sourceIndexes
      .map((i) => byIndex.get(i))
      .filter((s): s is DraftSource => !!s)
      .map((s) => ({ index: s.index, excerpt: s.excerpt })),
  }));

  try {
    const prompt = buildCitationVerifyPrompt({ claims: verifyClaims });
    const res = await completeStructuredForTenant({
      organizationId: input.organizationId,
      feature: "section_draft",
      variant: "verify",
      schema: citationVerifySchema,
      toolName: "record_citation_verdicts",
      toolDescription: "Record, per claim id, whether the cited excerpt supports the sentence.",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 1500,
      temperature: 0,
      cacheSystem: true,
    });
    if (res.stubbed) {
      return { text: cleaned, verification: { ...base, checked: claims.length, stubbed: true, skipped: "stub provider" } };
    }
    if (!res.data) {
      log.warn("[verifyDraftCitations]", "verdicts did not validate", { parseError: res.parseError });
      return { text: cleaned, verification: { ...base, checked: claims.length, skipped: "verdicts did not validate" } };
    }
    const unsupportedIds = new Set(res.data.verdicts.filter((v) => !v.supported).map((v) => v.id));
    const unsupported = claims.filter((c) => unsupportedIds.has(c.id));
    const revised = unsupported.length > 0 ? demoteClaims(cleaned, unsupported) : cleaned;
    return {
      text: revised,
      verification: { ...base, checked: claims.length, unsupported: unsupported.length },
    };
  } catch (err) {
    log.warn("[verifyDraftCitations]", "verifier call failed", { error: err });
    return { text: cleaned, verification: { ...base, checked: claims.length, skipped: "verifier call failed" } };
  }
}
