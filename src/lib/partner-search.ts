import "server-only";

import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { certFirms, companies, opportunities, opportunityPartners, organizations, type CompanyRelationship } from "@/db/schema";
import { recordAudit, recordRead } from "@/lib/audit-log";
import { addPartnerCandidate } from "@/lib/capture-store";
import { companyIdByUei, importCompanyFromSam } from "@/lib/company-import";
import { agencyAwardAttempts } from "@/lib/crm-logic";
import { log } from "@/lib/log";
import {
  aggregateRecipients,
  certsFromSamDescriptions,
  mergePartnerHits,
  PARTNER_SEARCH_YEARS,
  setAsideNeed,
  type AwardInput,
  type CertRecord,
  type PartnerCert,
  type PartnerHit,
  type SamRecord,
  type SetAsideNeed,
} from "@/lib/partner-search-logic";
import { searchSamGovEntities } from "@/lib/samgov";
import { resolveSamCredential } from "@/lib/samgov-key";
import { searchAwardsByCriteria, type UsaspendingSearchResult } from "@/lib/usaspending";

/**
 * BL-NAV-LIFECYCLE phase 3a-2 — the partner database search for one
 * opportunity: USAspending (awards under its NAICS code in the last five
 * years, and at its agency), the certification registry, one SAM.gov
 * entity search and the organization's Companies, joined by UEI
 * (`mergePartnerHits`). A source that can't answer is named in `notes`
 * and the others still answer. Recorded as a read,
 * `opportunity.partner.search`. Callers own auth.
 */
type Actor = { userId: string; email?: string | null };

export type PartnerSearchResult =
  | { ok: true; hits: PartnerHit[]; notes: string[]; criteria: { naics: string; agency: string; setAside: string; need: SetAsideNeed } }
  | { ok: false; error: string };

const AWARD_PAGE = 100;

function yearsBefore(now: Date, n: number): string {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
}

function awardInputs(res: UsaspendingSearchResult): AwardInput[] {
  if (!res.ok) return [];
  return res.awards.map((a) => ({
    awardId: a.awardId,
    recipientName: a.recipientName,
    recipientUei: a.recipientUei,
    amount: a.amount,
    awardingAgency: a.awardingAgency,
    awardingSubAgency: a.awardingSubAgency,
    endDate: a.endDate,
    uiUrl: a.uiUrl,
  }));
}

/** Awards under the NAICS code (two pages, most valuable first), and the agency's own under it. */
async function pastPerformance(naics: string, agency: string, now: Date): Promise<{ awards: AwardInput[]; notes: string[] }> {
  if (process.env.AWARDS_INTEL_ENABLED !== "1") {
    return { awards: [], notes: ["Past performance from USAspending is off on this deployment (an administrator turns it on with AWARDS_INTEL_ENABLED)."] };
  }
  const window = { timePeriodStart: yearsBefore(now, PARTNER_SEARCH_YEARS), timePeriodEnd: now.toISOString().slice(0, 10), limit: AWARD_PAGE, sort: "Award Amount", order: "desc" as const };
  const agencyAttempts = agencyAwardAttempts(agency, [naics]).filter((a) => a.naicsCodes?.length);
  const [p1, p2, atAgency] = await Promise.all([
    searchAwardsByCriteria({ ...window, naicsCodes: [naics], page: 1 }),
    searchAwardsByCriteria({ ...window, naicsCodes: [naics], page: 2 }),
    (async () => {
      for (const attempt of agencyAttempts) {
        const res = await searchAwardsByCriteria({ ...window, ...attempt });
        if (res.ok && res.awards.length > 0) return res;
      }
      return null;
    })(),
  ]);
  const notes: string[] = [];
  if (!p1.ok) notes.push(`USAspending didn't answer (${p1.error.slice(0, 120)}); past performance is missing from this search.`);
  return { awards: [...awardInputs(p1), ...awardInputs(p2), ...(atAgency ? awardInputs(atAgency) : [])], notes };
}

