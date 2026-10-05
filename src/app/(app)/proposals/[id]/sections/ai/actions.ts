"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { proposalSections, proposals } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { type SectionDraftMode } from "@/lib/ai-prompts";
import { projectToPlain } from "@/lib/tiptap-doc";
import { runSectionDraft, type SectionDraftResult } from "@/lib/section-draft-run";

export type { SectionDraftResult };

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
  /**
   * BL-FB-GEN-CITE — require inline citations against Brain sources.
   * BL-AIP-5 — on by default; pass `false` to opt out.
   */
  cite?: boolean;
}): Promise<SectionDraftResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return runSectionDraft({ ...input, organizationId, userId: user.id });
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
