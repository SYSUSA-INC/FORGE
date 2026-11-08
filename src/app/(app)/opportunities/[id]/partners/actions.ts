"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { addPartnerCandidate, moveToPlan, removePartner, setPartnerStatus } from "@/lib/capture-store";
import { invitePartner, type InviteResult } from "@/lib/partner-invite-store";
import { isPartnerCert } from "@/lib/partner-search-logic";
import { rankPartners, type PartnerRankResult } from "@/lib/partner-rank";
import { ratePartners, type PartnerRateResult } from "@/lib/partner-rate";
import { addPartnerFromSearch, searchPartners, type PartnerSearchResult } from "@/lib/partner-search";

/**
 * BL-NAV-LIFECYCLE phase 3a — Capture on an opportunity: add a company as
 * a candidate partner, choose / decline / reconsider / remove one, and
 * Move to Plan. The organization comes from the session.
 */
type Result = { ok: true } | { ok: false; error: string };

function refresh(opportunityId: string) {
  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath(`/opportunities/${opportunityId}/partners`);
  revalidatePath("/pipeline/capture");
}

async function who() {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return { organizationId, actor: { userId: actor.id, email: actor.email } };
}

export async function addPartnerAction(input: { opportunityId: string; companyId: string; reason?: string }): Promise<Result> {
  const { organizationId, actor } = await who();
  const res = await addPartnerCandidate({ organizationId, opportunityId: String(input?.opportunityId ?? ""), companyId: String(input?.companyId ?? ""), actor, source: "own", reason: String(input?.reason ?? "") });
  if (res.ok) refresh(input.opportunityId);
  return res.ok ? { ok: true } : res;
}

export async function setPartnerStatusAction(input: { opportunityId: string; partnerId: string; status: "chosen" | "declined" | "candidate" }): Promise<Result> {
  const { organizationId, actor } = await who();
  if (!["chosen", "declined", "candidate"].includes(String(input?.status))) return { ok: false, error: "Unknown status." };
  const res = await setPartnerStatus({ organizationId, opportunityId: String(input?.opportunityId ?? ""), partnerId: String(input?.partnerId ?? ""), status: input.status, actor });
  if (res.ok) refresh(input.opportunityId);
  return res;
}

export async function removePartnerAction(input: { opportunityId: string; partnerId: string }): Promise<Result> {
  const { organizationId, actor } = await who();
  const res = await removePartner({ organizationId, opportunityId: String(input?.opportunityId ?? ""), partnerId: String(input?.partnerId ?? ""), actor });
  if (res.ok) refresh(input.opportunityId);
  return res;
}

export async function moveToPlanAction(input: { opportunityId: string }): Promise<Result> {
  const { organizationId, actor } = await who();
  const res = await moveToPlan({ organizationId, opportunityId: String(input?.opportunityId ?? ""), actor });
  if (res.ok) {
    refresh(input.opportunityId);
    revalidatePath("/pipeline/plan");
    revalidatePath("/opportunities");
    revalidatePath("/");
  }
  return res;
}

/** BL-NAV-LIFECYCLE 3a-2 — search the partner database for this opportunity. */
export async function searchPartnersAction(input: { opportunityId: string; state?: string; cert?: string; widen?: boolean }): Promise<PartnerSearchResult> {
  const { organizationId, actor } = await who();
  const cert = String(input?.cert ?? "");
  const state = String(input?.state ?? "").trim().toUpperCase();
  if (state && !/^[A-Z]{2}$/.test(state)) return { ok: false, error: "Use a two-letter state code, e.g. VA." };
  return searchPartners({ organizationId, opportunityId: String(input?.opportunityId ?? ""), actor, state, cert: isPartnerCert(cert) ? cert : "", widen: input?.widen === true });
}

/** BL-NAV-LIFECYCLE 3b — FORGE AI's best ten from the search, each with a reason from its facts; `widen` is Find more. */
export async function rankPartnersAction(input: { opportunityId: string; state?: string; cert?: string; widen?: boolean }): Promise<PartnerRankResult> {
  const { organizationId, actor } = await who();
  const cert = String(input?.cert ?? "");
  const state = String(input?.state ?? "").trim().toUpperCase();
  if (state && !/^[A-Z]{2}$/.test(state)) return { ok: false, error: "Use a two-letter state code, e.g. VA." };
  return rankPartners({ organizationId, opportunityId: String(input?.opportunityId ?? ""), actor, state, cert: isPartnerCert(cert) ? cert : "", widen: input?.widen === true });
}

/** Add a firm from the search: into Companies (from SAM.gov) and onto this opportunity's partners. */
export async function addSearchedPartnerAction(input: { opportunityId: string; uei: string; name: string; city?: string; state?: string; relationship: string; reason: string; fromAi?: boolean }): Promise<Result> {
  const { organizationId, actor } = await who();
  const relationship = input?.relationship === "subcontractor" ? "subcontractor" : "teaming_partner";
  const res = await addPartnerFromSearch({
    organizationId,
    opportunityId: String(input?.opportunityId ?? ""),
    actor,
    uei: String(input?.uei ?? ""),
    name: String(input?.name ?? ""),
    city: String(input?.city ?? ""),
    state: String(input?.state ?? ""),
    relationship,
    source: input?.fromAi === true ? "ai" : "search",
    reason: String(input?.reason ?? "").slice(0, 500),
  });
  if (!res.ok) return res;
  refresh(input.opportunityId);
  revalidatePath("/companies");
  return { ok: true };
}

/**
 * BL-NAV-LIFECYCLE phase 3c — email a partner's contact a personal link to
 * the matrix questions (14 days, no account). The link comes back for
 * Copy link whether or not email is configured.
 */
export async function invitePartnerAction(input: { opportunityId: string; partnerId: string; email: string; contactName?: string }): Promise<InviteResult> {
  const { organizationId, actor } = await who();
  const res = await invitePartner({ organizationId, opportunityId: String(input?.opportunityId ?? ""), partnerId: String(input?.partnerId ?? ""), email: input?.email, contactName: input?.contactName, actor });
  if (res.ok) refresh(input.opportunityId);
  return res;
}

/** BL-NAV-LIFECYCLE 3c-2 — FORGE AI's rating of the partners that answered, scored first, one grounded reason each. */
export async function ratePartnersAction(input: { opportunityId: string }): Promise<PartnerRateResult> {
  const { organizationId, actor } = await who();
  return ratePartners({ organizationId, opportunityId: String(input?.opportunityId ?? ""), actor });
}
