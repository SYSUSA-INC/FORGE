"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { removeCompanySamKey, setCompanySamKey } from "@/lib/samgov-key";

export type SamKeyActionResult = { ok: true; message: string } | { ok: false; error: string };

const READ_ONLY = "Read-only while impersonating.";

function revalidateSamKeyPages() {
  revalidatePath("/settings/integrations");
  revalidatePath("/settings");
  // Getting started on the Command Center reads whether SAM.gov is usable.
  revalidatePath("/");
}

/** BL-STAB-7b — test the pasted key with SAM.gov, then save it for this company (admins only). */
export async function setCompanySamKeyAction(input: { key: string }): Promise<SamKeyActionResult> {
  await requireAuth();
  const ctx = await requireCurrentOrg();
  if (ctx.isImpersonating) return { ok: false, error: READ_ONLY };
  const actor = await requireOrgAdmin(ctx.organizationId);
  const res = await setCompanySamKey({ organizationId: ctx.organizationId, rawKey: input?.key, actor: { userId: actor.id, email: actor.email ?? null } });
  if (res.ok) revalidateSamKeyPages();
  return res;
}

/** BL-STAB-7b — remove this company's own key; FORGE's shared key is used again (admins only). */
export async function removeCompanySamKeyAction(): Promise<SamKeyActionResult> {
  await requireAuth();
  const ctx = await requireCurrentOrg();
  if (ctx.isImpersonating) return { ok: false, error: READ_ONLY };
  const actor = await requireOrgAdmin(ctx.organizationId);
  const res = await removeCompanySamKey({ organizationId: ctx.organizationId, actor: { userId: actor.id, email: actor.email ?? null } });
  revalidateSamKeyPages();
  return {
    ok: true,
    message: res.removed ? "Removed. FORGE's shared SAM.gov key is used for your company when one is available." : "There was no company key to remove.",
  };
}
