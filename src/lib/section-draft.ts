/**
 * BL-AI-STREAMING — shared section-draft preparation.
 *
 * The context a draft is written against (proposal, section, org past
 * performance, solicitation L/M, pattern intel, win themes) used to be
 * assembled inline in `generateSectionDraftAction`. The streaming route
 * needs the identical prompt, so the assembly lives here and both the
 * server action and `/api/ai/draft` call it. Behaviour is unchanged.
 *
 * Callers own the gates (feature flag, quota, auth) and the AI call;
 * this module only loads data and builds the prompt. Every query is
 * scoped by the caller-supplied organizationId.
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  organizations,
  proposalSections,
  proposals,
  solicitations,
  type ProposalSectionKind,
} from "@/db/schema";
import {
  buildSectionDraftPrompt,
  type SectionDraftMode,
  type SectionDraftSnapshot,
} from "@/lib/ai-prompts";
import { gatherPatternIntelForSection } from "@/lib/section-pattern-intel";
import { log } from "@/lib/log";

export const DRAFT_MODES: readonly SectionDraftMode[] = [
  "draft",
  "improve",
  "tighten",
  "draft_alt",
] as const;

export function isDraftMode(v: unknown): v is SectionDraftMode {
  return typeof v === "string" && (DRAFT_MODES as readonly string[]).includes(v);
}

export function draftMaxTokens(mode: SectionDraftMode): number {
  return mode === "tighten" ? 1200 : 2200;
}

export function draftTemperature(mode: SectionDraftMode): number {
  return mode === "improve" ? 0.3 : 0.5;
}

export type PreparedSectionDraft =
  | {
      ok: true;
      prompt: ReturnType<typeof buildSectionDraftPrompt>;
      proposalId: string;
      sectionKind: ProposalSectionKind;
      maxTokens: number;
      temperature: number;
    }
  | { ok: false; error: string };

export async function prepareSectionDraft(input: {
  organizationId: string;
  sectionId: string;
  mode: SectionDraftMode;
}): Promise<PreparedSectionDraft> {
  const { organizationId } = input;

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
    log.warn("[prepareSectionDraft]", "solicitation requirements load failed", {
      error: err,
    });
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
    log.warn("[prepareSectionDraft]", "pattern intel failed", { error: err });
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

  return {
    ok: true,
    prompt: buildSectionDraftPrompt(input.mode, snapshot),
    proposalId: row.proposal.id,
    sectionKind: row.section.kind,
    maxTokens: draftMaxTokens(input.mode),
    temperature: draftTemperature(input.mode),
  };
}

/**
 * BL-11 — capture the draft signal for the self-improvement loop. Only
 * for "draft" and "draft_alt" (improve / tighten edit existing content
 * so the overlap metric is meaningless). Best-effort: never throws,
 * returns the signal id when one was written.
 */
export async function captureDraftSignal(input: {
  organizationId: string;
  proposalId: string;
  sectionId: string;
  createdByUserId: string;
  mode: SectionDraftMode;
  sectionKind: ProposalSectionKind;
  draftText: string;
  stubbed: boolean;
  abPairId?: string;
  abVariant?: "a" | "b";
}): Promise<string | undefined> {
  if (input.mode !== "draft" && input.mode !== "draft_alt") return undefined;
  try {
    const { recordDraftSignal } = await import("@/lib/draft-signal");
    return await recordDraftSignal(input);
  } catch (err) {
    log.warn("[captureDraftSignal]", "draft signal capture failed", { error: err });
    return undefined;
  }
}
