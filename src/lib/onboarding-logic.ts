/**
 * BL-AIP-7d part ii — AI-assisted onboarding from a UEI, pure parts.
 *
 * A new tenant used to land on an empty Command Center. Now an org admin
 * sees a "Getting started" panel until the organization has a UEI, its
 * NAICS, scout keywords and a capability statement; the AI proposes the
 * leap from the registration to that starting setup, and the admin
 * edits it before anything is saved. Status rules and the proposal
 * sanitizer live here so both are unit-tested.
 */

export type OnboardingSocio = {
  sba8a: boolean;
  smallBusiness: boolean;
  sdb: boolean;
  wosb: boolean;
  sdvosb: boolean;
  hubzone: boolean;
};

export const SOCIO_LABELS: Record<keyof OnboardingSocio, string> = {
  sba8a: "8(a)",
  smallBusiness: "Small business",
  sdb: "Small disadvantaged business",
  wosb: "Woman-owned small business",
  sdvosb: "Service-disabled veteran-owned small business",
  hubzone: "HUBZone",
};

export function socioLabels(socio: Partial<OnboardingSocio> | null | undefined): string[] {
  if (!socio) return [];
  return (Object.keys(SOCIO_LABELS) as (keyof OnboardingSocio)[])
    .filter((k) => socio[k])
    .map((k) => SOCIO_LABELS[k]);
}

/** What the panel knows about the organization. */
export type OnboardingProfile = {
  name: string;
  uei: string;
  cageCode: string;
  website: string;
  state: string;
  primaryNaics: string;
  naicsList: string[];
  socioEconomic: OnboardingSocio;
  /** SAM.gov descriptions of SBA certifications, when the sync kept them. */
  sbaDescriptions?: string[];
  syncSource: string;
};

export type OnboardingStep = "samgov" | "naics" | "scout" | "capability";

export type OnboardingStatus = {
  needsUei: boolean;
  needsNaics: boolean;
  needsScout: boolean;
  needsCapability: boolean;
  /** Steps still open, in the order the panel shows them. */
  open: OnboardingStep[];
  complete: boolean;
};

/** Which of the four setup steps are still open. */
export function onboardingStatus(input: {
  uei: string;
  primaryNaics: string;
  naicsList: string[];
  scoutKeywords: string[];
  capabilityEntries: number;
}): OnboardingStatus {
  const needsUei = !input.uei.trim();
  const needsNaics = !input.primaryNaics.trim() && input.naicsList.filter((n) => n.trim()).length === 0;
  const needsScout = input.scoutKeywords.filter((k) => k.trim()).length === 0;
  const needsCapability = input.capabilityEntries <= 0;
  const open: OnboardingStep[] = [];
  if (needsUei) open.push("samgov");
  if (needsNaics) open.push("naics");
  if (needsScout) open.push("scout");
  if (needsCapability) open.push("capability");
  return { needsUei, needsNaics, needsScout, needsCapability, open, complete: open.length === 0 };
}

export type TargetAgency = { name: string; why: string };

export type OnboardingProposal = {
  capabilityStatement: string;
  scoutKeywords: string[];
  extraNaics: string[];
  targetAgencies: TargetAgency[];
};

export const PROPOSAL_LIMITS = {
  statementChars: 1_500,
  keywords: 10,
  keywordChars: 60,
  extraNaics: 5,
  agencies: 6,
  agencyNameChars: 80,
  agencyWhyChars: 200,
} as const;

