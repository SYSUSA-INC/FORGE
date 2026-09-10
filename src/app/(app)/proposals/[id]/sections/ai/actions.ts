"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { proposalSections, proposals } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { completeForTenant } from "@/lib/ai";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";
import type { SectionDraftMode } from "@/lib/ai-prompts";
import {
  extractCitationStats,
  type CitationStats,
  type DraftSource,
} from "@/lib/citations";
import {
  captureDraftSignal,
  isDraftMode,
  prepareSectionDraft,
} from "@/lib/section-draft";
import { fromPlainText, projectToPlain } from "@/lib/tiptap-doc";
import { log } from "@/lib/log";

export type SectionDraftResult =
  | {
      ok: true;
      mode: SectionDraftMode;
      text: string;
      bodyDoc: import("@/db/schema").TipTapDoc;
      provider: string;
      model: string;
      stubbed: boolean;
      inputTokens?: number;
      outputTokens?: number;
      generatedAt: string;
      /** BL-11: id of the captured draft signal row, present for draft/draft_alt modes. */
      signalId?: string;
      /** BL-FB-GEN-CITE — present when the draft was generated in citation mode. */
      sources?: DraftSource[];
      citations?: CitationStats;
      sourcesStubbed?: boolean;
    }
  | { ok: false; error: string };

/**
 * Non-streaming section draft. Still the path for A/B comparison
 * (`ab-actions.ts` runs two of these in parallel) and any caller that
 * wants the whole draft in one response. The interactive panel uses the
 * streaming route at /api/ai/draft, which shares `prepareSectionDraft`
 * so the two paths cannot drift (BL-AI-STREAMING).
 */
export async function generateSectionDraftAction(input: {
  sectionId: string;
  mode: SectionDraftMode;
  /** BL-11 A/B: caller-supplied UUID linking the two competing variants. */
  abPairId?: string;
  abVariant?: "a" | "b";
  /** BL-FB-GEN-CITE — require inline citations against Brain sources. */
  cite?: boolean;
}): Promise<SectionDraftResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // BL-16 Phase B-2 — gate AI section generation on `aiAutoDraft`.
  // BL-16 Phase B-3b — also bump the AI-request counter for this month.
  try {
    await ensureFeature(organizationId, "aiAutoDraft");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  if (!isDraftMode(input.mode)) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return { ok: false, error: "Invalid mode." };
  }

  const prepared = await prepareSectionDraft({
    organizationId,
    sectionId: input.sectionId,
    mode: input.mode,
    cite: input.cite,
  });
  if (!prepared.ok) {
    // Nothing was generated — give the request slot back.
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return { ok: false, error: prepared.error };
  }

  try {
    const ai = await completeForTenant({
      organizationId,
      feature: "section_draft",
      variant: input.cite ? `${input.mode}+cite` : input.mode,
      system: prepared.prompt.system,
      messages: prepared.prompt.messages,
      maxTokens: prepared.maxTokens,
      temperature: prepared.temperature,
      cacheSystem: true,
    });

    const text = (ai.text ?? "").trim();
    if (!text) {
      // BL-16 Phase B-3d — AI returned nothing usable, refund the request slot.
      await refundQuota(organizationId, "aiRequestsPerMonth");
      return { ok: false, error: "AI returned an empty response." };
    }

    const signalId = await captureDraftSignal({
      organizationId,
      proposalId: prepared.proposalId,
      sectionId: input.sectionId,
      createdByUserId: user.id,
      mode: input.mode,
      sectionKind: prepared.sectionKind,
      draftText: text,
      stubbed: ai.stubbed,
      abPairId: input.abPairId,
      abVariant: input.abVariant,
    });

    return {
      ok: true,
      mode: input.mode,
      text,
      bodyDoc: fromPlainText(text),
      provider: ai.provider,
      model: ai.model,
      stubbed: ai.stubbed,
      inputTokens: ai.inputTokens,
      outputTokens: ai.outputTokens,
      generatedAt: new Date().toISOString(),
      signalId,
      ...(input.cite
        ? {
            sources: prepared.sources,
            citations: extractCitationStats(text),
            sourcesStubbed: prepared.sourcesStubbed,
          }
        : {}),
    };
  } catch (err) {
    // BL-16 Phase B-3d — AI call failed (network / provider error). Refund
    // the request slot so the user isn't billed for an attempt that never
    // produced output. Token cap is post-record so it never charged.
    await refundQuota(organizationId, "aiRequestsPerMonth");
    log.error("[generateSectionDraftAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "AI request failed.",
    };
  }
}

export async function getSectionPlainContent(
  sectionId: string,
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const [row] = await db
    .select({ content: proposalSections.content })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .where(
      and(
        eq(proposalSections.id, sectionId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Section not found." };
  return { ok: true, content: row.content };
}

// Re-export so the panel can call projectToPlain without importing
// a server-only path (kept as a util passthrough).
export async function plainifyAction(text: string): Promise<string> {
  return projectToPlain({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
}
