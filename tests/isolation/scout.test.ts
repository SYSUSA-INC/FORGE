/**
 * BL-AIP-7b — the nightly scout against Postgres. No SAM.gov or model
 * call: candidates are inserted directly. Asserts that candidates,
 * decisions, the track and the profile are per organization; that an
 * import creates the opportunity in the deciding organization only and
 * grades the scout's call; and that a decided candidate cannot be
 * decided again.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, scoutCandidates } from "@/db/schema";
import {
  decideScoutCandidate,
  getScoutProfile,
  getScoutTrack,
  listScoutCandidates,
  saveScoutProfile,
} from "@/lib/scout";
import { DEFAULT_SCOUT_PROFILE, EMPTY_SCOUT_TRACK } from "@/lib/scout-logic";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-AIP-7b — scout", () => {
  let fx: TwoTenantFixture;
  let a1: string;
  let a2: string;
  let b1: string;

  beforeEach(async () => {
    fx = await createTwoTenants("scout");
    const rows = await db
      .insert(scoutCandidates)
      .values([
        {
          organizationId: fx.orgA.organizationId,
          source: "org_naics",
          noticeId: "n-a1",
          title: "A one",
          agency: "DOE",
          naicsCode: "541512",
          noticeType: "Solicitation",
          fitScore: 80,
          recommendation: "pursue",
          confidence: 0.8,
          responseDueAt: new Date("2030-01-15T00:00:00Z"),
        },
        {
          organizationId: fx.orgA.organizationId,
          source: "keyword",
          noticeId: "n-a2",
          title: "A two",
          noticeType: "Sources Sought",
          fitScore: 40,
          recommendation: "skip",
          confidence: 0.6,
        },
        // Same notice id as A's first: the unique index is per organization.
        {
          organizationId: fx.orgB.organizationId,
          source: "org_naics",
          noticeId: "n-a1",
          title: "B one",
          fitScore: 70,
          recommendation: "pursue",
        },
      ])
      .returning({ id: scoutCandidates.id, title: scoutCandidates.title });
    a1 = rows.find((r) => r.title === "A one")!.id;
    a2 = rows.find((r) => r.title === "A two")!.id;
    b1 = rows.find((r) => r.title === "B one")!.id;
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("lists each organization's own candidates, best fit first", async () => {
    const a = await listScoutCandidates({ organizationId: fx.orgA.organizationId, status: "new" });
    expect(a.map((c) => c.title)).toEqual(["A one", "A two"]);
    expect(a[0]).toMatchObject({ recommendation: "pursue", fitScore: 80, daysToDue: expect.any(Number) });
    const b = await listScoutCandidates({ organizationId: fx.orgB.organizationId, status: "new" });
    expect(b.map((c) => c.title)).toEqual(["B one"]);
    expect(await listScoutCandidates({ organizationId: fx.orgA.organizationId, status: "decided" })).toEqual([]);
  });

  it("imports into the deciding organization only, grades the call, and never decides twice", async () => {
    // B cannot decide A's candidate.
    expect(
      await decideScoutCandidate({
        organizationId: fx.orgB.organizationId,
        candidateId: a1,
        decision: "imported",
        actor: { userId: fx.orgB.userId },
      }),
    ).toEqual({ ok: false, error: "Candidate not found, or already decided." });

    const imported = await decideScoutCandidate({
      organizationId: fx.orgA.organizationId,
      candidateId: a1,
      decision: "imported",
      actor: { userId: fx.orgA.userId, email: "a@test" },
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.opportunityId).toBeTruthy();

    const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, imported.opportunityId!));
    expect(opp).toMatchObject({
      organizationId: fx.orgA.organizationId,
      title: "A one",
      agency: "DOE",
      noticeId: "n-a1",
      naicsCode: "541512",
      stage: "identified",
      createdByUserId: fx.orgA.userId,
    });
    expect(opp!.responseDueDate?.toISOString().slice(0, 10)).toBe("2030-01-15");

    const [row] = await db.select().from(scoutCandidates).where(eq(scoutCandidates.id, a1));
    expect(row).toMatchObject({
      status: "imported",
      grade: "correct",
      opportunityId: imported.opportunityId,
      decidedByUserId: fx.orgA.userId,
    });
    expect(row!.decidedAt).not.toBeNull();

    // Already decided.
    expect(
      await decideScoutCandidate({
        organizationId: fx.orgA.organizationId,
        candidateId: a1,
        decision: "dismissed",
        actor: { userId: fx.orgA.userId },
      }),
    ).toEqual({ ok: false, error: "Candidate not found, or already decided." });

    const dismissed = await decideScoutCandidate({
      organizationId: fx.orgA.organizationId,
      candidateId: a2,
      decision: "dismissed",
      actor: { userId: fx.orgA.userId },
    });
    expect(dismissed).toEqual({ ok: true, status: "dismissed", opportunityId: null });
    const [row2] = await db.select().from(scoutCandidates).where(eq(scoutCandidates.id, a2));
    expect(row2).toMatchObject({ status: "dismissed", grade: "correct", opportunityId: null });

    expect(await getScoutTrack({ organizationId: fx.orgA.organizationId })).toEqual({
      n: 2,
      correct: 2,
      wrong: 0,
      inconclusive: 0,
      accuracy: 1,
      imported: 1,
      dismissed: 1,
    });
    expect(await getScoutTrack({ organizationId: fx.orgB.organizationId })).toEqual(EMPTY_SCOUT_TRACK);

    const decided = await listScoutCandidates({ organizationId: fx.orgA.organizationId, status: "decided" });
    expect(decided.map((c) => c.title)).toEqual(["A two", "A one"]);
    expect(await listScoutCandidates({ organizationId: fx.orgA.organizationId, status: "new" })).toEqual([]);

    // B's candidate is untouched, and B created no opportunity.
    const [bRow] = await db.select().from(scoutCandidates).where(eq(scoutCandidates.id, b1));
    expect(bRow).toMatchObject({ status: "new", grade: null });
    const bOpps = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(eq(opportunities.organizationId, fx.orgB.organizationId));
    expect(bOpps).toHaveLength(1); // the fixture's own seed opportunity
  });

  it("profile defaults, cleans what it saves, and is per organization", async () => {
    expect(await getScoutProfile({ organizationId: fx.orgA.organizationId })).toEqual(DEFAULT_SCOUT_PROFILE);

    const saved = await saveScoutProfile({
      organizationId: fx.orgA.organizationId,
      patch: {
        keywords: ["cloud", " Zero Trust ", "", "cloud"],
        extraNaics: ["541512", "abc", "54-1519"],
        postedDaysBack: 30,
      },
      actor: { userId: fx.orgA.userId },
    });
    expect(saved).toMatchObject({
      enabled: true,
      keywords: ["cloud", "Zero Trust"],
      extraNaics: ["541512", "541519"],
      postedDaysBack: 14,
      lastRunAt: null,
    });
    expect(await getScoutProfile({ organizationId: fx.orgB.organizationId })).toEqual(DEFAULT_SCOUT_PROFILE);

    // A partial patch keeps the rest.
    const paused = await saveScoutProfile({
      organizationId: fx.orgA.organizationId,
      patch: { enabled: false },
      actor: { userId: fx.orgA.userId },
    });
    expect(paused).toMatchObject({ enabled: false, keywords: ["cloud", "Zero Trust"], postedDaysBack: 14 });
  });
});
