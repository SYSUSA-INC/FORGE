/**
 * BL-FB-CHAT-MULTI Slice 3 — section presence against Postgres: a member
 * sees the teammates who have the section open, never themself, never
 * another tenant's section; stale check-ins age out and are swept; leaving
 * removes the member at once.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { memberships, proposalSections, sectionPresence, users } from "@/db/schema";
import { heartbeatSectionPresence, leaveSectionPresence } from "@/lib/section-presence";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-FB-CHAT-MULTI — who has a section open", () => {
  let fx: TwoTenantFixture;
  let section = "";
  const tag = Date.now().toString(36);
  const ben = `presence-ben-${tag}`;

  beforeEach(async () => {
    fx = await createTwoTenants("presence");
    const [s] = await db
      .insert(proposalSections)
      .values({ proposalId: fx.orgA.proposalId, kind: "technical", title: "Technical approach" })
      .returning({ id: proposalSections.id });
    section = s!.id;
    await db.insert(users).values({ id: ben, name: "Ben Ortiz", email: `${ben}@presence.test`, emailVerified: new Date() });
    await db.insert(memberships).values({ userId: ben, organizationId: fx.orgA.organizationId, role: "author", status: "active" });
  });

  afterEach(async () => {
    await fx.cleanup();
    await db.delete(users).where(inArray(users.id, [ben]));
  });

  it("shows teammates here now, ages out the stale, and forgets on leave", async () => {
    const A = fx.orgA.organizationId;
    const t0 = new Date();
    expect(await heartbeatSectionPresence({ organizationId: A, sectionId: section, userId: fx.orgA.userId, now: t0 })).toEqual({ ok: true, viewers: [] });

    const seenByBen = await heartbeatSectionPresence({ organizationId: A, sectionId: section, userId: ben, now: new Date(t0.getTime() + 5_000) });
    expect(seenByBen).toMatchObject({ ok: true, viewers: [{ userId: fx.orgA.userId }] });
    const seenByA = await heartbeatSectionPresence({ organizationId: A, sectionId: section, userId: fx.orgA.userId, now: new Date(t0.getTime() + 10_000) });
    expect(seenByA).toEqual({ ok: true, viewers: [{ userId: ben, name: "Ben Ortiz" }] });

    // Another tenant can't check in on (or see) A's section.
    expect(await heartbeatSectionPresence({ organizationId: fx.orgB.organizationId, sectionId: section, userId: fx.orgB.userId })).toEqual({ ok: false, error: "Section not found." });
    expect(await db.select().from(sectionPresence).where(eq(sectionPresence.organizationId, fx.orgB.organizationId))).toEqual([]);

    // Two minutes on without Ben checking in: he has aged out.
    const later = new Date(t0.getTime() + 125_000);
    expect(await heartbeatSectionPresence({ organizationId: A, sectionId: section, userId: fx.orgA.userId, now: later })).toEqual({ ok: true, viewers: [] });
    // Fifteen minutes on, his row is swept.
    await heartbeatSectionPresence({ organizationId: A, sectionId: section, userId: fx.orgA.userId, now: new Date(t0.getTime() + 15 * 60_000) });
    expect(await db.select().from(sectionPresence).where(and(eq(sectionPresence.organizationId, A), eq(sectionPresence.userId, ben)))).toEqual([]);

    // Leaving removes the member at once.
    await leaveSectionPresence({ organizationId: A, sectionId: section, userId: fx.orgA.userId });
    expect(await db.select().from(sectionPresence).where(eq(sectionPresence.sectionId, section))).toEqual([]);
  });
});
