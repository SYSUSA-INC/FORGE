/**
 * BL-NAV-LIFECYCLE phase 3a-2 (FORGE II footnote 6, C-2) — the partner
 * database: one list of possible partners for an opportunity, joined by
 * UEI from what each source knows:
 * - USAspending: contract awards under the opportunity's NAICS code in
 *   the last five years, and those at its agency (past performance);
 * - the certification registry (`cert_firm`): 8(a), HUBZone, WOSB,
 *   EDWOSB, SDVOSB, veteran-owned, Native American, still current;
 * - SAM.gov: registered, active entities under the NAICS code;
 * - the organization's own Companies.
 * Every fact shown comes from one of those sources; nothing is guessed.
 * The order is a plain rule (agency record first, then value), not an
 * AI's judgement: the AI's ranked list with reasons is phase 3b. Pure.
 */
import type { CompanyRelationship } from "@/db/schema";

export const PARTNER_SEARCH_YEARS = 5;
/** How many partners one search returns. */
export const PARTNER_SEARCH_LIMIT = 40;

export const PARTNER_CERTS = ["8a", "hubzone", "wosb", "edwosb", "sdvosb", "vob", "native_american"] as const;
export type PartnerCert = (typeof PARTNER_CERTS)[number];
export const PARTNER_CERT_LABELS: Record<PartnerCert, string> = {
  "8a": "8(a)",
  hubzone: "HUBZone",
  wosb: "WOSB",
  edwosb: "EDWOSB",
  sdvosb: "SDVOSB",
  vob: "Veteran-owned",
  native_american: "Native American",
};

export function isPartnerCert(v: string): v is PartnerCert {
  return (PARTNER_CERTS as readonly string[]).includes(v);
}

export type PartnerSource = "usaspending" | "certifications" | "samgov" | "companies";
export const PARTNER_SOURCE_LABELS: Record<PartnerSource, string> = {
  usaspending: "USAspending",
  certifications: "Cert registry",
  samgov: "SAM.gov",
  companies: "Your Companies",
};

/** What a set-aside asks a partner to hold: a certification, any small business, or nothing known. */
export type SetAsideNeed = PartnerCert | "small" | null;

/** The set-aside's wording read the way the PWin model reads it; unknown wording is null, never a guess. */
export function setAsideNeed(setAside: string): SetAsideNeed {
  const s = setAside.toLowerCase().trim();
  if (!s || /unrestricted|full and open|none|n\/a/.test(s)) return null;
  if (/8\s*\(?\s*a\s*\)?/.test(s)) return "8a";
  if (/sdvosb|service[- ]?disabled/.test(s)) return "sdvosb";
  if (/edwosb|economically disadvantaged/.test(s)) return "edwosb";
  if (/wosb|women/.test(s)) return "wosb";
  if (/hubzone|hub zone/.test(s)) return "hubzone";
  if (/vosb|veteran/.test(s)) return "vob";
  if (/small business|total small|\bsb\b|\bsba\b/.test(s)) return "small";
  return null;
}

/**
 * Whether the partner's certifications keep the set-aside: true or false
 * when the registry says so, null when it can't (no set-aside, or a
 * small-business set-aside for a firm with no certification on record,
 * since size isn't in the registry).
 */
export function keepsSetAside(need: SetAsideNeed, certs: readonly PartnerCert[]): boolean | null {
  if (!need) return null;
  if (need === "small") return certs.length > 0 ? true : null;
  if (need === "wosb") return certs.includes("wosb") || certs.includes("edwosb");
  if (need === "vob") return certs.includes("vob") || certs.includes("sdvosb");
  return certs.includes(need);
}

/** SAM.gov's SBA business-type descriptions as registry certifications. */
export function certsFromSamDescriptions(descs: readonly string[]): PartnerCert[] {
  const out = new Set<PartnerCert>();
  for (const raw of descs) {
    const d = raw.toLowerCase();
    if (/8\s*\(?a\)?/.test(d)) out.add("8a");
    if (/hubzone/.test(d)) out.add("hubzone");
    if (/economically disadvantaged women|edwosb/.test(d)) out.add("edwosb");
    else if (/women/.test(d)) out.add("wosb");
    if (/service[- ]disabled/.test(d)) out.add("sdvosb");
    else if (/veteran/.test(d)) out.add("vob");
  }
  return [...out];
}

