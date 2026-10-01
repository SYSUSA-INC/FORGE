/**
 * BL-FB-GEN-VOC — voice of the customer, server side: the phrases for
 * a proposal (from every solicitation on its opportunity plus the
 * opportunity's description) and the per-section switch. Every query
 * carries organizationId. Server-only; callers own auth.
 */
import "server-only";

import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, proposalSections, proposals, solicitations } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { extractCustomerVoice, type CustomerPhrase } from "@/lib/customer-voice";
import { loadOpportunityRequirements } from "@/lib/solicitation-requirements";

/** How much of the newest solicitation's text is scanned for evaluation language. */
const RAW_TEXT_CHARS = 200_000;

export type CustomerVoice = {
  agency: string;
  phrases: CustomerPhrase[];
  sources: { requirements: number; sectionM: boolean; rawTextChars: number; description: boolean };
};

export async function getCustomerVoice(input: {
  organizationId: string;
  proposalId: string;
  max?: number;
}): Promise<CustomerVoice | null> {
  const { organizationId } = input;
  const [row] = await db
    .select({
      opportunityId: proposals.opportunityId,
      agency: opportunities.agency,
      description: opportunities.description,
    })
    .from(proposals)
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .where(and(eq(proposals.id, input.proposalId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  if (!row) return null;

  const [loaded, textRows] = await Promise.all([
    loadOpportunityRequirements({ organizationId, opportunityId: row.opportunityId }),
    db
      .select({ rawText: solicitations.rawText })
      .from(solicitations)
      .where(
        and(
          eq(solicitations.organizationId, organizationId),
          eq(solicitations.opportunityId, row.opportunityId),
          ne(solicitations.rawText, ""),
        ),
      )
      .orderBy(desc(solicitations.createdAt))
      .limit(1),
  ]);
  const rawText = (textRows[0]?.rawText ?? "").slice(0, RAW_TEXT_CHARS);

  const phrases = extractCustomerVoice(
    {
      sectionMSummary: loaded.sectionMSummary,
      sectionLSummary: loaded.sectionLSummary,
      requirements: loaded.requirements,
      rawText,
      description: row.description,
    },
    { max: input.max },
  );
  return {
    agency: row.agency ?? "",
    phrases,
    sources: {
      requirements: loaded.requirements.length,
      sectionM: Boolean(loaded.sectionMSummary),
      rawTextChars: rawText.length,
      description: Boolean(row.description?.trim()),
    },
  };
}

/** Turn echoing on or off for one section; audited. */
export async function setSectionCustomerVoice(input: {
  organizationId: string;
  sectionId: string;
  enabled: boolean;
  actor: { userId: string | null; email?: string | null };
}): Promise<{ ok: true; enabled: boolean } | { ok: false; error: string }> {
  const { organizationId } = input;
  const [row] = await db
    .select({ id: proposalSections.id, proposalId: proposalSections.proposalId })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .where(and(eq(proposalSections.id, input.sectionId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  if (!row) return { ok: false, error: "Section not found." };

  await db
    .update(proposalSections)
    .set({ echoCustomerVoice: input.enabled, updatedAt: new Date() })
    .where(eq(proposalSections.id, row.id));

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "proposal_section.customer_voice.update",
    resourceType: "proposal_section",
    resourceId: row.id,
    metadata: { proposalId: row.proposalId, enabled: input.enabled },
  });
  return { ok: true, enabled: input.enabled };
}