/** One SAM.gov entity search: registered, active, under the NAICS code (SAM.gov returns at most ten). */
async function samEntities(organizationId: string, naics: string, state: string): Promise<{ sam: SamRecord[]; notes: string[] }> {
  const key = await resolveSamCredential(organizationId);
  if (!key.ok) return { sam: [], notes: [`SAM.gov wasn't searched: ${key.failure.error}`] };
  const res = await searchSamGovEntities(key.cred, { naics, state: state || undefined });
  if (!res.ok) return { sam: [], notes: [`SAM.gov didn't answer: ${res.error}`] };
  return {
    sam: res.entities
      .filter((e) => e.ueiSAM)
      .map((e) => ({
        uei: e.ueiSAM,
        name: e.legalBusinessName,
        cage: e.cageCode,
        city: e.physicalAddressCity,
        state: e.physicalAddressStateOrProvinceCode,
        naics: e.primaryNaics,
        expires: e.registrationExpirationDate,
        certs: certsFromSamDescriptions(e.sbaCertifications),
      })),
    notes: [],
  };
}

/** Current certifications: firms under the NAICS code, and every certification of the UEIs found elsewhere. */
async function certRecords(naics: string, ueis: string[], now: Date, filters: { state: string; cert: PartnerCert | "" }): Promise<CertRecord[]> {
  const current = or(isNull(certFirms.certExitDate), gt(certFirms.certExitDate, now));
  const select = { uei: certFirms.uei, name: certFirms.firmName, certType: certFirms.certType, city: certFirms.city, state: certFirms.state, naics: certFirms.naicsPrimary };
  const byNaics = db
    .select(select)
    .from(certFirms)
    .where(and(eq(certFirms.naicsPrimary, naics), current, filters.state ? eq(certFirms.state, filters.state) : undefined, filters.cert ? eq(certFirms.certType, filters.cert) : undefined))
    .limit(300);
  const byUei = ueis.length ? db.select(select).from(certFirms).where(and(inArray(certFirms.uei, ueis), current)).limit(1000) : Promise.resolve([] as CertRecord[]);
  const [a, b] = await Promise.all([byNaics, byUei]);
  return [...a, ...b];
}

export async function searchPartners(input: {
  organizationId: string;
  opportunityId: string;
  actor: Actor;
  state?: string;
  cert?: PartnerCert | "";
  now?: Date;
}): Promise<PartnerSearchResult> {
  const { organizationId, opportunityId } = input;
  const now = input.now ?? new Date();
  const state = (input.state ?? "").trim().toUpperCase().slice(0, 2);
  const cert = input.cert ?? "";
  const [opp] = await db
    .select({ naics: opportunities.naicsCode, agency: opportunities.agency, setAside: opportunities.setAside })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!opp) return { ok: false, error: "Opportunity not found." };
  const naics = opp.naics.replace(/[^0-9]/g, "").slice(0, 6);
  if (!naics) return { ok: false, error: "Add the opportunity's NAICS code first: every source is searched by it." };
  const agency = opp.agency.trim();

  const [past, samRes, [org], considered] = await Promise.all([
    pastPerformance(naics, agency, now).catch((err) => {
      log.warn("[partner-search]", "usaspending failed", { opportunityId, error: err instanceof Error ? err.message : err });
      return { awards: [] as AwardInput[], notes: ["USAspending didn't answer; past performance is missing from this search."] };
    }),
    samEntities(organizationId, naics, state).catch((err) => {
      log.warn("[partner-search]", "sam.gov failed", { opportunityId, error: err instanceof Error ? err.message : err });
      return { sam: [] as SamRecord[], notes: ["SAM.gov didn't answer."] };
    }),
    db.select({ uei: organizations.uei }).from(organizations).where(eq(organizations.id, organizationId)).limit(1),
    db
      .select({ companyId: opportunityPartners.companyId })
      .from(opportunityPartners)
      .where(and(eq(opportunityPartners.organizationId, organizationId), eq(opportunityPartners.opportunityId, opportunityId))),
  ]);
  const recipients = aggregateRecipients(past.awards, agency);
  const found = [...new Set([...recipients.keys(), ...samRes.sam.map((s) => s.uei.toUpperCase())])].slice(0, 1000);
  const certs = await certRecords(naics, found, now, { state, cert });
  const allUeis = [...new Set([...found, ...certs.map((c) => c.uei.toUpperCase())])];
  const own = allUeis.length
    ? await db
        .select({ id: companies.id, uei: companies.uei, name: companies.name, relationship: companies.relationship })
        .from(companies)
        .where(and(eq(companies.organizationId, organizationId), inArray(companies.uei, allUeis)))
    : [];

  const need = setAsideNeed(opp.setAside);
  const hits = mergePartnerHits({
    recipients,
    certs,
    sam: samRes.sam,
    companies: own,
    consideredCompanyIds: new Set(considered.map((c) => c.companyId)),
    ownUei: org?.uei ?? "",
    need,
    naics,
    agency,
    filters: { state, cert },
  });
  await recordRead({
    organizationId,
    actor: input.actor,
    action: "opportunity.partner.search",
    resourceType: "opportunity",
    resourceId: opportunityId,
    metadata: { naics, agency, state, cert, awards: past.awards.length, certifications: certs.length, sam: samRes.sam.length, hits: hits.length },
  });
  return { ok: true, hits, notes: [...past.notes, ...samRes.notes], criteria: { naics, agency, setAside: opp.setAside, need } };
}

