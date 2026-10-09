/**
 * BL-AIP-7a — stored, graded briefs, against Postgres. No model call:
 * rows are inserted directly. Asserts that a closed pursuit grades the
 * briefs that made a call on it (and only those), that the latest brief
 * and the track are read per organization, and that feedback cannot
 * cross tenants.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { aiBriefs } from "@/db/schema";
import {
  getBriefTrack,
  gradeBriefsForOpportunity,
  latestBrief,
  setBriefFeedback,
} from "@/lib/briefs";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-AIP-7a — briefs", () => {
  let fx: TwoTenantFixture;
  let pursueId: string;
  let watchId: string;
  let bId: string;

  beforeEach(async () => {
    fx = await createTwoTenants("briefs");
    // One INSERT gives every row the same created_at (now() is fixed per
    // transaction), so "latest" would be a tie broken by storage order.
    // Give the rows distinct times: "Watch it." is the newer brief.
    const at = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000);
    const rows = await db
      .insert(aiBriefs)
      .values([
        {
          organizationId: fx.orgA.organizationId,
          kind: "pursuit",
          opportunityId: fx.orgA.opportunityId,
          text: "Pursue it.",
          recommendation: "pursue",
          confidence: 0.7,
          snapshotKey: "k1",
          createdAt: at(120),
        },
        {
          organizationId: fx.orgA.organizationId,
          kind: "pursuit",
          opportunityId: fx.orgA.opportunityId,
          text: "Watch it.",
          recommendation: "watch",
          confidence: 0.4,
          snapshotKey: "k2",
          createdAt: at(60),
        },
        {
          organizationId: fx.orgB.organizationId,
          kind: "pursuit",
          opportunityId: fx.orgB.opportunityId,
          text: "B pursues.",
          recommendation: "pursue",
          confidence: 0.9,
          snapshotKey: "kb",
        },
      ])
      .returning({ id: aiBriefs.id, text: aiBriefs.text });
    pursueId = rows.find((r) => r.text === "Pursue it.")!.id;
    watchId = rows.find((r) => r.text === "Watch it.")!.id;
    bId = rows.find((r) => r.text === "B pursues.")!.id;
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("grades every ungraded call on a closed pursuit, once, per organization", async () => {
    const first = await gradeBriefsForOpportunity({
      organizationId: fx.orgA.organizationId,
      opportunityId: fx.orgA.opportunityId,
      outcome: "lost",
    });
    expect(first).toEqual({ graded: 2 });
    const [pursue] = await db.select().from(aiBriefs).where(eq(aiBriefs.id, pursueId));
    const [watch] = await db.select().from(aiBriefs).where(eq(aiBriefs.id, watchId));
    const [b] = await db.select().from(aiBriefs).where(eq(aiBriefs.id, bId));
    expect(pursue).toMatchObject({ outcome: "lost", grade: "wrong" });
    expect(pursue!.gradedAt).not.toBeNull();
    expect(watch).toMatchObject({ outcome: "lost", grade: "inconclusive" });
    expect(b).toMatchObject({ outcome: null, grade: null, gradedAt: null });

    // A second close (re-stated decision) grades nothing again.
    expect(
      await gradeBriefsForOpportunity({
        organizationId: fx.orgA.organizationId,
        opportunityId: fx.orgA.opportunityId,
        outcome: "won",
      }),
    ).toEqual({ graded: 0 });
    expect((await db.select().from(aiBriefs).where(eq(aiBriefs.id, pursueId)))[0]!.grade).toBe("wrong");

    // B closing A's opportunity id touches nothing of A's.
    await gradeBriefsForOpportunity({
      organizationId: fx.orgB.organizationId,
      opportunityId: fx.orgA.opportunityId,
      outcome: "won",
    });
    expect((await db.select().from(aiBriefs).where(eq(aiBriefs.id, bId)))[0]!.grade).toBeNull();

    expect(await getBriefTrack({ organizationId: fx.orgA.organizationId })).toEqual({
      n: 2,
      correct: 0,
      wrong: 1,
      inconclusive: 1,
      accuracy: 0,
    });
    expect(await getBriefTrack({ organizationId: fx.orgB.organizationId })).toEqual({
      n: 0,
      correct: 0,
      wrong: 0,
      inconclusive: 0,
      accuracy: null,
    });
  });

  it("latest brief and feedback are per organization", async () => {
    const latestA = await latestBrief({
      organizationId: fx.orgA.organizationId,
      kind: "pursuit",
      opportunityId: fx.orgA.opportunityId,
    });
    expect(latestA?.text).toBe("Watch it.");
    expect(
      await latestBrief({
        organizationId: fx.orgB.organizationId,
        kind: "pursuit",
        opportunityId: fx.orgA.opportunityId,
      }),
    ).toBeNull();
    expect(await latestBrief({ organizationId: fx.orgA.organizationId, kind: "pipeline" })).toBeNull();

    const cross = await setBriefFeedback({
      organizationId: fx.orgB.organizationId,
      briefId: pursueId,
      feedback: "useful",
      actor: { userId: fx.orgB.userId },
    });
    expect(cross).toEqual({ ok: false, error: "Brief not found." });

    const own = await setBriefFeedback({
      organizationId: fx.orgA.organizationId,
      briefId: pursueId,
      feedback: "not_useful",
      actor: { userId: fx.orgA.userId, email: "a@test" },
    });
    expect(own).toEqual({ ok: true });
    const [row] = await db.select().from(aiBriefs).where(eq(aiBriefs.id, pursueId));
    expect(row).toMatchObject({ feedback: "not_useful", feedbackUserId: fx.orgA.userId });
  });
});
