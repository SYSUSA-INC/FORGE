"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { addVoiceSample, rebuildVoiceProfile, removeVoiceSample, updateVoiceSettings, type RebuildResult } from "@/lib/voice";

/** BL-FB-GEN-VOICE — rebuild the signed-in author's voice from their sections and samples. */
export async function rebuildMyVoiceAction(): Promise<RebuildResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await rebuildVoiceProfile({ organizationId, userId: user.id, actor: { userId: user.id, email: user.email } });
  if (res.ok) revalidatePath("/settings");
  return res;
}

export async function addMyVoiceSampleAction(input: { title: string; text: string }): Promise<{ ok: true; id: string; words: number } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await addVoiceSample({ organizationId, userId: user.id, title: String(input.title ?? ""), text: String(input.text ?? ""), actor: { userId: user.id, email: user.email } });
  if (res.ok) revalidatePath("/settings");
  return res;
}

export async function removeMyVoiceSampleAction(sampleId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await removeVoiceSample({ organizationId, userId: user.id, sampleId, actor: { userId: user.id, email: user.email } });
  if (res.ok) revalidatePath("/settings");
  return res;
}

export async function updateMyVoiceSettingsAction(input: { enabled: boolean; customGuidance: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await updateVoiceSettings({ organizationId, userId: user.id, enabled: !!input.enabled, customGuidance: String(input.customGuidance ?? ""), actor: { userId: user.id, email: user.email } });
  if (res.ok) revalidatePath("/settings");
  return res;
}
