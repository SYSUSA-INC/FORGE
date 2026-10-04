/**
 * BL-FB-X-CRM Slice 2 — what an agency has been buying, from USAspending,
 * joined to the people we know there. On demand only (a user clicks
 * "Load"): the public API is slow and rate-limited, so nothing here runs
 * on page render or on a schedule. Gated behind AWARDS_INTEL_ENABLED like
 * the rest of the awards intelligence; audited as a sensitive read because
 * the request names a customer the tenant is working.
 */
import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { recordRead } from "@/lib/audit-log";
import { agencyAwardAttempts, summarizeAgencyAwards, type AgencyAwardsSummary } from "@/lib/crm-logic";
import { searchAwardsByCriteria, type UsaspendingAward } from "@/lib/usaspending";

type Actor = { userId: string | null; email?: string | null };

export type AgencyHistoryAward = Pick<UsaspendingAward, "awardId" | "recipientName" | "amount" | "awardingSubAgency" | "awardType" | "startDate" | "endDate" | "description" | "naicsCode" | "setAsideCode" | "uiUrl">;

export type AgencyProcurementHistory =
  | { ok: true; agency: string; awards: AgencyHistoryAward[]; summary: AgencyAwardsSummary; totalRecords: number; naicsFiltered: boolean; matchedAs: "subagency" | "agency" }
  | { ok: false; disabled?: true; error: string };

const PAGE = 25;

/**
 * Recent contract awards by the agency, most valuable first. Tries the
 * agency name as a sub-tier and then a department, with the tenant's
 * NAICS first and then without; the first non-empty answer wins.
 */
export async function agencyProcurementHistory(input: { organizationId: string; agency: string; actor: Actor; now?: Date }): Promise<AgencyProcurementHistory> {
  const { organizationId } = input;
  if (process.env.AWARDS_INTEL_ENABLED !== "1") {
    return { ok: false, disabled: true, error: "Awards intel is in preview. Ask an admin to set AWARDS_INTEL_ENABLED=1." };
  }
  const agency = input.agency.trim().slice(0, 160);
  if (!agency) return { ok: false, error: "This contact has no agency to look up." };

  const [org] = await db
    .select({ primaryNaics: organizations.primaryNaics, naicsList: organizations.naicsList })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const naics = Array.from(new Set([org?.primaryNaics ?? "", ...(org?.naicsList ?? [])].map((c) => c.trim()).filter(Boolean)));

  let lastError = "USAspending returned no awards for this agency.";
  for (const attempt of agencyAwardAttempts(agency, naics)) {
    const res = await searchAwardsByCriteria({ ...attempt, limit: PAGE, sort: "Award Amount", order: "desc" });
    if (!res.ok) {
      lastError = res.error;
      continue;
    }
    if (res.awards.length === 0) continue;
    const awards: AgencyHistoryAward[] = res.awards.map((a) => ({
      awardId: a.awardId,
      recipientName: a.recipientName,
      amount: a.amount,
      awardingSubAgency: a.awardingSubAgency,
      awardType: a.awardType,
      startDate: a.startDate,
      endDate: a.endDate,
      description: a.description.slice(0, 240),
      naicsCode: a.naicsCode,
      setAsideCode: a.setAsideCode,
      uiUrl: a.uiUrl,
    }));
    const naicsFiltered = !!attempt.naicsCodes?.length;
    const matchedAs = attempt.awardingSubAgencyName ? "subagency" : "agency";
    await recordRead({
      organizationId,
      actor: input.actor,
      action: "crm.agency.history",
      resourceType: "agency",
      resourceId: agency.slice(0, 128),
      metadata: { awards: awards.length, totalRecords: res.totalRecords, naicsFiltered, matchedAs },
    });
    return { ok: true, agency, awards, summary: summarizeAgencyAwards(awards, input.now), totalRecords: res.totalRecords, naicsFiltered, matchedAs };
  }
  return { ok: false, error: lastError };
}
