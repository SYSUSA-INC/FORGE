/**
 * BL-NAV-LIFECYCLE 5c — a review round's meeting against Postgres. Two
 * tenants. Asserts: tenant B cannot read, set, clear or send invites for
 * tenant A's round (all "not found", nothing changes); tenant A can set a
 * link and time, a bad link is refused, a closed round cannot change; the
 * invites and the day-before reminder stamp the round once and are
 * audited; the reminder worker handles each tenant's round on its own.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, proposalReviewAssignments, proposalReviews } from "@/db/schema";
import { deliverMeetingEmails, getReviewMeeting, sendMeetingInvites, setReviewMeeting } from "@/lib/review-meeting";
import { dispatchMeetingReminders } from "@/lib/review-reminders";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const LINK = "https://teams.microsoft.com/l/meetup-join/tenant-a";
const NOW = new Date("2026-12-01T08:00:00.000Z");
const TOMORROW = "2026-12-02T15:00:00.000Z";

describe("BL-NAV-LIFECYCLE 5c — review meeting", () => {
  let fx: TwoTenantFixture;
  let reviewA = "";
  let reviewB = "";

  beforeEach(async () => {
    fx = await createTwoTenants("review-meeting");
    const [a] = await db.insert(proposalReviews).values({ proposalId: fx.orgA.proposalId, color: "red", status: "in_progress" }).returning({ id: proposalReviews.id });
    const [b] = await db.insert(proposalReviews).values({ proposalId: fx.orgB.proposalId, color: "pink", status: "in_progress" }).returning({ id: proposalReviews.id });
    reviewA = a!.id;
    reviewB = b!.id;
    await db.insert(proposalReviewAssignments).values([
      { reviewId: reviewA, userId: fx.orgA.userId },
      { reviewId: reviewB, userId: fx.orgB.userId },
    ]);
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  const actorA = () => ({ userId: fx.orgA.userId, email: "a@test" });

  it("keeps tenant A's meeting from tenant B: read, set, clear and invites", async () => {
    expect((await setReviewMeeting({ organizationId: fx.orgA.organizationId, reviewId: reviewA, url: LINK, at: TOMORROW, actor: actorA() })).ok).toBe(true);

    expect(await getReviewMeeting(fx.orgB.organizationId, reviewA)).toBeNull();
    const own = await getReviewMeeting(fx.orgA.organizationId, reviewA);
    expect(own?.url).toBe(LINK);

    const set = await setReviewMeeting({ organizationId: fx.orgB.organizationId, reviewId: reviewA, url: "https://evil.test/x", at: TOMORROW, actor: actorA() });
    expect(set).toEqual({ ok: false, error: "Review not found." });
    const clear = await setReviewMeeting({ organizationId: fx.orgB.organizationId, reviewId: reviewA, url: "", at: "", actor: actorA() });
    expect(clear).toEqual({ ok: false, error: "Review not found." });
    const invites = await sendMeetingInvites({ organizationId: fx.orgB.organizationId, reviewId: reviewA, actor: actorA() });
    expect(invites).toEqual({ ok: false, error: "Review not found." });
    const mail = await deliverMeetingEmails({ organizationId: fx.orgB.organizationId, reviewId: reviewA, kind: "reminder" });
    expect(mail).toEqual({ ok: false, error: "Review not found." });

    const [row] = await db.select().from(proposalReviews).where(eq(proposalReviews.id, reviewA));
    expect(row!.meetingUrl).toBe(LINK);
    expect(row!.meetingInvitesSentAt).toBeNull();
  });

  it("refuses a bad link, a bad time and a closed round; blank clears; audits", async () => {
    const org = fx.orgA.organizationId;
    expect((await setReviewMeeting({ organizationId: org, reviewId: reviewA, url: "javascript:alert(1)", at: TOMORROW, actor: actorA() })).ok).toBe(false);
    expect((await setReviewMeeting({ organizationId: org, reviewId: reviewA, url: LINK, at: "not a time", actor: actorA() })).ok).toBe(false);
    expect((await getReviewMeeting(org, reviewA))?.url).toBeNull();

    expect((await setReviewMeeting({ organizationId: org, reviewId: reviewA, url: LINK, at: TOMORROW, actor: actorA() })).ok).toBe(true);
    expect((await setReviewMeeting({ organizationId: org, reviewId: reviewA, url: "", at: "", actor: actorA() })).ok).toBe(true);
    const cleared = await getReviewMeeting(org, reviewA);
    expect(cleared?.url).toBeNull();
    expect(cleared?.at).toBeNull();

    const actions = (await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.organizationId, org), eq(auditLogs.resourceId, reviewA)))).map((r) => r.action);
    expect(actions).toContain("proposal.review.meeting_set");
    expect(actions).toContain("proposal.review.meeting_cleared");

    await db.update(proposalReviews).set({ status: "complete" }).where(eq(proposalReviews.id, reviewA));
    const closed = await setReviewMeeting({ organizationId: org, reviewId: reviewA, url: LINK, at: TOMORROW, actor: actorA() });
    expect(closed.ok).toBe(false);
  });

  it("needs a link and a time before invites go, then stamps and audits them", async () => {
    const org = fx.orgA.organizationId;
    const early = await sendMeetingInvites({ organizationId: org, reviewId: reviewA, actor: actorA() });
    expect(early).toEqual({ ok: false, error: "Set a meeting link and a start time first." });

    await setReviewMeeting({ organizationId: org, reviewId: reviewA, url: LINK, at: TOMORROW, actor: actorA() });
    const sent = await sendMeetingInvites({ organizationId: org, reviewId: reviewA, actor: actorA(), now: NOW });
    expect(sent).toMatchObject({ ok: true, sent: 1, failed: 0 });
    expect((await getReviewMeeting(org, reviewA))?.invitesSentAt?.toISOString()).toBe(NOW.toISOString());
    const [audit] = await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.organizationId, org), eq(auditLogs.action, "proposal.review.meeting_invites")));
    expect(audit).toBeTruthy();
  });

  it("sends the day-before reminder once per tenant, each through its own round", async () => {
    await setReviewMeeting({ organizationId: fx.orgA.organizationId, reviewId: reviewA, url: LINK, at: TOMORROW, actor: actorA() });
    await setReviewMeeting({ organizationId: fx.orgB.organizationId, reviewId: reviewB, url: "https://zoom.us/j/b", at: "2026-12-20T15:00:00.000Z", actor: { userId: fx.orgB.userId, email: "b@test" } });

    const first = await dispatchMeetingReminders(NOW);
    expect(first.reminded).toBeGreaterThanOrEqual(1);
    const a = await getReviewMeeting(fx.orgA.organizationId, reviewA);
    const b = await getReviewMeeting(fx.orgB.organizationId, reviewB);
    expect(a?.reminderSentAt?.toISOString()).toBe(NOW.toISOString());
    expect(b?.reminderSentAt).toBeNull(); // weeks away

    const second = await dispatchMeetingReminders(NOW);
    expect(second.errors).toBe(0);
    expect((await getReviewMeeting(fx.orgA.organizationId, reviewA))?.reminderSentAt?.toISOString()).toBe(NOW.toISOString());

    // Moving the meeting earns a fresh reminder.
    await setReviewMeeting({ organizationId: fx.orgA.organizationId, reviewId: reviewA, url: LINK, at: "2026-12-02T18:00:00.000Z", actor: actorA() });
    expect((await getReviewMeeting(fx.orgA.organizationId, reviewA))?.reminderSentAt).toBeNull();
  });
});
