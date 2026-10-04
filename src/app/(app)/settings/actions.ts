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
import { applySamGovProfile } from "@/lib/onboarding";
import type { OrgProfile } from "@/lib/org-types";
import { hasErrors, validateOrgProfile } from "@/lib/validators";
import { REMINDER_CADENCE_LIMITS, sanitizeReminderCadence } from "@/lib/review-workflow-logic";
import { log } from "@/lib/log";
import {
  AUDIT_RETENTION_MAX_DAYS,
  AUDIT_RETENTION_MIN_DAYS,
} from "./audit-retention-constants";

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

/** BL-FB-X-COLOR-TEAM Slice 3 — how colour-team reviewers are reminded; org admins only. Audited. */
export async function setReviewReminderCadenceAction(input: { daysBefore: number; repeatDays: number }): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);
  const cadence = sanitizeReminderCadence(input);
  if (!cadence) {
    return {
      ok: false,
      error: `Whole days only: 0–${REMINDER_CADENCE_LIMITS.daysBefore.max} before the due date, 0–${REMINDER_CADENCE_LIMITS.repeatDays.max} between repeats.`,
    };
  }
  await db
    .update(organizations)
    .set({ reviewReminderDaysBefore: cadence.daysBefore, reviewReminderRepeatDays: cadence.repeatDays, updatedAt: new Date() })
    .where(eq(organizations.id, organizationId));
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "settings.review_reminders.update",
    resourceType: "organization",
    resourceId: organizationId,
    metadata: cadence,
  });
  revalidatePath("/settings");
  return { ok: true };
}

export async function setAuditRetentionDaysAction(
  days: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  if (
    !Number.isFinite(days) ||
    !Number.isInteger(days) ||
    days < AUDIT_RETENTION_MIN_DAYS ||
    days > AUDIT_RETENTION_MAX_DAYS
  ) {
    return {
      ok: false,
      error: `Retention must be a whole number between ${AUDIT_RETENTION_MIN_DAYS} and ${AUDIT_RETENTION_MAX_DAYS} days.`,
    };
  }

  try {
    await db
      .update(organizations)
      .set({ auditRetentionDays: days, updatedAt: new Date() })
      .where(eq(organizations.id, organizationId));

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "settings.audit_retention.update",
      resourceType: "organization",
      resourceId: organizationId,
      metadata: { days },
    });

    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    log.error("[setAuditRetentionDaysAction]", "failed", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update retention.",
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

  // BL-AIP-7d part ii — the pull + write lives in src/lib/onboarding.ts,
  // shared with the Command Center's Getting-started panel.
  try {
    const result = await applySamGovProfile({
      organizationId,
      uei,
      actor: { userId: actor.id, email: actor.email },
      via: "settings",
    });
    if (!result.ok) return { ok: false, error: result.error };

    revalidatePath("/settings");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    log.error("[applySamGovSyncAction]", "failed", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to apply SAM.gov data.",
    };
  }
}
