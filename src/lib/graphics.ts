/**
 * BL-FB-GEN-GRAPHICS — graphics suggestions for a section, server side.
 *
 * Loads the section (scoped by organization), asks the model for diagram
 * specs drawn from the section's own text, falls back to the heuristic
 * proposals in stub mode or when the answer is unusable, and renders
 * each spec as SVG, Mermaid and an image source. Gates and quota live
 * here (one request slot per suggestion run; refunded when the model
 * gives nothing). Server-only; callers own auth.
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, proposalSections, proposals } from "@/db/schema";
import { completeStructuredForTenant } from "@/lib/ai";
import { GRAPHICS_SUGGEST_PROMPT_VERSION, buildGraphicsSuggestPrompt, graphicsSuggestSchema } from "@/lib/ai-prompts";
import { recordAudit } from "@/lib/audit-log";
import {
  GRAPHIC_LIMITS,
  proposeGraphics,
  renderDiagramSvg,
  sanitizeSpec,
  svgDataUri,
  toMermaid,
  type GraphicSpec,
} from "@/lib/graphics-logic";
import { log } from "@/lib/log";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";

type Actor = { userId: string | null; email?: string | null };

export type GraphicSuggestion = GraphicSpec & { svg: string; mermaid: string; dataUri: string };

export type SuggestGraphicsResult =
  | {
      ok: true;
      suggestions: GraphicSuggestion[];
      /** True when the AI provider was the stub. */
      stubbed: boolean;
      /** True when the heuristic proposals were used instead of the model's. */
      fallback: boolean;
      model: string;
    }
  | { ok: false; error: string };

export async function suggestSectionGraphics(input: {
  organizationId: string;
  sectionId: string;
  /** The section as it stands in the editor; replaces the saved body. */
  currentBodyPlain?: string;
  actor: Actor;
}): Promise<SuggestGraphicsResult> {
  const { organizationId } = input;
  const [row] = await db
    .select({
      title: proposalSections.title,
      kind: proposalSections.kind,
      content: proposalSections.content,
      proposalId: proposalSections.proposalId,
      agency: opportunities.agency,
    })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .where(and(eq(proposalSections.id, input.sectionId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  if (!row) return { ok: false, error: "Section not found." };

  const text = (input.currentBodyPlain?.trim() || row.content || "").slice(0, 12_000);
  const words = text.split(/\s+/g).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  if (words < GRAPHIC_LIMITS.minWords) {
    return { ok: false, error: `Write a few paragraphs first (${GRAPHIC_LIMITS.minWords}+ words) — the suggestions read the section.` };
  }

  try {
    await ensureFeature(organizationId, "aiAutoDraft");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) return { ok: false, error: err.message };
    throw err;
  }
  const refund = () => refundQuota(organizationId, "aiRequestsPerMonth").catch(() => undefined);

  const section = { kind: row.kind, title: row.title, text };
  let specs: GraphicSpec[] = [];
  let stubbed = false;
  let fallback = false;
  let model = "";
  try {
    const prompt = buildGraphicsSuggestPrompt({ title: row.title, kind: row.kind, agency: row.agency ?? "", text });
    const res = await completeStructuredForTenant({
      organizationId,
      feature: "graphics_suggest",
      promptVersion: GRAPHICS_SUGGEST_PROMPT_VERSION,
      schema: graphicsSuggestSchema,
      toolName: "record_graphics",
      toolDescription: "Record the diagrams this section would benefit from.",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 1_500,
      temperature: 0.3,
      cacheSystem: true,
    });
    stubbed = res.stubbed;
    model = res.model;
    specs = (res.data?.suggestions ?? [])
      .map((s) => sanitizeSpec(s))
      .filter((s): s is GraphicSpec => s !== null)
      .slice(0, GRAPHIC_LIMITS.maxSuggestions);
    if (specs.length === 0) {
      fallback = true;
      specs = proposeGraphics(section);
      if (!res.stubbed) {
        await refund();
        log.warn("[graphics]", "model proposed nothing usable", { organizationId, sectionId: input.sectionId, error: res.parseError });
      }
    }
  } catch (err) {
    fallback = true;
    specs = proposeGraphics(section);
    await refund();
    log.error("[graphics]", "suggestion call failed", { organizationId, sectionId: input.sectionId, error: err });
  }

  const suggestions: GraphicSuggestion[] = specs.map((spec) => {
    const svg = renderDiagramSvg(spec);
    return { ...spec, svg, mermaid: toMermaid(spec), dataUri: svgDataUri(svg) };
  });

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "section.graphics.suggest",
    resourceType: "proposal_section",
    resourceId: input.sectionId,
    metadata: { proposalId: row.proposalId, suggestions: suggestions.length, kinds: suggestions.map((s) => s.kind), stubbed, fallback, words },
  });
  return { ok: true, suggestions, stubbed, fallback, model };
}
