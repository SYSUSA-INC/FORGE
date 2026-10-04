"use server";

import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { heartbeatSectionPresence, leaveSectionPresence, type SectionViewer } from "@/lib/section-presence";

/**
 * BL-FB-CHAT-MULTI Slice 3 — an open section checks in and learns who
 * else has it open. Not audited: presence is ephemeral and carries no
 * content; the section itself is already readable by the member.
 */
export async function sectionPresenceAction(sectionId: string): Promise<{ ok: true; viewers: SectionViewer[] } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return heartbeatSectionPresence({ organizationId, sectionId: String(sectionId ?? ""), userId: user.id });
}

export async function leaveSectionPresenceAction(sectionId: string): Promise<void> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await leaveSectionPresence({ organizationId, sectionId: String(sectionId ?? ""), userId: user.id });
}
