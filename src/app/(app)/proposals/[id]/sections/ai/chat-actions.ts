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
import { completeForTenant } from "@/lib/ai";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";
import type { AIMessage } from "@/lib/ai";
import { log } from "@/lib/log";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatWithSectionResult =
  | { ok: true; reply: string; stubbed: boolean }
  | { ok: false; error: string };

const CHAT_SYSTEM = `You are an expert federal proposal writer embedded inside FORGE. You are helping the proposal author work on a specific section of their in-progress government proposal. You have context about the opportunity, the organization, and the solicitation requirements.

Your role:
- Answer questions about how to approach, strengthen, or structure the section.
- Suggest specific language or paragraphs on request.
- Flag compliance issues or missing elements.
- Be direct and specific — cite section references (e.g. [L.5.2.1]) when relevant.
- Keep responses concise but actionable. No generic advice.
- If you suggest replacement text, make it immediately usable.

You are NOT a general assistant. Stay focused on improving this proposal section.`;

export async function chatWithSectionAction(input: {
  sectionId: string;
  message: string;
  history: ChatMessage[];
}): Promise<ChatWithSectionResult> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  try {
    await ensureFeature(organizationId, "aiAutoDraft");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  const limit = await enforceRateLimit({
    key: `section-chat:${input.sectionId}`,
    limit: 30,
    windowSeconds: 3600,
  });
  if (!limit.ok) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return {
      ok: false,
      error: `Chat limit reached (30/hour per section). Retry in ${Math.ceil(limit.retryAfter / 60)} min.`,
    };
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
      opportunityId: proposals.opportunityId,
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
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  // Load solicitation context (best-effort).
  let solBlock = "";
  try {
    const [sol] = await db
      .select({
        sectionLSummary: solicitations.sectionLSummary,
        sectionMSummary: solicitations.sectionMSummary,
        extractedRequirements: solicitations.extractedRequirements,
      })
      .from(solicitations)
      .where(
        and(
          eq(solicitations.opportunityId, row.opportunityId),
          eq(solicitations.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (sol) {
      const reqs = (sol.extractedRequirements ?? [])
        .slice(0, 15)
        .map((r, i) => `${i + 1}. [${r.ref || "?"}] ${r.kind}: ${r.text.slice(0, 200)}`)
        .join("\n");
      solBlock = [
        sol.sectionLSummary && `Section L: ${sol.sectionLSummary.slice(0, 500)}`,
        sol.sectionMSummary && `Section M: ${sol.sectionMSummary.slice(0, 500)}`,
        reqs && `Requirements:\n${reqs}`,
      ]
        .filter(Boolean)
        .join("\n\n");
    }
  } catch {
    // best effort
  }

  const contextBlock = [
    `Organization: ${orgRow?.name ?? "unknown"}`,
    `Proposal: ${row.proposal.title}`,
    `Agency: ${row.agency || "(unknown)"}`,
    `Solicitation: ${row.solicitationNumber || "(none)"}`,
    `NAICS: ${row.naicsCode || "(unknown)"}`,
    `Set-aside: ${row.setAside || "(unrestricted)"}`,
    row.incumbent && `Incumbent: ${row.incumbent}`,
    row.opportunityDescription &&
      `Opportunity description: ${row.opportunityDescription.slice(0, 800)}`,
    solBlock && `\nSolicitation context:\n${solBlock}`,
    `\nSection being worked: "${row.section.title}" (kind: ${row.section.kind}${row.section.pageLimit ? `, page cap: ${row.section.pageLimit}` : ""})`,
    row.section.content?.trim() &&
      `\nCurrent draft (${row.section.wordCount} words):\n${row.section.content.slice(0, 3000)}`,
  ]
    .filter(Boolean)
    .join("\n");

  // Build the conversation: context injected as first user turn,
  // then the actual history, then the new message.
  const systemWithContext = `${CHAT_SYSTEM}\n\n--- CONTEXT ---\n${contextBlock}`;

  const messages: AIMessage[] = [
    // Trim history to last 6 turns to stay within token limits.
    ...input.history.slice(-6).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: input.message },
  ];

  try {
    const res = await completeForTenant({
      organizationId,
      system: systemWithContext,
      messages,
      maxTokens: 1200,
      temperature: 0.4,
      cacheSystem: false,
    });

    return { ok: true, reply: res.text.trim(), stubbed: res.stubbed };
  } catch (err) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    log.error("[chatWithSectionAction]", "AI call failed", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Chat request failed.",
    };
  }
}
