"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import {
  requireAuth,
  requireCurrentOrg,
  requireOrgAdmin,
} from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { fetchSamGovByUei } from "@/lib/samgov";
import type { OrgProfile } from "@/lib/org-types";
import { hasErrors, validateOrgProfile } from "@/lib/validators";
import { log } from "@/lib/log";

export async function saveOrgProfileAction(profile: OrgProfile): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const errors = validateOrgProfile(profile);
  if (hasErrors(errors)) {
    const first =
      Object.values(errors).find((v) => typeof v === "string" && v.length > 0) ??
      "Invalid input.";
    return { ok: false, error: first };
  }

  try {
    await db
      .update(organizations)
      .set({
        name: profile.name,
        website: profile.website,
        contactName: profile.contactName,
        contactTitle: profile.contactTitle,
        phone: profile.phone,
        email: profile.email,
        addressLine1: profile.address.line1,
        addressLine2: profile.address.line2,
        city: profile.address.city,
        state: profile.address.state,
        zip: profile.address.zip,
        country: profile.address.country,
        uei: profile.uei,
        cageCode: profile.cageCode,
        dunsNumber: profile.dunsNumber,
        companySecurityLevel: profile.companySecurityLevel,
        employeeSecurityLevel: profile.employeeSecurityLevel,
        dcaaCompliant: profile.dcaaCompliant,
        primaryNaics: profile.primaryNaics,
        naicsList: profile.naicsList,
        pscCodes: profile.pscCodes,
        socioEconomic: profile.socioEconomic,
        contractingVehicles: profile.contractingVehicles,
        pastPerformance: profile.pastPerformance,
        searchKeywords: profile.searchKeywords,
        syncSource: profile.syncSource === "none" ? "manual" : profile.syncSource,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, organizationId));

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "settings.update",
      resourceType: "organization",
      resourceId: organizationId,
      metadata: { name: profile.name },
    });

    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    log.error("[saveOrgProfileAction]", "failed", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save changes.",
    };
  }
}

export async function applySamGovSyncAction(uei: string): Promise<
  | { ok: true }
  | { ok: false; error: string }
> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const result = await fetchSamGovByUei(uei.trim());
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const p = result.profile;

  try {
    await db
      .update(organizations)
      .set({
        name: p.name || undefined,
        website: p.website,
        uei: p.uei,
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
        socioEconomic: p.socioEconomic,
        syncSource: "samgov",
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, organizationId));

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "settings.samgov_sync",
      resourceType: "organization",
      resourceId: organizationId,
      metadata: { uei },
    });

    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    log.error("[applySamGovSyncAction]", "failed", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to apply SAM.gov data.",
    };
  }
}
