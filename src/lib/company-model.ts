import { z } from "zod";

/**
 * BL-COMPANY-MODEL — FORGE's own account of what the company does. Pure
 * types and logic: the record's shape, the schema the AI answers with
 * (and edits are checked against), and the acceptance pass that keeps
 * only evidence the build actually showed the model.
 *
 * Nothing here reads a database. A draft never counts: readers (phase
 * 1c) use the approved version only, and a person approves it.
 */

export const COMPANY_MODEL_LIMITS = {
  summary: 2_000,
  capabilities: 25,
  naicsWork: 20,
  customers: 25,
  differentiators: 12,
  gaps: 12,
  partners: 12,
  keywords: 20,
  evidencePerCapability: 6,
  line: 300,
  short: 120,
} as const;

export const CAPABILITY_STRENGTHS = ["proven", "unproven", "partial"] as const;
export type CapabilityStrength = (typeof CAPABILITY_STRENGTHS)[number];

const line = (max: number) => z.string().trim().max(max);

/** The record's body: what the AI returns, what a person edits, what is approved. */
export const companyModelBodySchema = z.object({
  summary: z.string().trim().max(COMPANY_MODEL_LIMITS.summary),
  capabilities: z
    .array(
      z.object({
        name: line(COMPANY_MODEL_LIMITS.short),
        description: line(COMPANY_MODEL_LIMITS.line),
        strength: z.enum(CAPABILITY_STRENGTHS),
        /** "knowledge:<id>", "pp:<id>", "proposal:<id>" or "questionnaire:<opportunityId>:<questionId>". */
        evidence: z.array(z.string().trim().max(120)).max(COMPANY_MODEL_LIMITS.evidencePerCapability),
      }),
    )
    .max(COMPANY_MODEL_LIMITS.capabilities),
  naicsWork: z.array(z.object({ code: line(12), whatWeDo: line(COMPANY_MODEL_LIMITS.line) })).max(COMPANY_MODEL_LIMITS.naicsWork),
  customers: z
    .array(z.object({ agency: line(COMPANY_MODEL_LIMITS.short), work: line(COMPANY_MODEL_LIMITS.line), outcomes: line(COMPANY_MODEL_LIMITS.short) }))
    .max(COMPANY_MODEL_LIMITS.customers),
  differentiators: z.array(line(COMPANY_MODEL_LIMITS.line)).max(COMPANY_MODEL_LIMITS.differentiators),
  gaps: z.array(line(COMPANY_MODEL_LIMITS.line)).max(COMPANY_MODEL_LIMITS.gaps),
  partners: z.array(z.object({ name: line(COMPANY_MODEL_LIMITS.short), covers: line(COMPANY_MODEL_LIMITS.line) })).max(COMPANY_MODEL_LIMITS.partners),
  keywords: z.array(line(40)).max(COMPANY_MODEL_LIMITS.keywords),
});
export type CompanyModelBody = z.infer<typeof companyModelBodySchema>;

/** What a build read, kept beside the draft so a reader knows its basis. */
export type CompanyModelSources = {
  knowledgeEntryIds: string[];
  pastPerformanceIds: string[];
  proposalIds: string[];
  /** Opportunities whose confirmed questionnaire answers were read. */
  questionnaireOpportunityIds: string[];
  outcomes: { won: number; lost: number };
  /** True when only the registration was available (a new tenant). */
  registrationOnly: boolean;
  /** The NAICS codes at build time, so a later change reads as a staleness reason (absent on older builds). */
  naicsCodes?: string[];
};

export function emptyCompanyModel(): CompanyModelBody {
  return { summary: "", capabilities: [], naicsWork: [], customers: [], differentiators: [], gaps: [], partners: [], keywords: [] };
}

/** A label for an evidence reference, from what the build showed. */
export type EvidenceLabel = { kind: "knowledge" | "past_performance" | "proposal" | "questionnaire" | "lesson"; label: string };

