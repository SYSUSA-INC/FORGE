"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  proposalSections,
  proposals,
  type TipTapDoc,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import {
  countWords as countTipTapWords,
  fromPlainText,
  projectToPlain,
  validateDoc,
} from "@/lib/tiptap-doc";
import { generateSectionDraftAction } from "./actions";

/**
 * Phase 14e — list every section in a proposal so the client
 * orchestrator knows what to draft and which are already fleshed out.
 *
 * "Empty" here means word count below a threshold — sections seeded
 * with placeholder text from the lifecycle template count as empty.
 */
const EMPTY_WORD_THRESHOLD = 30;

export type AutoDraftSection = {
  id: string;
  title: string;
  kind: string;
  ordering: number;
  wordCount: number;
  isEmpty: boolean;
  status: string;
};

export async function listSectionsForAutoDraftAction(
  proposalId: string,
): Promise<
  | { ok: true; sections: AutoDraftSection[] }
  | { ok: false; error: string }
> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const [p] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(
      and(
        eq(proposals.id, proposalId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!p) return { ok: false, error: "Proposal not found." };

  const rows = await db
    .select({
      id: proposalSections.id,
      title: proposalSections.title,
      kind: proposalSections.kind,
      ordering: proposalSections.ordering,
      wordCount: proposalSections.wordCount,
      status: proposalSections.status,
    })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId))
    .orderBy(asc(proposalSections.ordering));

  return {
    ok: true,
    sections: rows.map((r) => ({
      id: r.id,
      title: r.title,
      kind: r.kind,
      ordering: r.ordering,
      wordCount: r.wordCount,
      isEmpty: r.wordCount < EMPTY_WORD_THRESHOLD,
      status: r.status,
    })),
  };
}

export type AutoDraftSectionResult =
  | {
      ok: true;
      sectionId: string;
      wordCount: number;
      provider: string;
      model: string;
      stubbed: boolean;
    }
  | { ok: false; sectionId: string; error: string };

/**
 * Phase 14e — draft a single section AND save the result. Drives
 * the client-side "Auto-draft all" loop. Each call goes through the
 * same generateSectionDraftAction we already use for the manual
 * draft button, so pattern intel (Phase 14d) flows through.
 *
 * Persists the result via direct UPDATE rather than going through
 * saveSectionAction — saves a round trip and lets us bump
 * status='draft_complete' atomically.
 */
export async function autoDraftSingleSectionAction(input: {
  proposalId: string;
  sectionId: string;
  /** Whether to overwrite an existing non-empty section. Defaults to false. */
  overwrite?: boolean;
}): Promise<AutoDraftSectionResult> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [section] = await db
    .select({
      id: proposalSections.id,
      wordCount: proposalSections.wordCount,
      proposalId: proposalSections.proposalId,
    })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .where(
      and(
        eq(proposalSections.id, input.sectionId),
        eq(proposals.id, input.proposalId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!section) {
    return {
      ok: false,
      sectionId: input.sectionId,
      error: "Section not found.",
    };
  }
  if (
    !input.overwrite &&
    section.wordCount >= 30 // EMPTY_WORD_THRESHOLD
  ) {
    return {
      ok: false,
      sectionId: input.sectionId,
      error: "Section already has content. Set overwrite=true to replace.",
    };
  }

  const draft = await generateSectionDraftAction({
    sectionId: input.sectionId,
    mode: "draft",
  });
  if (!draft.ok) {
    return {
      ok: false,
      sectionId: input.sectionId,
      error: draft.error,
    };
  }

  // Persist. Drafts always start in `in_progress` — auto-draft is a
  // starting point, not a finished review-ready section.
  const validated = validateDoc(draft.bodyDoc) ?? fromPlainText(draft.text);
  const projected = projectToPlain(validated as TipTapDoc);
  const wordCount = countTipTapWords(validated as TipTapDoc);

  await db
    .update(proposalSections)
    .set({
      bodyDoc: validated,
      content: projected,
      wordCount,
      status: "in_progress",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(proposalSections.id, input.sectionId),
        eq(proposalSections.proposalId, input.proposalId),
      ),
    );

  revalidatePath(`/proposals/${input.proposalId}/sections`);
  revalidatePath(`/proposals/${input.proposalId}`);

  return {
    ok: true,
    sectionId: input.sectionId,
    wordCount,
    provider: draft.provider,
    model: draft.model,
    stubbed: draft.stubbed,
  };
}