const UEI_RE = /^[A-Z0-9]{12}$/;

/**
 * A partner from the search onto the opportunity: the company already in
 * Companies, else imported from SAM.gov with the relationship chosen, else
 * (SAM.gov can't be reached) written from the search's own facts and
 * marked as such, so a missing key never blocks the choice. Then added as
 * a candidate with the facts as its reason.
 */
export async function addPartnerFromSearch(input: {
  organizationId: string;
  opportunityId: string;
  actor: Actor;
  uei: string;
  name: string;
  city?: string;
  state?: string;
  relationship: Extract<CompanyRelationship, "teaming_partner" | "subcontractor">;
  reason: string;
}): Promise<{ ok: true; id: string; companyId: string; fromSam: boolean } | { ok: false; error: string }> {
  const { organizationId } = input;
  const uei = input.uei.trim().toUpperCase();
  if (!UEI_RE.test(uei)) return { ok: false, error: "That isn't a UEI." };
  const [opp] = await db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(and(eq(opportunities.id, input.opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!opp) return { ok: false, error: "Opportunity not found." };

  let companyId = await companyIdByUei(organizationId, uei);
  let fromSam = false;
  if (!companyId) {
    const imported = await importCompanyFromSam({ organizationId, actor: input.actor, uei, relationship: input.relationship });
    if (imported.ok) {
      companyId = imported.id;
      fromSam = true;
    } else {
      const name = input.name.trim().slice(0, 200) || uei;
      const [row] = await db
        .insert(companies)
        .values({
          organizationId,
          createdByUserId: input.actor.userId,
          relationship: input.relationship,
          name,
          uei,
          city: (input.city ?? "").slice(0, 120),
          state: (input.state ?? "").slice(0, 2).toUpperCase(),
          notes: `Added from the partner search; SAM.gov couldn't be reached (${imported.error.slice(0, 160)}). Refresh from SAM.gov on the company page.`,
          syncSource: "partner_search",
        })
        .returning({ id: companies.id });
      if (!row) return { ok: false, error: "The company couldn't be saved." };
      companyId = row.id;
      await recordAudit({ organizationId, actor: input.actor, action: "company.create", resourceType: "company", resourceId: row.id, metadata: { uei, relationship: input.relationship, source: "partner_search", samError: imported.error.slice(0, 160) } });
    }
  }
  const added = await addPartnerCandidate({ organizationId, opportunityId: input.opportunityId, companyId, actor: input.actor, source: "search", reason: input.reason });
  if (!added.ok) return added;
  return { ok: true, id: added.id, companyId, fromSam };
}
