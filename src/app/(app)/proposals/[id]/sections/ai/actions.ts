"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  organizations,
  proposalSections,
  proposals,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { complete } from "@/lib/ai";
import {
  buildSectionDraftPrompt,
  type SectionDraftMode,
  type SectionDraftSnapshot,
} from "@/lib/ai-prompts";
import { fromPlainText, projectToPlain } from "@/lib/tiptap-doc";

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
    }
  | { ok: false; error: string };

const MODES: SectionDraftMode[] = ["draft", "improve", "tighten"];

export async function generateSectionDraftAction(input: {
  sectionId: string;
  mode: SectionDraftMode;
}): Promise<SectionDraftResult> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

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

  const snapshot: SectionDraftSnapshot = {
    organizationName: orgRow?.name ?? "your organization",
    proposal: {
      title: row.proposal.title,
      agency: row.agency ?? "",
      solicitationNumber: row.solicitationNumber ?? "",
      naicsCode: row.naicsCode ?? "",
      setAside: row.setAside ?? "",
      incumbent: row.incumbent ?? "",
      opportunityDescription: (row.opportunityDescription ?? "").slice(0, 1500),
    },
    section: {
      title: row.section.title,
      kind: row.section.kind,
      pageLimit: row.section.pageLimit,
      currentBodyPlain: (row.section.content ?? "").slice(0, 4000),
      currentWordCount: row.section.wordCount,
    },
    pastPerformance,
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
    const ai = await complete({
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: input.mode === "tighten" ? 1200 : 2200,
      temperature: input.mode === "improve" ? 0.3 : 0.5,
      cacheSystem: true,
    });

    const text = (ai.text ?? "").trim();
    if (!text) {
      return { ok: false, error: "AI returned an empty response." };
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
    };
  } catch (err) {
    console.error("[generateSectionDraftAction]", err);
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
