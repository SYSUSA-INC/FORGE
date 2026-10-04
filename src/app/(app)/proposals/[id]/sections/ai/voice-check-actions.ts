"use server";

import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { voiceProfileForSection, type SectionVoiceProfile } from "@/lib/voice";

/**
 * BL-FB-GEN-VOICE Slice 2 — the section author's measured voice, for the
 * editor's in-browser check of the draft against it. Null when the
 * author has no enabled, built profile.
 */
export async function sectionVoiceProfileAction(sectionId: string): Promise<SectionVoiceProfile | null> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return voiceProfileForSection({ organizationId, sectionId });
}
