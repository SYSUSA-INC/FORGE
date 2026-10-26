import "server-only";

import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeEntries, opportunities, opportunityCapabilityMatrices, organizations } from "@/db/schema";
import { CAPABILITY_ANSWER_LABELS } from "@/lib/capability-matrix-types";
import type { CompanyModelSources, EvidenceLabel } from "@/lib/company-model";
import type { CompanyModelPromptInput } from "@/lib/company-model-prompt";
import { loadDecidedPursuits } from "@/lib/loss-intelligence";
import { rowToOrgProfile, type SocioEconomic } from "@/lib/org-types";

/**
 * BL-COMPANY-MODEL — everything a build reads, gathered in one place and
 * org-scoped: the profile, the capability-statement and other capability,
 * past-performance and personnel entries, the decided bids with their
 * loss reasons, and the confirmed questionnaire answers.
 */
export const COMPANY_MODEL_KNOWLEDGE_LIMIT = 40;
export const COMPANY_MODEL_PURSUIT_LIMIT = 20;
export const COMPANY_MODEL_ANSWER_LIMIT = 200;

const SET_ASIDE_LABELS: Record<keyof SocioEconomic, string> = {
  sba8a: "8(a)",
  smallBusiness: "Small business",
  sdb: "SDB",
  wosb: "WOSB",
  sdvosb: "SDVOSB",
  hubzone: "HUBZone",
};

function setAsideLabels(socio: SocioEconomic): string[] {
  return (Object.keys(SET_ASIDE_LABELS) as (keyof SocioEconomic)[]).filter((k) => socio[k]).map((k) => SET_ASIDE_LABELS[k]);
}

export type CompanyModelInputs = {
  prompt: Omit<CompanyModelPromptInput, "approved">;
  sources: CompanyModelSources;
  /** Every evidence id the prompt showed, with a label for the page. */
  allowedEvidence: Map<string, EvidenceLabel>;
  naicsCodes: Set<string>;
};

export async function loadCompanyModelInputs(organizationId: string): Promise<CompanyModelInputs | null> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) return null;
  const profile = rowToOrgProfile(org);

  const entries = await db
    .select({ id: knowledgeEntries.id, kind: knowledgeEntries.kind, title: knowledgeEntries.title, body: knowledgeEntries.body, tags: knowledgeEntries.tags })
    .from(knowledgeEntries)
    .where(and(eq(knowledgeEntries.organizationId, organizationId), ne(knowledgeEntries.kind, "boilerplate"), isNull(knowledgeEntries.archivedAt)))
    .orderBy(
      desc(sql`'capability-statement' = ANY(${knowledgeEntries.tags})`),
      sql`${knowledgeEntries.qualityScore} DESC NULLS LAST`,
      desc(knowledgeEntries.updatedAt),
    )
    .limit(COMPANY_MODEL_KNOWLEDGE_LIMIT);

  const pursuits = (await loadDecidedPursuits(organizationId))
    .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))
    .slice(0, COMPANY_MODEL_PURSUIT_LIMIT);

  const matrices = await db
    .select({ opportunityId: opportunityCapabilityMatrices.opportunityId, title: opportunities.title, questions: opportunityCapabilityMatrices.questions, answers: opportunityCapabilityMatrices.answers })
    .from(opportunityCapabilityMatrices)
    .innerJoin(opportunities, eq(opportunities.id, opportunityCapabilityMatrices.opportunityId))
    .where(and(eq(opportunityCapabilityMatrices.organizationId, organizationId), eq(opportunities.organizationId, organizationId)))
    .orderBy(desc(opportunityCapabilityMatrices.updatedAt))
    .limit(50);
  const questionnaireAnswers: CompanyModelPromptInput["questionnaireAnswers"] = [];
  const questionnaireOpportunityIds: string[] = [];
  for (const m of matrices) {
    let used = false;
    for (const q of m.questions) {
      const a = m.answers[q.id];
      if (!a || questionnaireAnswers.length >= COMPANY_MODEL_ANSWER_LIMIT) continue;
      used = true;
      questionnaireAnswers.push({ opportunityId: m.opportunityId, opportunityTitle: m.title, questionId: q.id, question: q.text, value: CAPABILITY_ANSWER_LABELS[a.value], evidence: a.evidence });
    }
    if (used) questionnaireOpportunityIds.push(m.opportunityId);
  }

  const allowedEvidence = new Map<string, EvidenceLabel>();
  for (const p of profile.pastPerformance) allowedEvidence.set(`pp:${p.id}`, { kind: "past_performance", label: `${p.customer} — ${p.contract}`.trim() });
  for (const e of entries) allowedEvidence.set(`knowledge:${e.id}`, { kind: "knowledge", label: e.title });
  for (const b of pursuits) allowedEvidence.set(`proposal:${b.proposalId}`, { kind: "proposal", label: `${b.title} (${b.outcome})` });
  for (const a of questionnaireAnswers) allowedEvidence.set(`questionnaire:${a.opportunityId}:${a.questionId}`, { kind: "questionnaire", label: `${a.opportunityTitle}: ${a.question.slice(0, 60)}` });

  const naicsCodes = new Set([profile.primaryNaics, ...profile.naicsList].map((c) => c.replace(/\D/g, "")).filter(Boolean));
  const registrationOnly = profile.pastPerformance.length === 0 && entries.length === 0 && pursuits.length === 0 && questionnaireAnswers.length === 0;

  return {
    prompt: {
      organization: {
        name: profile.name,
        website: profile.website,
        state: profile.address.state,
        primaryNaics: profile.primaryNaics,
        naicsList: profile.naicsList,
        pscCodes: profile.pscCodes,
        setAsides: setAsideLabels(profile.socioEconomic),
        vehicles: profile.contractingVehicles.map((v) => v.name),
        companySecurityLevel: profile.companySecurityLevel,
        employeeSecurityLevel: profile.employeeSecurityLevel,
        dcaaCompliant: profile.dcaaCompliant,
        keywords: profile.searchKeywords,
      },
      pastPerformance: profile.pastPerformance,
      knowledgeEntries: entries,
      pursuits: pursuits.map((b) => ({ proposalId: b.proposalId, title: b.title, outcome: b.outcome, agency: b.agency, naicsCode: b.naicsCode, reasons: b.reasons, awardedTo: b.awardedTo, decidedAt: b.decidedAt })),
      questionnaireAnswers,
    },
    sources: {
      knowledgeEntryIds: entries.map((e) => e.id),
      pastPerformanceIds: profile.pastPerformance.map((p) => p.id),
      proposalIds: pursuits.map((b) => b.proposalId),
      questionnaireOpportunityIds,
      outcomes: { won: pursuits.filter((b) => b.outcome === "won").length, lost: pursuits.filter((b) => b.outcome === "lost").length },
      registrationOnly,
    },
    allowedEvidence,
    naicsCodes,
  };
}
