"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import {
  applyOnboardingProposal,
  applySamGovProfile,
  proposeOnboarding,
  type ApplyOnboardingResult,
  type ProposeResult,
  type SamGovApplyResult,
} from "@/lib/onboarding";

/**
 * BL-AIP-7d part ii — the Getting-started panel's actions. All three
 * change the organization's setup, so all three are for org admins.
 */

export async function applySamGovOnboardingAction(uei: string): Promise<SamGovApplyResult> {
  const { organizationId } = await requireCurrentOrg();
  const actor = await requireOrgAdmin(organizationId);
  const clean = String(uei ?? "").trim();
  if (!/^[A-Za-z0-9]{12}$/.test(clean)) {
    return { ok: false, error: "A UEI is 12 letters and digits." };
  }
  try {
    const res = await applySamGovProfile({
      organizationId,
      uei: clean,
      actor: { userId: actor.id, email: actor.email },
      via: "onboarding",
    });
    if (res.ok) {
      revalidatePath("/");
      revalidatePath("/settings");
    }
    return res;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "SAM.gov lookup failed." };
  }
}

export async function proposeOnboardingAction(input?: { sbaDescriptions?: string[] }): Promise<ProposeResult> {
  const { organizationId } = await requireCurrentOrg();
  const actor = await requireOrgAdmin(organizationId);
  try {
    return await proposeOnboarding({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      sbaDescriptions: Array.isArray(input?.sbaDescriptions)
        ? input.sbaDescriptions.filter((s): s is string => typeof s === "string").slice(0, 10)
        : [],
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The assistant could not propose a setup." };
  }
}

export async function applyOnboardingProposalAction(
  proposal: unknown,
  runScout: boolean,
): Promise<ApplyOnboardingResult> {
  const { organizationId } = await requireCurrentOrg();
  const actor = await requireOrgAdmin(organizationId);
  try {
    const res = await applyOnboardingProposal({
      organizationId,
      proposal,
      runScout: runScout === true,
      actor: { userId: actor.id, email: actor.email },
    });
    if (res.ok) {
      revalidatePath("/");
      revalidatePath("/opportunities/scout");
      revalidatePath("/opportunities");
      revalidatePath("/knowledge-base");
    }
    return res;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not save the setup." };
  }
}
