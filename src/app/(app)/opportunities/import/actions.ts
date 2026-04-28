"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { opportunities, organizations } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import {
  GSA_VEHICLES,
  searchSamGovOpportunities,
  type SamOpportunity,
} from "@/lib/samgov";

const GSA_DEPARTMENT = "General Services Administration";

export type ImportableOpportunity = SamOpportunity & {
  alreadyImported: boolean;
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

  return {
    ok: true,
    opportunities: result.opportunities.map((o) => ({
      ...o,
      alreadyImported: existingSet.has(o.noticeId),
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

export async function importSamGovOpportunitiesAction(
  noticeIds: string[],
): Promise<
  | { ok: true; imported: number; skipped: number }
  | { ok: false; error: string }
> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  if (noticeIds.length === 0) {
    return { ok: false, error: "Pick at least one opportunity to import." };
  }

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

  const fresh = await searchSamGovOpportunities({ activeOnly: false, limit: 200 });
  if (!fresh.ok) return { ok: false, error: fresh.error };
  const index = new Map(fresh.opportunities.map((o) => [o.noticeId, o]));

  const toImport = noticeIds
    .filter((id) => !existingSet.has(id))
    .map((id) => index.get(id))
    .filter((o): o is SamOpportunity => !!o);

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

  revalidatePath("/opportunities");
  return {
    ok: true,
    imported: rows.length,
    skipped: noticeIds.length - rows.length,
  };
}
