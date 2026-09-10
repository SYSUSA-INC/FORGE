"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  organizations,
  proposalSections,
  proposals,
  solicitations,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { completeForTenant } from "@/lib/ai";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";
import {
  buildSectionDraftPrompt,
  type SectionDraftMode,
  type SectionDraftSnapshot,
} from "@/lib/ai-prompts";
import { gatherPatternIntelForSection } from "@/lib/section-pattern-intel";
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
    }
  | { ok: false; error: string };

const MODES: SectionDraftMode[] = ["draft", "improve", "tighten", "draft_alt"];

export async function generateSectionDraftAction(input: {
  sectionId: string;
  mode: SectionDraftMode;
  /** BL-11 A/B: caller-supplied UUID linking the two competing variants. */
  abPairId?: string;
  abVariant?: "a" | "b";
}): Promise<SectionDraftResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // BL-16 Phase B-2 — gate AI section generation on `aiAutoDraft`.
  // Existing tenants on Platinum have it enabled (per BL-16 Phase A
  // backfill); Bronze tenants get a clean upgrade-prompt error.
  //
  // BL-16 Phase B-3b — also bump the AI-request counter for this
  // month so quota enforcement applies to draft generation.
  try {
    await ensureFeature(organizationId, "aiAutoDraft");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  if (!MODES.includes(input.mode)) {
    return { ok: false, error: "Invalid mode." };
  }

  const [row] = await db
    .select({
      section: proposalSections,
      proposal: proposals,
      agency: opportunities.agency,
      solicitationNumber: opportunities.solicitationNumber,
      naicsCode: opportunities.naicsCode,
      setAside: opportunities.setAside,
      incumbent: opportunities.incumbent,
      opportunityDescription: opportunities.description,
    })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .where(
      and(
        eq(proposalSections.id, input.sectionId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Section not found." };

  const [orgRow] = await db
    .select({ name: organizations.name, pastPerformance: organizations.pastPerformance })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  // Limit past-performance to 3 entries, trim each.
  const pastPerformance = (orgRow?.pastPerformance ?? [])
    .slice(0, 3)
    .map((p) => ({
      customer: p.customer ?? "",
      contract: p.contract ?? "",
      description: (p.description ?? "").slice(0, 400),
    }));

  // Load solicitation requirements (best-effort). Gives the AI concrete
  // Section L/M language to write against instead of generic prose.
  let solicitationContext: SectionDraftSnapshot["solicitation"] | undefined;
  try {
    const [solRow] = await db
      .select({
        sectionLSummary: solicitations.sectionLSummary,
        sectionMSummary: solicitations.sectionMSummary,
        extractedRequirements: solicitations.extractedRequirements,
      })
      .from(solicitations)
      .where(
        and(
          eq(solicitations.opportunityId, row.proposal.opportunityId),
          eq(solicitations.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (
      solRow &&
      (solRow.sectionLSummary ||
        solRow.sectionMSummary ||
        (solRow.extractedRequirements ?? []).length > 0)
    ) {
      solicitationContext = {
        sectionLSummary: solRow.sectionLSummary,
        sectionMSummary: solRow.sectionMSummary,
        requirements: (solRow.extractedRequirements ?? []).slice(0, 25),
      };
    }
  } catch (err) {
    log.warn(
      "[generateSectionDraftAction]",
      "solicitation requirements load failed",
      { error: err },
    );
  }

  // Phase 14d — pattern intel. Best-effort; failures degrade to no
  // intel rather than blocking the draft.
  let patternIntel: SectionDraftSnapshot["patternIntel"];
  try {
    patternIntel = await gatherPatternIntelForSection({
      sectionId: input.sectionId,
      organizationId,
      sectionTitle: row.section.title,
      sectionKind: row.section.kind,
      agency: row.agency ?? "",
      naicsCode: row.naicsCode ?? "",
      opportunityDescription: row.opportunityDescription ?? "",
    });
  } catch (err) {
    log.warn("[generateSectionDraftAction]", "pattern intel failed", { error: err });
    patternIntel = undefined;
  }

  const snapshot: SectionDraftSnapshot = {
    organizationName: orgRow?.name ?? "your organization",
    proposal: {
      title: row.proposal.title,
      agency: row.agency ?? "",
      solicitationNumber: row.solicitationNumber ?? "",
      naicsCode: row.naicsCode ?? "",
      setAside: row.setAside ?? "",
      incumbent: row.incumbent ?? "",
      opportunityDescription: (row.opportunityDescription ?? "").slice(0, 2000),
    },
    section: {
      title: row.section.title,
      kind: row.section.kind,
      pageLimit: row.section.pageLimit,
      currentBodyPlain: (row.section.content ?? "").slice(0, 4000),
      currentWordCount: row.section.wordCount,
    },
    pastPerformance,
    patternIntel,
    solicitation: solicitationContext,
    // BL-FB-GEN-THEMES — pass per-proposal win themes through so the
    // drafter weaves them into every section. Cap at 3 (the same cap
    // applied at write time) as a defence-in-depth.
    winThemes: (row.proposal.winThemes ?? []).slice(0, 3).map((t) => ({
      title: t.title ?? "",
      statement: t.statement ?? "",
    })),
  };

  // Improve / tighten require existing content to be useful.
  if (
    (input.mode === "improve" || input.mode === "tighten") &&
    !snapshot.section.currentBodyPlain.trim()
  ) {
    return {
      ok: false,
      error:
        input.mode === "improve"
          ? "Improve mode needs an existing draft. Use Draft to start from scratch."
          : "Tighten mode needs an existing draft. Use Draft to start from scratch.",
    };
  }

  try {
    const prompt = buildSectionDraftPrompt(input.mode, snapshot);
    const ai = await completeForTenant({
      organizationId,
      feature: "section_draft",
      variant: input.mode,
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: input.mode === "tighten" ? 1200 : 2200,
      temperature: input.mode === "improve" ? 0.3 : 0.5,
      cacheSystem: true,
    });

    const text = (ai.text ?? "").trim();
    if (!text) {
      // BL-16 Phase B-3d — AI returned nothing usable, refund the request slot.
      await refundQuota(organizationId, "aiRequestsPerMonth");
      return { ok: false, error: "AI returned an empty response." };
    }

    // BL-11 — capture draft signal for the self-improvement loop.
    // Only for "draft" and "draft_alt" modes (improve/tighten edit existing
    // content so the overlap metric wouldn't be meaningful). Best-effort.
    let signalId: string | undefined;
    if (input.mode === "draft" || input.mode === "draft_alt") {
      try {
        const { recordDraftSignal } = await import("@/lib/draft-signal");
        signalId = await recordDraftSignal({
          organizationId,
          proposalId: row.proposal.id,
          sectionId: input.sectionId,
          createdByUserId: user.id,
          mode: input.mode,
          sectionKind: row.section.kind,
          draftText: text,
          stubbed: ai.stubbed,
          abPairId: input.abPairId,
          abVariant: input.abVariant,
        });
      } catch (err) {
        log.warn("[generateSectionDraftAction]", "draft signal capture failed", { error: err });
      }
    }

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
