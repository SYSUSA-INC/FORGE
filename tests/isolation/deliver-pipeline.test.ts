/**
 * BL-NAV-LIFECYCLE 6d-2 — Pipeline → Deliver's lists against Postgres.
 * Two tenants. Asserts: Ready to deliver holds a tenant's own
 * opportunities in Develop whose newest proposal is at Gold or White
 * Gloves, with the sign-off line, and never another tenant's; an
 * opportunity not in Develop, or whose proposal is earlier, is not
 * ready; Delivered reads a tenant's own submissions and replies only,
 * does not take an answer for the submission, and counts the replies
 * since the last message sent.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { inboundEmails, opportunities, proposalReviewAssignments, proposalReviews, proposalSubmissions, proposals } from "@/db/schema";
import { deliveredSummaries, readyToDeliver } from "@/lib/deliver-pipeline";
import { createTwoTenants, type TenantFixture, type TwoTenantFixture } from "../helpers/fixtures";

const at = (d: string) => new Date(`2026-11-${d}T12:00:00Z`);

describe("BL-NAV-LIFECYCLE 6d-2 — Pipeline → Deliver", () => {
  let fx: TwoTenantFixture;

  beforeEach(async () => {
    fx = await createTwoTenants("deliver-pipeline");
  });
  afterEach(async () => {
    await fx.cleanup();
  });

  const place = async (t: TenantFixture, stage: "writing" | "capture" | "submitted", proposalStage: "draft" | "gold_team" | "white_gloves" | "submitted") => {
    await db.update(opportunities).set({ stage }).where(eq(opportunities.id, t.opportunityId));
    await db.update(proposals).set({ stage: proposalStage }).where(eq(proposals.id, t.proposalId));
  };
  const reply = (t: TenantFixture, day: string, type: string, status: "parsed" | "received" = "parsed") =>
    db.insert(inboundEmails).values({ organizationId: t.organizationId, providerMessageId: `<${day}-${type}-${t.organizationId}@agency.gov>`, kind: "proposal_reply", status, opportunityId: t.opportunityId, replyType: type, receivedAt: at(day) }).returning({ id: inboundEmails.id });

  it("lists what is ready to deliver, with its sign-off line, for its own tenant only", async () => {
    const { orgA: A, orgB: B } = fx;
    await place(A, "writing", "gold_team");
    await place(B, "writing", "white_gloves");
    for (const color of ["pink", "red"] as const) {
      const [r] = await db.insert(proposalReviews).values({ proposalId: A.proposalId, color, status: "complete", verdict: "pass" }).returning({ id: proposalReviews.id });
      await db.insert(proposalReviewAssignments).values({ reviewId: r!.id, userId: A.userId, verdict: "pass", submittedAt: at("10") });
    }
    await db.insert(proposalReviews).values({ proposalId: A.proposalId, color: "gold", status: "in_progress" });
    // Tenant B's rounds must not count for A.
    await db.insert(proposalReviews).values({ proposalId: B.proposalId, color: "green", status: "complete", verdict: "pass" });

    const ready = await readyToDeliver(A.organizationId);
    expect(ready.map((r) => r.id)).toEqual([A.opportunityId]);
    expect(ready[0]).toMatchObject({ proposalStage: "gold_team", signoffLine: "2 of 5 colour teams signed off; Green not run; Gold open; White Gloves not run" });
    expect((await readyToDeliver(B.organizationId)).map((r) => r.id)).toEqual([B.opportunityId]);

    await place(A, "writing", "draft");
    expect(await readyToDeliver(A.organizationId)).toEqual([]);
    await place(A, "capture", "gold_team");
    expect(await readyToDeliver(A.organizationId)).toEqual([]);
    await place(A, "submitted", "submitted");
    expect(await readyToDeliver(A.organizationId)).toEqual([]);
  });

  it("reads the delivered line from the tenant's own submissions and replies", async () => {
    const { orgA: A, orgB: B } = fx;
    await place(A, "submitted", "submitted");
    const base = { organizationId: A.organizationId, opportunityId: A.opportunityId, proposalId: A.proposalId };
    await db.insert(proposalSubmissions).values({ ...base, method: "portal_email", status: "sent", recipientsTo: ["co@agency.gov"], sentAt: at("12") });
    const [question] = await reply(A, "13", "question");
    await db.insert(proposalSubmissions).values({ ...base, method: "portal_email", status: "sent", recipientsTo: ["co@agency.gov"], sentAt: at("14"), inReplyToEmailId: question!.id });
    await reply(A, "15", "amendment");
    await reply(A, "16", "", "received");
    await reply(B, "17", "award");

    const mine = await deliveredSummaries(A.organizationId, [A.opportunityId, B.opportunityId]);
    expect([...mine.keys()]).toEqual([A.opportunityId]);
    expect(mine.get(A.opportunityId)).toEqual({
      submission: { method: "portal_email", sentAt: at("12").toISOString(), recipients: ["co@agency.gov"] },
      newestReply: { type: "", receivedAt: at("16").toISOString() },
      replies: 3,
      repliesSinceLastSent: 2,
    });
    // Tenant B asking about A's opportunity gets nothing.
    expect((await deliveredSummaries(B.organizationId, [A.opportunityId])).size).toBe(0);
    expect((await deliveredSummaries(A.organizationId, [])).size).toBe(0);
  });
});
