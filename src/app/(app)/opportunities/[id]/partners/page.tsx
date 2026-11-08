import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { planBlocker } from "@/lib/capture-logic";
import { companiesToConsider, listOpportunityPartners } from "@/lib/capture-store";
import { loadCapabilityMatrix } from "@/lib/capability-matrix-build";
import { listPartnerInvites } from "@/lib/partner-invite-store";
import { latestDecisions, partnerSuggestions } from "@/lib/opportunity-decision-store";
import { PartnerSearch } from "./PartnerSearch";
import { PartnersClient } from "./PartnersClient";

export const dynamic = "force-dynamic";

/**
 * BL-NAV-LIFECYCLE phase 3a (FORGE II footnote 6, C-1, C-11) — the
 * opportunity's Partners tab: the partners considered, choosing, and Move
 * to Plan.
 */
export default async function OpportunityPartnersPage({ params }: { params: { id: string } }) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const [opp] = await db
    .select({ id: opportunities.id, stage: opportunities.stage, naics: opportunities.naicsCode })
    .from(opportunities)
    .where(and(eq(opportunities.id, params.id), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!opp) notFound();
  const [partners, decisions, suggestions, companies, invites, matrix] = await Promise.all([
    listOpportunityPartners(organizationId, params.id),
    latestDecisions(organizationId, [params.id]),
    partnerSuggestions(organizationId, params.id),
    companiesToConsider(organizationId, params.id),
    listPartnerInvites(organizationId, params.id),
    loadCapabilityMatrix(params.id, organizationId),
  ]);
  const decision = decisions.get(params.id)?.decision ?? null;
  const considered = new Set(partners.map((p) => p.companyId));
  const chosen = partners.filter((p) => p.status === "chosen").length;
  return (
    <div className="flex flex-col gap-4">
      <PartnersClient
        opportunityId={params.id}
        decision={decision}
        partners={partners.map((p) => ({ ...p, invite: invites.get(p.id) ?? null }))}
        questionCount={matrix?.questions?.length ?? 0}
        suggestions={suggestions.filter((s) => !considered.has(s.id)).map((s) => ({ id: s.id, name: s.name, why: s.why }))}
        companies={companies}
        blocker={planBlocker({ stage: opp.stage, decision, chosen })}
        naics={opp.naics}
      />
      <PartnerSearch opportunityId={params.id} naics={opp.naics} />
    </div>
  );
}