/**
 * Keep the AI's draft honest: evidence must be a reference the prompt
 * showed; a "proven" capability with no surviving evidence is downgraded
 * to "unproven"; empty lines and duplicate keywords are dropped; NAICS
 * work is kept only for codes the company lists.
 */
export function acceptCompanyModel(input: {
  parsed: CompanyModelBody;
  allowedEvidence: ReadonlyMap<string, EvidenceLabel>;
  naicsCodes: ReadonlySet<string>;
}): CompanyModelBody {
  const p = input.parsed;
  const seenKw = new Set<string>();
  const keywords: string[] = [];
  for (const k of p.keywords) {
    const key = k.toLowerCase();
    if (!k || seenKw.has(key)) continue;
    seenKw.add(key);
    keywords.push(k);
  }
  return {
    summary: p.summary,
    capabilities: p.capabilities
      .filter((c) => c.name)
      .map((c) => {
        const evidence = Array.from(new Set(c.evidence.filter((e) => input.allowedEvidence.has(e))));
        const strength: CapabilityStrength = c.strength === "proven" && evidence.length === 0 ? "unproven" : c.strength;
        return { ...c, strength, evidence };
      }),
    naicsWork: p.naicsWork.filter((n) => n.code && input.naicsCodes.has(n.code.replace(/\D/g, "")) && n.whatWeDo).map((n) => ({ ...n, code: n.code.replace(/\D/g, "") })),
    customers: p.customers.filter((c) => c.agency),
    differentiators: p.differentiators.filter(Boolean),
    gaps: p.gaps.filter(Boolean),
    partners: p.partners.filter((x) => x.name),
    keywords,
  };
}

/** A person's edit: the same schema, blanks dropped, nothing else changed. */
export function sanitizeCompanyModelBody(raw: unknown): CompanyModelBody | null {
  const parsed = companyModelBodySchema.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  return {
    summary: p.summary,
    capabilities: p.capabilities.filter((c) => c.name).map((c) => ({ ...c, evidence: c.evidence.filter(Boolean) })),
    naicsWork: p.naicsWork.filter((n) => n.code && n.whatWeDo),
    customers: p.customers.filter((c) => c.agency),
    differentiators: p.differentiators.filter(Boolean),
    gaps: p.gaps.filter(Boolean),
    partners: p.partners.filter((x) => x.name),
    keywords: Array.from(new Set(p.keywords.filter(Boolean))),
  };
}

/** How many fields differ between two bodies, for "N changes since approval". */
export function companyModelChanges(a: CompanyModelBody | null, b: CompanyModelBody | null): number {
  if (!a || !b) return a === b ? 0 : 8;
  let n = 0;
  for (const key of Object.keys(a) as (keyof CompanyModelBody)[]) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) n += 1;
  }
  return n;
}

/** One line per list item, for the plain editors on the Settings page. */
export function linesToList(text: string, max: number): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

/** A stable id for a capability, for "model:<ref>" evidence references. */
export function modelCapabilityRef(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "capability";
}

/**
 * The approved model as the scout's triage reads capabilities: the
 * summary first, then one line per capability with its strength.
 */
export function companyModelAsCapabilities(body: CompanyModelBody, version: number, max = 12): { title: string; text: string }[] {
  const out: { title: string; text: string }[] = [];
  if (body.summary) out.push({ title: `Company model v${version}`, text: body.summary.replace(/\s+/g, " ").slice(0, 700) });
  for (const c of body.capabilities.slice(0, max)) {
    out.push({ title: c.name.slice(0, 120), text: `${c.description} (${c.strength})`.replace(/\s+/g, " ").slice(0, 700) });
  }
  return out;
}

/** The model's keywords the scout profile does not search yet. */
export function keywordsNotSearched(model: CompanyModelBody, searchKeywords: string[]): string[] {
  const have = new Set(searchKeywords.map((k) => k.trim().toLowerCase()).filter(Boolean));
  return model.keywords.filter((k) => k && !have.has(k.trim().toLowerCase()));
}
