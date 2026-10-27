import { COMPANY_MODEL_LIMITS } from "@/lib/company-model";

/**
 * BL-COMPANY-MODEL — the prompt that drafts the company model from
 * everything FORGE holds about the organisation. Pure: strings only.
 * Every evidence reference the model may cite is given here with its
 * id, and the acceptance pass drops any it invents.
 */
const BODY_MAX = 700;

export type CompanyModelPromptInput = {
  organization: {
    name: string;
    website: string;
    state: string;
    primaryNaics: string;
    naicsList: string[];
    pscCodes: string[];
    setAsides: string[];
    vehicles: string[];
    companySecurityLevel: string;
    employeeSecurityLevel: string;
    dcaaCompliant: boolean;
    keywords: string[];
  };
  pastPerformance: { id: string; customer: string; contract: string; value: string; periodStart: string; periodEnd: string; description: string }[];
  knowledgeEntries: { id: string; kind: string; title: string; body: string; tags: string[] }[];
  pursuits: { proposalId: string; title: string; outcome: "won" | "lost"; agency: string; naicsCode: string; reasons: string[]; awardedTo: string; decidedAt: string | null }[];
  questionnaireAnswers: { opportunityId: string; opportunityTitle: string; questionId: string; question: string; value: string; evidence: string }[];
  /** BL-LESSONS-LOOP 4b — confirmed lessons of kind avoid or watch, as gap evidence ("lesson:<id>"). */
  lessons?: { id: string; kind: string; text: string; from: string }[];
  /** The approved body, when rebuilding: the model revises rather than starts over. */
  approved: string | null;
};

export function buildCompanyModelPrompt(input: CompanyModelPromptInput): { system: string; messages: { role: "user"; content: string }[] } {
  const L = COMPANY_MODEL_LIMITS;
  const system = `You are a capture strategist writing a government contractor's own account of what it does, for the bid team that will correct and approve it. Everything you write is read later by the tools that scout opportunities, judge fit and draft proposals, so it must be true and specific.

Rules:
- Use only the material given: the registration, the past performance, the knowledge entries, the decided bids and the confirmed questionnaire answers. Never invent a contract, customer, clearance, certification or number.
- "summary": one or two paragraphs, present tense, plain words, what the company does and for whom.
- "capabilities": up to ${L.capabilities}, each one concrete thing the company does, with "strength" proven (evidence given), unproven (claimed, no evidence) or partial, and "evidence" listing the ids of the material that shows it, exactly as given (pp:<id>, knowledge:<id>, proposal:<id>, questionnaire:<opportunityId>:<questionId>). "proven" needs at least one evidence id.
- "naicsWork": for each NAICS code the company lists, what it actually does under that code in its own work, not the code's dictionary meaning; skip a code the material says nothing about.
- "customers": agencies the material shows the company has served or bid to, with the work and how it went.
- "differentiators": what the material shows the company does better or differently; "gaps": what lost bids, debriefs, gap answers in the questionnaires and the confirmed lessons keep pointing at (cite a lesson as lesson:<id>); "partners": companies the material shows covering a gap.
- "keywords": up to ${L.keywords} short search terms (1 to 3 words) that find this company's kind of work on a procurement site: the services behind the codes, not the codes, and not generic words.
- Fewer, grounded statements beat a full-looking record. Leave a list empty when the material gives nothing for it.${input.approved ? "\n- An approved model exists; revise it from the material rather than starting over, keeping what still holds." : ""}`;

  const o = input.organization;
  const pp = input.pastPerformance
    .map((p) => `- id=pp:${p.id} | ${p.customer || "unknown customer"} | ${p.contract || "unnamed contract"} | ${p.value || "value n/a"} | ${p.periodStart || "?"} to ${p.periodEnd || "?"}\n  ${p.description.replace(/\n/g, " ").slice(0, BODY_MAX) || "(no description)"}`)
    .join("\n");
  const kb = input.knowledgeEntries
    .map((e) => `- id=knowledge:${e.id} | kind=${e.kind} | tags=${e.tags.join(",") || "(none)"} | title="${e.title}"\n  ${e.body.replace(/\n/g, " ").slice(0, BODY_MAX)}`)
    .join("\n");
  const bids = input.pursuits
    .map((b) => `- id=proposal:${b.proposalId} | ${b.outcome.toUpperCase()} | ${b.title} | ${b.agency || "agency n/a"} | NAICS ${b.naicsCode || "n/a"} | ${b.decidedAt?.slice(0, 10) ?? "date n/a"}${b.reasons.length ? ` | reasons: ${b.reasons.join(", ")}` : ""}${b.awardedTo ? ` | awarded to ${b.awardedTo}` : ""}`)
    .join("\n");
  const qa = input.questionnaireAnswers
    .map((a) => `- id=questionnaire:${a.opportunityId}:${a.questionId} | ${a.opportunityTitle} | ${a.question} → ${a.value}${a.evidence ? ` (${a.evidence.slice(0, 200)})` : ""}`)
    .join("\n");

  const user = `Company: ${o.name}${o.website ? ` (${o.website})` : ""}${o.state ? `, ${o.state}` : ""}
Primary NAICS: ${o.primaryNaics || "none"} · NAICS list: ${o.naicsList.join(", ") || "none"} · PSC: ${o.pscCodes.join(", ") || "none"}
Set-asides: ${o.setAsides.join(", ") || "none"} · Vehicles: ${o.vehicles.join(", ") || "none"}
Clearances: facility ${o.companySecurityLevel || "none"}, personnel ${o.employeeSecurityLevel || "none"} · DCAA compliant: ${o.dcaaCompliant ? "yes" : "no"}
Current scout keywords: ${o.keywords.join(", ") || "none"}

Past performance (${input.pastPerformance.length}):
${pp || "(none on file)"}

Knowledge entries (${input.knowledgeEntries.length}):
${kb || "(none)"}

Decided bids (${input.pursuits.length}):
${bids || "(none)"}

Confirmed capability questionnaire answers (${input.questionnaireAnswers.length}):
${qa || "(none)"}

Confirmed lessons from decided bids (${input.lessons?.length ?? 0}):
${(input.lessons ?? []).map((l) => `- id=lesson:${l.id} | ${l.kind} | ${l.text} — from ${l.from}`).join("\n") || "(none)"}
${input.approved ? `\nApproved model to revise:\n${input.approved}\n` : ""}
Write the company model with the tool.`;

  return { system, messages: [{ role: "user", content: user }] };
}
