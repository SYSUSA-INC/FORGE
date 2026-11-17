/**
 * BL-NAV-LIFECYCLE 5b — the research step before "draft all sections".
 *
 * `runProposalResearch` reserves searches against the tenant's monthly
 * allowance BEFORE it searches (one atomic statement that cannot pass the
 * cap), asks the model to search the web for public facts about the
 * customer and the requirement, keeps the pages it cited as numbered
 * sources, and gives back the searches it did not use. In stub mode, with
 * research off, or with nothing left in the allowance it does nothing and
 * says why; it never fails the drafts that follow.
 *
 * What comes back from the web is untrusted: it is stored as quoted text,
 * never as instructions, and is kept apart from the company's own facts.
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { backgroundJobs, opportunities, proposals, type BackgroundJob } from "@/db/schema";
import { completeForTenant, getAIProviderStatus } from "@/lib/ai";
import { recordAudit } from "@/lib/audit-log";
import { JobPermanentError } from "@/lib/jobs-policy";
import { log } from "@/lib/log";
import { getResearchSettings, replaceResearchSources } from "@/lib/research-store";
import {
  buildResearchPrompt,
  MAX_SEARCHES_PER_RUN,
  searchToolDomains,
  selectResearchSources,
} from "@/lib/research-logic";
import { enforceQuota, QuotaExceededError, refundQuota, releaseWebSearches, reserveWebSearches } from "@/lib/subscription-gates";

export type ResearchRun =
  | { ok: true; searches: number; sources: number }
  | { ok: false; skipped: string };

export async function runProposalResearch(input: {
  organizationId: string;
  proposalId: string;
  userId: string | null;
}): Promise<ResearchRun> {
  const { organizationId, proposalId } = input;

  const settings = await getResearchSettings(organizationId);
  if (!settings.enabled) return { ok: false, skipped: "Research is off for this organization." };
  // Stub mode (no key) and other providers cannot search: say so, spend nothing.
  if (getAIProviderStatus().active.name !== "anthropic") {
    return { ok: false, skipped: "Web research needs the Anthropic provider; AI is in stub mode, so no search ran." };
  }

  const [row] = await db
    .select({
      title: proposals.title,
      agency: opportunities.agency,
      naicsCode: opportunities.naicsCode,
      description: opportunities.description,
    })
    .from(proposals)
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new JobPermanentError("Proposal no longer exists.");

  // The cap is checked here, before any search: reserve, search, give back the rest.
  const reservation = await reserveWebSearches(organizationId, MAX_SEARCHES_PER_RUN, { proposalId });
  if (reservation.reserved === 0) {
    return {
      ok: false,
      skipped:
        reservation.cap === 0
          ? "No web searches are included in this plan, or the cap is 0, and no pack searches are left. An org admin can buy a pack on Settings → Billing."
          : `This month's web search allowance is used (${reservation.used} of ${reservation.cap}) and no pack searches are left. Research resumes next month, or at once when an org admin buys a pack on Settings → Billing.`,
    };
  }
  const giveBack = async (unused: number, requestSlot: boolean) => {
    await releaseWebSearches(organizationId, unused, { fromPack: reservation.fromPack, proposalId });
    if (requestSlot) await refundQuota(organizationId, "aiRequestsPerMonth");
  };

  try {
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    await releaseWebSearches(organizationId, reservation.reserved, { fromPack: reservation.fromPack, proposalId });
    if (err instanceof QuotaExceededError) return { ok: false, skipped: err.message };
    throw err;
  }

  const prompt = buildResearchPrompt({
    agency: row.agency ?? "",
    title: row.title,
    naicsCode: row.naicsCode ?? "",
    description: row.description ?? "",
  });
  let ai;
  try {
    ai = await completeForTenant({
      organizationId,
      feature: "develop_research",
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
      maxTokens: 2000,
      webSearch: { maxUses: reservation.reserved, ...camel(searchToolDomains(settings)) },
    });
  } catch (err) {
    // The call failed: nothing was delivered; give back every slot.
    await giveBack(reservation.reserved, true);
    throw err;
  }

  if (ai.stubbed || !ai.webSearch) {
    await giveBack(reservation.reserved, true);
    return { ok: false, skipped: "The AI provider did not run a web search, so no research was stored." };
  }

  const searches = Math.min(ai.webSearch.requests, reservation.reserved);
  await releaseWebSearches(organizationId, reservation.reserved - searches, { fromPack: reservation.fromPack, proposalId });
  const sources = selectResearchSources({ citations: ai.webSearch.citations, pageAges: ai.webSearch.pageAges, settings });
  const stored = sources.length > 0 ? await replaceResearchSources({ organizationId, proposalId, userId: input.userId, sources, retrievedAt: new Date() }) : 0;

  await recordAudit({
    organizationId,
    actor: { userId: input.userId, email: null },
    action: "proposal.research.run",
    resourceType: "proposal",
    resourceId: proposalId,
    metadata: { searches, reserved: reservation.reserved, fromPack: Math.max(0, reservation.fromPack - (reservation.reserved - searches)), sources: stored, model: ai.model, allowList: settings.allowedDomains.length, blockList: settings.blockedDomains.length },
  });
  if (stored === 0) {
    log.info("[research]", "no usable sources", { organizationId, proposalId, searches });
    return { ok: false, skipped: `Searched ${searches} time${searches === 1 ? "" : "s"} but found nothing citable; drafts use the company's own records only.` };
  }
  return { ok: true, searches, sources: stored };
}

function camel(d: { allowed_domains?: string[]; blocked_domains?: string[] }) {
  return { allowedDomains: d.allowed_domains, blockedDomains: d.blocked_domains };
}

/** The `proposal_research` job: record the outcome on the row; a skipped run is a finished job, not a failure. */
export async function handleProposalResearch(job: BackgroundJob): Promise<void> {
  const organizationId = job.organizationId;
  const proposalId = typeof job.payload.proposalId === "string" ? job.payload.proposalId : job.resourceId;
  const res = await runProposalResearch({ organizationId, proposalId, userId: job.requestedByUserId });
  await db
    .update(backgroundJobs)
    .set({
      payload: { ...job.payload, ...(res.ok ? { searches: res.searches, sources: res.sources } : { skipped: res.skipped }) },
      updatedAt: new Date(),
    })
    .where(and(eq(backgroundJobs.id, job.id), eq(backgroundJobs.organizationId, organizationId)));
}
