"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { opportunities, organizations } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { log } from "@/lib/log";
import type { RecompeteFlag } from "@/lib/recompete-match";
import { flagSamResults } from "@/lib/recompete-radar";
import { sanitizeSamImportRows } from "@/lib/sam-import-row";
import { GSA_VEHICLES, noticeDescriptionUrl, readNoticeDescriptions, type SamOpportunity } from "@/lib/samgov";
import { resolveSamCredential } from "@/lib/samgov-key";
import { hasKeyword, noticeAgency, parseKeyword, parseNoticeTypes, type DescriptionState, type KeywordSearchCounts } from "@/lib/samgov-match";
import { DESCRIPTION_READS, findSamOpportunities, type FoundNotice } from "@/lib/samgov-search";

export type ImportableOpportunity = FoundNotice & {
  alreadyImported: boolean;
  /** BL-FB-WIN-RECOMPETE — best prior pursuit this looks like, if any. */
  recompete: RecompeteFlag | null;
};

/** One SAM.gov request per code (BL-STAB-10): a search takes at most this many. */
const MAX_SEARCH_CODES = 10;

/**
 * BL-STAB-10 — search SAM.gov for the codes' notices of the chosen types,
 * and (with a keyword or GSA vehicles) keep only those that really
 * mention them; notices FORGE couldn't check yet come back separately.
 */
export async function loadSamGovOpportunitiesAction(input?: {
  naicsCodes?: string[];
  keyword?: string;
  postedDaysBack?: number;
  /** Only GSA-issued opportunities. */
  gsaOnly?: boolean;
  /** GSA vehicle ids from GSA_VEHICLES: a notice must name one of them. */
  vehicleIds?: string[];
  /** SAM.gov notice type codes; none means the open ones. */
  noticeTypes?: string[];
}): Promise<
  | {
      ok: true;
      opportunities: ImportableOpportunity[];
      unchecked: ImportableOpportunity[];
      counts: KeywordSearchCounts;
      /** What the counts are about, for the results line (searchSummary). */
      scope: { keyword: string | null; codes: string[]; days: number };
      warning: string | null;
      usedNaics: string[];
      orgPrimaryNaics: string;
      orgNaicsList: string[];
    }
  | { ok: false; error: string }
> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [org] = await db
    .select({
      primaryNaics: organizations.primaryNaics,
      naicsList: organizations.naicsList,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const orgPrimary = org?.primaryNaics ?? "";
  const orgList = org?.naicsList ?? [];

  let naicsCodes = (input?.naicsCodes ?? []).map((c) => String(c).trim()).filter(Boolean);
  if (naicsCodes.length === 0) {
    // The org's own list may hold entries like "541512 - Computer Systems Design": its codes only.
    naicsCodes = [orgPrimary, ...orgList].map((s) => (s ?? "").replace(/\D/g, "")).filter((c) => /^\d{2,6}$/.test(c));
  }
  const badCode = naicsCodes.find((c) => !/^\d{2,6}$/.test(c));
  if (badCode) return { ok: false, error: `"${badCode.slice(0, 20)}" isn't a NAICS code (2 to 6 digits).` };
  naicsCodes = [...new Set(naicsCodes)];
  const allCodes = naicsCodes.length;
  naicsCodes = naicsCodes.slice(0, MAX_SEARCH_CODES);

  const vehicleKeywords = (input?.vehicleIds ?? [])
    .map((id) => GSA_VEHICLES.find((v) => v.id === id)?.keyword ?? "")
    .filter(Boolean);
  let keyword = (input?.keyword ?? "").trim().slice(0, 200);
  // Nothing searchable in it ("-", a lone quote): no keyword, rather than "everything matches".
  if (!hasKeyword(parseKeyword(keyword))) keyword = "";
  if (naicsCodes.length === 0 && !keyword) {
    return {
      ok: false,
      error: "No NAICS codes configured. Add them under Settings → Classification, or enter a keyword (SAM.gov then searches notice titles).",
    };
  }

  const sam = await resolveSamCredential(organizationId);
  if (!sam.ok) return { ok: false, error: sam.failure.error };
  const days = input?.postedDaysBack ?? 30;
  const result = await findSamOpportunities(sam.cred, {
    naicsCodes,
    keyword,
    anyOf: vehicleKeywords,
    noticeTypes: parseNoticeTypes(input?.noticeTypes),
    postedDaysBack: days,
    gsaOnly: input?.gsaOnly === true,
  });
  if (!result.ok) return { ok: false, error: result.error };

  // Already imported: any notice of the solicitation, in this organization.
  const all = [...result.notices, ...result.unchecked];
  const ids = all.flatMap((o) => [o.noticeId, ...o.earlierNoticeIds]).filter(Boolean);
  const existing =
    ids.length === 0
      ? []
      : await db
          .select({ noticeId: opportunities.noticeId })
          .from(opportunities)
          .where(and(eq(opportunities.organizationId, organizationId), inArray(opportunities.noticeId, ids)));
  const existingSet = new Set(existing.map((r) => r.noticeId));

  // BL-FB-WIN-RECOMPETE — flag results that look like a pursuit we
  // already decided. Best-effort: a failure here never blocks the list.
  let recompeteFlags: Record<string, RecompeteFlag> = {};
  try {
    recompeteFlags = await flagSamResults(organizationId, all);
  } catch (err) {
    log.warn("[samgov-import]", "recompete flagging failed", { error: err });
  }
  const decorate = (o: FoundNotice): ImportableOpportunity => ({
    ...o,
    alreadyImported: [o.noticeId, ...o.earlierNoticeIds].some((id) => existingSet.has(id)),
    recompete: recompeteFlags[o.noticeId] ?? null,
  });

  return {
    ok: true,
    opportunities: result.notices.map(decorate),
    unchecked: result.unchecked.map(decorate),
    counts: result.counts,
    scope: { keyword: keyword || (vehicleKeywords.length ? vehicleKeywords.join(" or ") : null), codes: naicsCodes, days },
    warning:
      [allCodes > naicsCodes.length ? `Searched the first ${naicsCodes.length} of ${allCodes} NAICS codes (SAM.gov is asked once per code).` : "", result.warning ?? ""]
        .filter(Boolean)
        .join(" ") || null,
    usedNaics: naicsCodes,
    orgPrimaryNaics: orgPrimary,
    orgNaicsList: orgList,
  };
}

/**
 * BL-STAB-10 — read the descriptions of up to 10 notices the search left
 * unchecked (one SAM.gov request each, on the company's key). The links
 * are built here from validated notice ids; nothing is written.
 */
export async function readSamDescriptionsAction(
  noticeIds: string[],
): Promise<{ ok: true; descriptions: Record<string, DescriptionState> } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const rows = (Array.isArray(noticeIds) ? noticeIds : [])
    .slice(0, 10)
    .map((id) => ({ noticeId: String(id), description: noticeDescriptionUrl(String(id)) }))
    .filter((r): r is { noticeId: string; description: string } => r.description !== null);
  if (rows.length === 0) return { ok: false, error: "Nothing to check." };
  const sam = await resolveSamCredential(organizationId);
  if (!sam.ok) return { ok: false, error: sam.failure.error };
  const read = await readNoticeDescriptions(sam.cred, rows, rows.length);
  return { ok: true, descriptions: Object.fromEntries(read) };
}

function parseSamDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function extractPoP(pop: SamOpportunity["placeOfPerformance"]): string {
  if (!pop) return "";
  const parts = [pop.city?.name, pop.state?.name, pop.country?.name].filter(
    Boolean,
  );
  return parts.join(", ");
}

function mapStageFromType(type: string): "identified" | "sources_sought" {
  const t = (type || "").toLowerCase();
  if (
    t.includes("sources sought") ||
    t.includes("rfi") ||
    t.includes("special notice")
  )
    return "sources_sought";
  return "identified";
}

/**
 * Import the SAM.gov rows the user ticked.
 *
 * BL-AIP-1 — takes the rows themselves, not notice ids. The previous
 * version re-ran an UNFILTERED 30-day / 200-row search to find the ids
 * again, so anything picked from a NAICS or keyword search, or a wider
 * date window, was silently counted as "skipped". The client already
 * holds the exact rows it displayed; the server sanitises them
 * (sam-import-row.ts), drops notice ids this org already has, inserts,
 * and audits the batch.
 */
export async function importSamGovOpportunitiesAction(
  selected: unknown[],
): Promise<
  | { ok: true; imported: number; skipped: number }
  | { ok: false; error: string }
> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const rowsIn = sanitizeSamImportRows(selected);
  if (rowsIn.length === 0) {
    return { ok: false, error: "Pick at least one opportunity to import." };
  }
  const noticeIds = rowsIn.map((r) => r.noticeId);

  const existing = await db
    .select({ noticeId: opportunities.noticeId })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        inArray(opportunities.noticeId, noticeIds),
      ),
    );
  const existingSet = new Set(existing.map((r) => r.noticeId));

  const toImport = rowsIn.filter((o) => !existingSet.has(o.noticeId));

  if (toImport.length === 0) {
    return { ok: true, imported: 0, skipped: noticeIds.length };
  }

  // BL-STAB-10 — searches read descriptions only to check a keyword: read
  // the picked notices' missing ones now (within the key's budget), so an
  // imported opportunity keeps its description.
  const missing = toImport.filter((o) => !o.description).map((o) => ({ noticeId: o.noticeId, description: noticeDescriptionUrl(o.noticeId) ?? "" }));
  if (missing.length > 0) {
    const sam = await resolveSamCredential(organizationId);
    if (sam.ok) {
      const read = await readNoticeDescriptions(sam.cred, missing, DESCRIPTION_READS[sam.cred.source]);
      for (const o of toImport) {
        const d = read.get(o.noticeId);
        if (!o.description && d && "text" in d) o.description = d.text.slice(0, 20_000);
      }
    }
  }

  const rows = toImport.map((o) => ({
    organizationId,
    title: o.title || "Untitled",
    agency: noticeAgency(o),
    office: o.office ?? "",
    stage: mapStageFromType(o.type) as "identified" | "sources_sought",
    solicitationNumber: o.solicitationNumber ?? "",
    noticeId: o.noticeId,
    responseDueDate: parseSamDate(o.responseDeadLine),
    releaseDate: parseSamDate(o.postedDate),
    naicsCode: o.naicsCode ?? "",
    pscCode: o.classificationCode ?? "",
    setAside: o.typeOfSetAsideDescription ?? "",
    placeOfPerformance: extractPoP(o.placeOfPerformance),
    description: o.description ?? "",
    createdByUserId: actor.id,
  }));

  await db.insert(opportunities).values(rows);

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "opportunity.import",
    resourceType: "opportunity",
    resourceId: "samgov",
    metadata: {
      source: "samgov",
      imported: rows.length,
      skipped: noticeIds.length - rows.length,
      noticeIds: rows.slice(0, 50).map((r) => r.noticeId),
    },
  });

  revalidatePath("/opportunities");
  revalidatePath("/");
  return {
    ok: true,
    imported: rows.length,
    skipped: noticeIds.length - rows.length,
  };
}
