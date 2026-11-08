import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { companies, type CompanyRelationship } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";
import { fetchSamGovByUei } from "@/lib/samgov";
import { resolveSamCredential } from "@/lib/samgov-key";

type Actor = { userId: string; email?: string | null };

/** The organization's company with this UEI, if it has one. */
export async function companyIdByUei(organizationId: string, uei: string): Promise<string | null> {
  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.organizationId, organizationId), eq(companies.uei, uei.trim().toUpperCase())))
    .limit(1);
  return row?.id ?? null;
}

/**
 * A registered entity from SAM.gov into the organization's Companies, by
 * UEI, with the relationship given; the company already there is
 * returned as is. Audited `company.import_samgov`. Callers own auth.
 */
export async function importCompanyFromSam(input: {
  organizationId: string;
  actor: Actor;
  uei: string;
  relationship: CompanyRelationship;
}): Promise<{ ok: true; id: string; created: boolean } | { ok: false; error: string }> {
  const { organizationId } = input;
  const uei = input.uei.trim().toUpperCase();
  if (!uei) return { ok: false, error: "UEI required." };
  const existing = await companyIdByUei(organizationId, uei);
  if (existing) return { ok: true, id: existing, created: false };

  const sam = await resolveSamCredential(organizationId);
  if (!sam.ok) return { ok: false, error: sam.failure.error };
  const result = await fetchSamGovByUei(sam.cred, uei);
  if (!result.ok) return { ok: false, error: result.error };
  const p = result.profile;

  try {
    const [row] = await db
      .insert(companies)
      .values({
        organizationId,
        createdByUserId: input.actor.userId,
        relationship: input.relationship,
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
        registrationExpirationDate: p.registrationExpirationDate ? new Date(p.registrationExpirationDate) : null,
        syncSource: "samgov",
        lastSyncedAt: new Date(),
      })
      .returning({ id: companies.id });
    if (!row) return { ok: false, error: "Insert failed." };
    await recordAudit({
      organizationId,
      actor: input.actor,
      action: "company.import_samgov",
      resourceType: "company",
      resourceId: row.id,
      metadata: { uei: p.uei, relationship: input.relationship },
    });
    return { ok: true, id: row.id, created: true };
  } catch (err) {
    log.error("[importCompanyFromSam]", "error", { error: err });
    return { ok: false, error: err instanceof Error ? err.message : "Import failed." };
  }
}