function str(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

function uniqueCaseless(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Whatever the model (or the admin's edited form) sent, reduced to what
 * the platform stores: trimmed, capped, de-duplicated; NAICS digits only
 * and never one the organization already has.
 */
export function sanitizeProposal(raw: unknown, knownNaics: readonly string[] = []): OnboardingProposal {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const known = new Set(knownNaics.map((n) => n.replace(/\D/g, "")).filter(Boolean));

  const statement = typeof r.capabilityStatement === "string" ? r.capabilityStatement.trim() : "";
  const capabilityStatement =
    statement.length > PROPOSAL_LIMITS.statementChars
      ? `${statement.slice(0, PROPOSAL_LIMITS.statementChars - 1).trimEnd()}…`
      : statement;

  const scoutKeywords = uniqueCaseless(
    (Array.isArray(r.scoutKeywords) ? r.scoutKeywords : [])
      .map((k) => str(k).slice(0, PROPOSAL_LIMITS.keywordChars))
      .filter((k) => k.length >= 2),
  ).slice(0, PROPOSAL_LIMITS.keywords);

  const extraNaics = uniqueCaseless(
    (Array.isArray(r.extraNaics) ? r.extraNaics : [])
      .map((n) => str(n).replace(/\D/g, ""))
      .filter((n) => n.length >= 2 && n.length <= 6 && !known.has(n)),
  ).slice(0, PROPOSAL_LIMITS.extraNaics);

  const seenAgencies = new Set<string>();
  const targetAgencies: TargetAgency[] = [];
  for (const a of Array.isArray(r.targetAgencies) ? r.targetAgencies : []) {
    const o = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
    const name = str(o.name).slice(0, PROPOSAL_LIMITS.agencyNameChars);
    if (!name || seenAgencies.has(name.toLowerCase())) continue;
    seenAgencies.add(name.toLowerCase());
    targetAgencies.push({ name, why: str(o.why).slice(0, PROPOSAL_LIMITS.agencyWhyChars) });
    if (targetAgencies.length >= PROPOSAL_LIMITS.agencies) break;
  }

  return { capabilityStatement, scoutKeywords, extraNaics, targetAgencies };
}

/** True when there is something worth saving. */
export function proposalHasContent(p: OnboardingProposal): boolean {
  return p.capabilityStatement.length > 0 || p.scoutKeywords.length > 0 || p.extraNaics.length > 0;
}

/**
 * Without a model (stub provider, or an unusable answer) the panel still
 * offers a starting point built from the registration itself. Nothing
 * here is invented: the codes, the set-asides and the name are the
 * organization's own.
 */
export function fallbackProposal(profile: OnboardingProfile): OnboardingProposal {
  const codes = uniqueCaseless([profile.primaryNaics, ...profile.naicsList].map((c) => c.replace(/\D/g, "")).filter(Boolean));
  const socio = socioLabels(profile.socioEconomic);
  const where = profile.state ? ` based in ${profile.state}` : "";
  const sentences = [
    `${profile.name || "The company"} is a federal contractor${where}${socio.length ? ` registered as ${socio.join(", ")}` : ""}.`,
    codes.length
      ? `Its SAM.gov registration lists NAICS ${codes.join(", ")}${profile.primaryNaics ? ` with ${profile.primaryNaics.replace(/\D/g, "")} as the primary code` : ""}.`
      : "",
    "Replace this paragraph with a short statement of what the company does, for whom, and what sets it apart; keep contract names and numbers you can cite.",
  ].filter(Boolean);
  const scoutKeywords = uniqueCaseless([
    ...codes.slice(0, 3).map((c) => `NAICS ${c}`),
    ...socio.map((s) => s.toLowerCase()),
  ]).slice(0, PROPOSAL_LIMITS.keywords);
  return { capabilityStatement: sentences.join(" "), scoutKeywords, extraNaics: [], targetAgencies: [] };
}

/** The knowledge entry that holds the capability statement. */
export const CAPABILITY_ENTRY_TITLE = "Capability statement (draft from SAM.gov profile)";
export const CAPABILITY_ENTRY_TAGS = ["onboarding", "capability-statement", "draft"];

/** Target agencies flattened for the entry's string-valued metadata. */
export function agenciesToMetadata(agencies: readonly TargetAgency[]): string {
  return agencies.map((a) => (a.why ? `${a.name} — ${a.why}` : a.name)).join("; ");
}
