/**
 * BL-FB-CHAT-MULTI Slice 3 — who has a section open. The section page
 * checks in while a section is open (`heartbeatSectionPresence`) and
 * leaves when it closes; each check-in returns the other members seen in
 * the last 75 seconds. Scoped to the section's organization; works on
 * serverless hosting without the Hocuspocus layer.
 */
import "server-only";

import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { sectionPresence, users } from "@/db/schema";
import { findSectionForOrg } from "@/lib/section-chat";
import { PRESENCE_SWEEP_MS, PRESENCE_TTL_MS, activeViewers } from "@/lib/presence-logic";

export type SectionViewer = { userId: string; name: string };

export async function heartbeatSectionPresence(input: {
  organizationId: string;
  sectionId: string;
  userId: string;
  now?: Date;
}): Promise<{ ok: true; viewers: SectionViewer[] } | { ok: false; error: string }> {
  const { organizationId, sectionId, userId } = input;
  const now = input.now ?? new Date();
  if (!(await findSectionForOrg({ organizationId, sectionId }))) return { ok: false, error: "Section not found." };

  await db
    .insert(sectionPresence)
    .values({ organizationId, sectionId, userId, lastSeenAt: now })
    .onConflictDoUpdate({ target: [sectionPresence.organizationId, sectionPresence.sectionId, sectionPresence.userId], set: { lastSeenAt: now } });
  // Sweep this section's long-gone rows (a tab closed without saying goodbye).
  await db
    .delete(sectionPresence)
    .where(
      and(
        eq(sectionPresence.organizationId, organizationId),
        eq(sectionPresence.sectionId, sectionId),
        lt(sectionPresence.lastSeenAt, new Date(now.getTime() - PRESENCE_SWEEP_MS)),
      ),
    );
  const rows = await db
    .select({ userId: sectionPresence.userId, lastSeenAt: sectionPresence.lastSeenAt, name: users.name, email: users.email })
    .from(sectionPresence)
    .innerJoin(users, eq(users.id, sectionPresence.userId))
    .where(
      and(
        eq(sectionPresence.organizationId, organizationId),
        eq(sectionPresence.sectionId, sectionId),
        gte(sectionPresence.lastSeenAt, new Date(now.getTime() - PRESENCE_TTL_MS)),
      ),
    );
  const viewers = activeViewers(
    rows.map((r) => ({ userId: r.userId, name: r.name?.trim() || r.email?.split("@")[0] || "A teammate", lastSeenAt: r.lastSeenAt })),
    userId,
    now,
  );
  return { ok: true, viewers };
}

/** The section closed: this member is no longer here. */
export async function leaveSectionPresence(input: { organizationId: string; sectionId: string; userId: string }): Promise<void> {
  const { organizationId } = input;
  await db
    .delete(sectionPresence)
    .where(
      and(
        eq(sectionPresence.organizationId, organizationId),
        eq(sectionPresence.sectionId, input.sectionId),
        eq(sectionPresence.userId, input.userId),
      ),
    );
}
