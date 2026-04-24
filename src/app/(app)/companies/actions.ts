"use server";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { companies, type CompanyRelationship } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import {
  fetchSamGovByUei,
  searchSamGovEntities,
  type SamEntitySearchResult,
} from "@/lib/samgov";

export type CompanyInput = {
  name: string;
  uei?: string;
  cageCode?: string;
  dunsNumber?: string;
  website?: string;
  email?: string;
  phone?: string;
  contactName?: string;
  contactTitle?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  primaryNaics?: string;
  naicsList?: string[];
  relationship: CompanyRelationship;
  notes?: string;
};

async function ownsCompany(id: string, organizationId: string) {
  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(
      and(eq(companies.id, id), eq(companies.organizationId, organizationId)),
    )
    .limit(1);
  return !!row;
}

function toRow(input: CompanyInput) {
  return {
    name: input.name.trim(),
    uei: input.uei?.trim().toUpperCase() ?? "",
    cageCode: input.cageCode?.trim().toUpperCase() ?? "",
    dunsNumber: input.dunsNumber?.trim() ?? "",
    website: input.website?.trim() ?? "",
    email: input.email?.trim().toLowerCase() ?? "",
    phone: input.phone?.trim() ?? "",
    contactName: input.contactName?.trim() ?? "",
    contactTitle: input.contactTitle?.trim() ?? "",
    addressLine1: input.addressLine1?.trim() ?? "",
    addressLine2: input.addressLine2?.trim() ?? "",
    city: input.city?.trim() ?? "",
    state: input.state?.trim() ?? "",
    zip: input.zip?.trim() ?? "",
    country: input.country?.trim() || "USA",
    primaryNaics: input.primaryNaics?.trim() ?? "",
    naicsList: input.naicsList ?? [],
    relationship: input.relationship,
    notes: input.notes?.trim() ?? "",
  };
}

export async function createCompanyAction(
  input: CompanyInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!input.name.trim()) return { ok: false, error: "Name is required." };

  try {
    const [row] = await db
      .insert(companies)
      .values({
        ...toRow(input),
        organizationId,
        createdByUserId: actor.id,
      })
      .returning({ id: companies.id });
    if (!row) return { ok: false, error: "Could not create company." };
    revalidatePath("/companies");
    return { ok: true, id: row.id };
  } catch (err) {
    console.error("[createCompanyAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Create failed.",
    };
  }
}

export async function createCompanyAndGoAction(
  input: CompanyInput,
): Promise<void> {
  const res = await createCompanyAction(input);
  if (res.ok) redirect(`/companies/${res.id}`);
  throw new Error(res.ok ? "unreachable" : res.error);
}

export async function updateCompanyAction(
  id: string,
  input: CompanyInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsCompany(id, organizationId))) {
    return { ok: false, error: "Company not found." };
  }
  try {
    await db
      .update(companies)
      .set({ ...toRow(input), updatedAt: new Date() })
      .where(eq(companies.id, id));
    revalidatePath("/companies");
    revalidatePath(`/companies/${id}`);
    return { ok: true };
  } catch (err) {
    console.error("[updateCompanyAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}

export async function deleteCompanyAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsCompany(id, organizationId))) {
    return { ok: false, error: "Company not found." };
  }
  await db.delete(companies).where(eq(companies.id, id));
  revalidatePath("/companies");
  return { ok: true };
}

export async function refreshCompanyFromSamGovAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsCompany(id, organizationId))) {
    return { ok: false, error: "Company not found." };
  }
  const [row] = await db
    .select({ uei: companies.uei })
    .from(companies)
    .where(eq(companies.id, id))
    .limit(1);
  if (!row || !row.uei) {
    return { ok: false, error: "Company has no UEI to sync." };
  }

  const result = await fetchSamGovByUei(row.uei);
  if (!result.ok) return { ok: false, error: result.error };
  const p = result.profile;

  try {
    await db
      .update(companies)
      .set({
        name: p.name || undefined,
        website: p.website,
        cageCode: p.cageCode,
        dunsNumber: p.dunsNumber,
        addressLine1: p.address.line1,
        addressLine2: p.address.line2,
        city: p.address.city,
        state: p.address.state,
        zip: p.address.zip,
        country: p.address.country,
        contactName: p.contactName,
        contactTitle: p.contactTitle,
        phone: p.phone,
        email: p.email,
        primaryNaics: p.primaryNaics,
        naicsList: p.naicsList,
        sbaCertifications: p.sbaDescriptions,
        registrationStatus: p.registrationStatus,
        registrationExpirationDate: p.registrationExpirationDate
          ? new Date(p.registrationExpirationDate)
          : null,
        syncSource: "samgov",
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(companies.id, id));
    revalidatePath(`/companies/${id}`);
    revalidatePath("/companies");
    return { ok: true };
  } catch (err) {
    console.error("[refreshCompanyFromSamGovAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "SAM.gov sync failed.",
    };
  }
}

export type ImportableSamEntity = SamEntitySearchResult & {
  alreadyImported: boolean;
};

export async function searchSamGovCompaniesAction(input: {
  name?: string;
  uei?: string;
  cage?: string;
  naics?: string;
  state?: string;
}): Promise<
  | { ok: true; entities: ImportableSamEntity[]; totalRecords: number }
  | { ok: false; error: string }
> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const res = await searchSamGovEntities({
    legalBusinessName: input.name,
    uei: input.uei,
    cage: input.cage,
    naics: input.naics,
    state: input.state,
  });
  if (!res.ok) return { ok: false, error: res.error };

  const ueis = res.entities.map((e) => e.ueiSAM).filter(Boolean);
  const existing =
    ueis.length === 0
      ? []
      : await db
          .select({ uei: companies.uei })
          .from(companies)
          .where(
            and(
              eq(companies.organizationId, organizationId),
              inArray(companies.uei, ueis),
            ),
          );
  const existingSet = new Set(existing.map((r) => r.uei));

  return {
    ok: true,
    entities: res.entities.map((e) => ({
      ...e,
      alreadyImported: existingSet.has(e.ueiSAM),
    })),
    totalRecords: res.totalRecords,
  };
}

export async function importSamGovCompanyAction(
  uei: string,
  relationship: CompanyRelationship,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!uei.trim()) return { ok: false, error: "UEI required." };

  const [existing] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(
      and(
        eq(companies.organizationId, organizationId),
        eq(companies.uei, uei.trim().toUpperCase()),
      ),
    )
    .limit(1);
  if (existing) return { ok: true, id: existing.id };

  const result = await fetchSamGovByUei(uei);
  if (!result.ok) return { ok: false, error: result.error };
  const p = result.profile;

  try {
    const [row] = await db
      .insert(companies)
      .values({
        organizationId,
        createdByUserId: actor.id,
        relationship,
        name: p.name,
        uei: p.uei,
        cageCode: p.cageCode,
        dunsNumber: p.dunsNumber,
        website: p.website,
        contactName: p.contactName,
        contactTitle: p.contactTitle,
        phone: p.phone,
        email: p.email,
        addressLine1: p.address.line1,
        addressLine2: p.address.line2,
        city: p.address.city,
        state: p.address.state,
        zip: p.address.zip,
        country: p.address.country,
        primaryNaics: p.primaryNaics,
        naicsList: p.naicsList,
        sbaCertifications: p.sbaDescriptions,
        registrationStatus: p.registrationStatus,
        registrationExpirationDate: p.registrationExpirationDate
          ? new Date(p.registrationExpirationDate)
          : null,
        syncSource: "samgov",
        lastSyncedAt: new Date(),
      })
      .returning({ id: companies.id });
    if (!row) return { ok: false, error: "Insert failed." };
    revalidatePath("/companies");
    return { ok: true, id: row.id };
  } catch (err) {
    console.error("[importSamGovCompanyAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Import failed.",
    };
  }
}

export async function listCompaniesSorted() {
  void asc;
  void desc;
}
