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
import { sanitizeSamImportRows, type SamImportRow } from "@/lib/sam-import-row";
import {
  GSA_VEHICLES,
  searchSamGovOpportunities,
  type SamOpportunity,
} from "@/lib/samgov";

const GSA_DEPARTMENT = "General Services Administration";

export type ImportableOpportunity = SamOpportunity & {
  alreadyImported: boolean;
  /** BL-FB-WIN-RECOMPETE — best prior pursuit this looks like, if any. */
  recompete: RecompeteFlag | null;
};

export async function loadSamGovOpportunitiesAction(input?: {
  naicsCodes?: string[];
  keyword?: string;
  postedDaysBack?: number;
  /** Restrict to GSA-issued opportunities (sets SAM.gov deptname). */
  gsaOnly?: boolean;
  /** GSA vehicle ids from GSA_VEHICLES — adds vehicle keywords to the query. */
  vehicleIds?: string[];
}): Promise<
  | {
      ok: true;
      opportunities: ImportableOpportunity[];
      totalRecords: number;
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

  let naicsCodes = input?.naicsCodes;
  if (!naicsCodes || naicsCodes.length === 0) {
    naicsCodes = Array.from(
      new Set([orgPrimary, ...orgList].filter((s) => s && s.trim())),
    );
  }

  const vehicleIds = input?.vehicleIds ?? [];
  const vehicleKeywords = vehicleIds
    .map((id) => GSA_VEHICLES.find((v) => v.id === id)?.keyword ?? "")
    .filter(Boolean);

  // GSA-scoped queries (department filter or vehicle keywords) carry
  // their own scope, so an empty NAICS list isn't a hard error there.
  const hasGsaFilter =
    input?.gsaOnly === true || vehicleKeywords.length > 0;

  if (naicsCodes.length === 0 && !input?.keyword && !hasGsaFilter) {
    return {
      ok: false,
      error:
        "No NAICS codes configured. Add them under Settings → Classification, or enter a keyword / pick a GSA vehicle.",
    };
  }

  const result = await searchSamGovOpportunities({
    naicsCodes,
    keyword: input?.keyword,
    postedDaysBack: input?.postedDaysBack ?? 30,
    department: input?.gsaOnly ? GSA_DEPARTMENT : undefined,
    extraKeywords: vehicleKeywords,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const noticeIds = result.opportunities
    .map((o) => o.noticeId)
    .filter(Boolean);
  const existing =
    noticeIds.length === 0
      ? []
      : await db
          .select({ noticeId: opportunities.noticeId })
          .from(opportunities)
          .where(
            and(
              eq(opportunities.organizationId, organizationId),
              inArray(opportunities.noticeId, noticeIds),
            ),
          );
  const existingSet = new Set(existing.map((r) => r.noticeId));

  // BL-FB-WIN-RECOMPETE — flag results that look like a pursuit we
  // already decided. Best-effort: a failure here never blocks the list.
  let recompeteFlags: Record<string, RecompeteFlag> = {};
  try {
    recompeteFlags = await flagSamResults(organizationId, result.opportunities);
  } catch (err) {
    log.warn("[samgov-import]", "recompete flagging failed", { error: err });
  }

  return {
    ok: true,
    opportunities: result.opportunities.map((o) => ({
      ...o,
      alreadyImported: existingSet.has(o.noticeId),
      recompete: recompeteFlags[o.noticeId] ?? null,
    })),
    totalRecords: result.totalRecords,
    usedNaics: naicsCodes,
    orgPrimaryNaics: orgPrimary,
    orgNaicsList: orgList,
  };
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
  selected: SamImportRow[],
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

  const rows = toImport.map((o) => ({
    organizationId,
    title: o.title || "Untitled",
    agency: [o.department, o.subTier].filter(Boolean).join(" · "),
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