// ── the sources' records ─────────────────────────────────────────────

export type AwardInput = {
  awardId: string;
  recipientName: string;
  recipientUei: string;
  amount: number;
  awardingAgency: string;
  awardingSubAgency: string;
  endDate: string | null;
  uiUrl: string;
};

export type AwardFact = { awardId: string; amount: number; agency: string; endDate: string | null; url: string };

export type RecipientRecord = {
  uei: string;
  name: string;
  awards: number;
  value: number;
  atAgency: number;
  atAgencyValue: number;
  /** The most valuable awards, at most three. */
  top: AwardFact[];
};

const agencyNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Awards grouped by recipient UEI (an award returned by two searches
 * counts once); "at the agency" when the awarding agency or sub-agency
 * reads as the opportunity's.
 */
export function aggregateRecipients(awards: readonly AwardInput[], agency: string): Map<string, RecipientRecord> {
  const target = agencyNorm(agency);
  const seen = new Set<string>();
  const out = new Map<string, RecipientRecord>();
  for (const a of awards) {
    const uei = a.recipientUei.trim().toUpperCase();
    if (!uei) continue;
    const key = a.awardId || `${uei}:${a.amount}:${a.endDate ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rec = out.get(uei) ?? { uei, name: a.recipientName.trim(), awards: 0, value: 0, atAgency: 0, atAgencyValue: 0, top: [] };
    const amount = Number.isFinite(a.amount) && a.amount > 0 ? a.amount : 0;
    rec.awards += 1;
    rec.value += amount;
    const here = !!target && (agencyNorm(a.awardingAgency) === target || agencyNorm(a.awardingSubAgency) === target);
    if (here) {
      rec.atAgency += 1;
      rec.atAgencyValue += amount;
    }
    rec.top.push({ awardId: a.awardId, amount, agency: a.awardingSubAgency || a.awardingAgency, endDate: a.endDate, url: a.uiUrl });
    rec.top.sort((x, y) => y.amount - x.amount);
    if (rec.top.length > 3) rec.top.length = 3;
    out.set(uei, rec);
  }
  return out;
}

export type CertRecord = { uei: string; name: string; certType: string; city: string; state: string; naics: string };
export type SamRecord = { uei: string; name: string; cage: string; city: string; state: string; naics: string; expires: string; certs: PartnerCert[] };
export type CompanyRecord = { id: string; uei: string; name: string; relationship: CompanyRelationship };

export type PartnerHit = {
  uei: string;
  name: string;
  city: string;
  state: string;
  certs: PartnerCert[];
  awards: RecipientRecord | null;
  sam: { cage: string; expires: string } | null;
  company: { id: string; relationship: CompanyRelationship } | null;
  /** Already on this opportunity's partner list. */
  considered: boolean;
  keepsSetAside: boolean | null;
  sources: PartnerSource[];
  /** One line per fact, each from a named source (shown, and cited by the AI in 3b). */
  facts: string[];
};

export function formatMoney(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

const RELATIONSHIP_WORDS: Partial<Record<CompanyRelationship, string>> = {
  teaming_partner: "a teaming partner",
  subcontractor: "a subcontractor",
  competitor: "a competitor",
  customer: "a customer",
  prime: "a prime",
  watchlist: "on the watchlist",
};

/**
 * The sources joined by UEI into one list. The organization's own UEI is
 * left out; `state` keeps firms based in that state (a firm whose location
 * no source gives stays, marked as such); `cert` keeps firms holding it.
 * Order: awards at the agency, then whether the set-aside is kept, then
 * value under the NAICS code, then being a teaming partner or
 * subcontractor already, then name.
 */
export function mergePartnerHits(input: {
  recipients: Map<string, RecipientRecord>;
  certs: readonly CertRecord[];
  sam: readonly SamRecord[];
  companies: readonly CompanyRecord[];
  consideredCompanyIds: ReadonlySet<string>;
  ownUei: string;
  need: SetAsideNeed;
  naics: string;
  agency: string;
  filters?: { state?: string; cert?: PartnerCert | "" };
  limit?: number;
}): PartnerHit[] {
  const own = input.ownUei.trim().toUpperCase();
  const norm = (u: string) => u.trim().toUpperCase();
  const ueis = new Set<string>();
  for (const u of input.recipients.keys()) ueis.add(u);
  for (const c of input.certs) ueis.add(norm(c.uei));
  for (const s of input.sam) ueis.add(norm(s.uei));
  ueis.delete("");
  if (own) ueis.delete(own);

  const certsBy = new Map<string, CertRecord[]>();
  for (const c of input.certs) {
    const u = norm(c.uei);
    certsBy.set(u, [...(certsBy.get(u) ?? []), c]);
  }
  const samBy = new Map(input.sam.map((s) => [norm(s.uei), s]));
  const companyBy = new Map(input.companies.filter((c) => c.uei).map((c) => [norm(c.uei), c]));
  const wantState = (input.filters?.state ?? "").trim().toUpperCase();
  const wantCert = input.filters?.cert ?? "";

  const hits: (PartnerHit & { rank: number[] })[] = [];
  for (const uei of ueis) {
    const rec = input.recipients.get(uei) ?? null;
    const certRows = certsBy.get(uei) ?? [];
    const sam = samBy.get(uei) ?? null;
    const company = companyBy.get(uei) ?? null;
    const certs = [...new Set<PartnerCert>([...certRows.map((c) => c.certType).filter(isPartnerCert), ...(sam?.certs ?? [])])];
    const located = certRows.find((c) => c.state) ?? null;
    const city = sam?.city || located?.city || "";
    const state = (sam?.state || located?.state || "").toUpperCase();
    if (wantState && state && state !== wantState) continue;
    if (wantCert && !certs.includes(wantCert)) continue;
    const name = company?.name || sam?.name || certRows[0]?.name || rec?.name || uei;

    const sources: PartnerSource[] = [];
    const facts: string[] = [];
    if (rec) {
      sources.push("usaspending");
      facts.push(`${rec.awards} contract award${rec.awards === 1 ? "" : "s"} under NAICS ${input.naics} in the last ${PARTNER_SEARCH_YEARS} years, ${formatMoney(rec.value)} (USAspending)`);
      if (rec.atAgency > 0) facts.push(`${rec.atAgency} at ${input.agency}, ${formatMoney(rec.atAgencyValue)} (USAspending)`);
    }
    if (certRows.length > 0 || (sam?.certs.length ?? 0) > 0) {
      if (certRows.length > 0) sources.push("certifications");
      facts.push(`${certs.map((c) => PARTNER_CERT_LABELS[c]).join(", ")} (${certRows.length > 0 ? "SBA certification registry" : "SAM.gov"})`);
    }
    if (sam) {
      sources.push("samgov");
      facts.push(`Registered and active in SAM.gov${sam.cage ? `, CAGE ${sam.cage}` : ""}${sam.expires ? `, until ${sam.expires.slice(0, 10)}` : ""}`);
    }
    if (company) {
      sources.push("companies");
      facts.push(`In your Companies as ${RELATIONSHIP_WORDS[company.relationship] ?? company.relationship}`);
    }
    const keeps = keepsSetAside(input.need, certs);
    const ally = company?.relationship === "teaming_partner" || company?.relationship === "subcontractor" ? 1 : 0;
    hits.push({
      uei,
      name,
      city,
      state,
      certs,
      awards: rec,
      sam: sam ? { cage: sam.cage, expires: sam.expires } : null,
      company: company ? { id: company.id, relationship: company.relationship } : null,
      considered: company ? input.consideredCompanyIds.has(company.id) : false,
      keepsSetAside: keeps,
      sources,
      facts,
      rank: [rec?.atAgencyValue ?? 0, keeps ? 1 : 0, rec?.value ?? 0, ally, certs.length],
    });
  }
  hits.sort((a, b) => {
    for (let i = 0; i < a.rank.length; i++) {
      const d = b.rank[i]! - a.rank[i]!;
      if (d !== 0) return d;
    }
    return a.name.localeCompare(b.name);
  });
  return hits.slice(0, input.limit ?? PARTNER_SEARCH_LIMIT).map(({ rank: _rank, ...h }) => h);
}

/** The reason kept on the partner when it is added from the search: its first two facts. */
export function reasonFromFacts(facts: readonly string[]): string {
  return facts.slice(0, 2).join("; ").slice(0, 500);
}
