"use server";

import { randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  memberships,
  notifications,
  opportunities,
  opportunityActivities,
  opportunityReviewRequests,
  organizations,
  users,
  type OpportunityReviewRecommendation,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { sendOpportunityReviewRequestEmail } from "@/lib/email";

export type SendReviewRequestInput = {
  opportunityId: string;
  /** Either reviewerUserId OR (reviewerEmail + reviewerName) is required. */
  reviewerUserId?: string;
  reviewerEmail?: string;
  reviewerName?: string;
  note?: string;
};

export type SendReviewRequestResult =
  | { ok: true; id: string; emailSent: boolean }
  | { ok: false; error: string };

const TOKEN_BYTES = 24; // ~32 chars after base64url
const TOKEN_TTL_HOURS = 72;

export async function sendOpportunityReviewRequestAction(
  input: SendReviewRequestInput,
): Promise<SendReviewRequestResult> {
  const sender = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  if (!input.opportunityId) {
    return { ok: false, error: "Missing opportunity." };
  }

  // Resolve reviewer — must be either an in-org user OR an email.
  let reviewerEmail = input.reviewerEmail?.trim() ?? "";
  let reviewerName = input.reviewerName?.trim() ?? "";
  let reviewerUserId: string | null = null;

  if (input.reviewerUserId) {
    const [m] = await db
      .select({
        userId: users.id,
        userName: users.name,
        userEmail: users.email,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, input.reviewerUserId),
          eq(memberships.status, "active"),
        ),
      )
      .limit(1);
    if (!m) {
      return { ok: false, error: "Reviewer is not an active member of your org." };
    }
    reviewerUserId = m.userId;
    reviewerEmail = m.userEmail;
    reviewerName = m.userName ?? "";
  } else {
    if (!isLikelyEmail(reviewerEmail)) {
      return { ok: false, error: "Provide a reviewer email or pick a teammate." };
    }
  }

  // Confirm the opportunity belongs to the caller's org.
  const [opp] = await db
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.id, input.opportunityId),
        eq(opportunities.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!opp) return { ok: false, error: "Opportunity not found." };

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

  const note = (input.note ?? "").trim().slice(0, 2000);

  const [row] = await db
    .insert(opportunityReviewRequests)
    .values({
      organizationId,
      opportunityId: opp.id,
      senderUserId: sender.id,
      reviewerUserId,
      reviewerEmail,
      reviewerName: reviewerName.slice(0, 256),
      token,
      note,
      expiresAt,
    })
    .returning({ id: opportunityReviewRequests.id });
  if (!row) return { ok: false, error: "Could not create review request." };

  // Activity entry on the opportunity timeline.
  await db.insert(opportunityActivities).values({
    opportunityId: opp.id,
    userId: sender.id,
    kind: "note",
    title: "Sent for review",
    body: `Sent to ${reviewerName || reviewerEmail}${note ? ` — ${note}` : ""}`,
    metadata: {
      reviewRequestId: row.id,
      reviewer: reviewerEmail,
    },
  });

  // Send the email. Log the failure but don't fail the action — the
  // sender can copy the magic link from the activity entry on the opp.
  let emailSent = false;
  try {
    await sendOpportunityReviewRequestEmail({
      to: reviewerEmail,
      reviewerName,
      senderName: sender.name ?? sender.email ?? "A teammate",
      senderEmail: sender.email ?? "",
      organizationName: org?.name ?? "your organization",
      opportunityTitle: opp.title,
      agency: opp.agency,
      naics: opp.naicsCode,
      setAside: opp.setAside,
      dueDate: opp.responseDueDate
        ? opp.responseDueDate.toLocaleDateString()
        : "—",
      synopsis: opp.description.slice(0, 800),
      note,
      token,
    });
    emailSent = true;
  } catch (err) {
    console.error("[sendOpportunityReviewRequest] email", err);
  }

  revalidatePath(`/opportunities/${opp.id}`);
  revalidatePath("/opportunities");
  return { ok: true, id: row.id, emailSent };
}

export type ReviewByTokenResult =
  | {
      ok: true;
      requestId: string;
      organizationName: string;
      opportunity: {
        title: string;
        agency: string;
        office: string;
        solicitationNumber: string;
        naicsCode: string;
        setAside: string;
        dueDate: string | null;
        valueLow: string;
        valueHigh: string;
        description: string;
      };
      sender: { name: string; email: string };
      reviewerName: string;
      note: string;
      expired: boolean;
      completedAt: Date | null;
      recommendation: OpportunityReviewRecommendation;
      comment: string;
    }
  | { ok: false; error: string };

/**
 * Lookup a review request by its token. Used by the public
 * /review/[token] page; no auth required.
 */
export async function getReviewRequestByTokenAction(
  token: string,
): Promise<ReviewByTokenResult> {
  if (!token) return { ok: false, error: "Missing token." };

  const [row] = await db
    .select({
      r: opportunityReviewRequests,
      o: opportunities,
      org: organizations.name,
      senderName: users.name,
      senderEmail: users.email,
    })
    .from(opportunityReviewRequests)
    .innerJoin(
      opportunities,
      eq(opportunityReviewRequests.opportunityId, opportunities.id),
    )
    .innerJoin(
      organizations,
      eq(opportunityReviewRequests.organizationId, organizations.id),
    )
    .leftJoin(
      users,
      eq(opportunityReviewRequests.senderUserId, users.id),
    )
    .where(eq(opportunityReviewRequests.token, token))
    .limit(1);

  if (!row) return { ok: false, error: "Review link not found or already revoked." };

  const expired = row.r.expiresAt.getTime() < Date.now();

  return {
    ok: true,
    requestId: row.r.id,
    organizationName: row.org,
    opportunity: {
      title: row.o.title,
      agency: row.o.agency,
      office: row.o.office,
      solicitationNumber: row.o.solicitationNumber,
      naicsCode: row.o.naicsCode,
      setAside: row.o.setAside,
      dueDate: row.o.responseDueDate
        ? row.o.responseDueDate.toISOString()
        : null,
      valueLow: row.o.valueLow,
      valueHigh: row.o.valueHigh,
      description: row.o.description,
    },
    sender: {
      name: row.senderName ?? "A teammate",
      email: row.senderEmail ?? "",
    },
    reviewerName: row.r.reviewerName,
    note: row.r.note,
    expired,
    completedAt: row.r.completedAt,
    recommendation: row.r.recommendation,
    comment: row.r.comment,
  };
}

export type SubmitReviewInput = {
  token: string;
  recommendation: "bid" | "no_bid" | "more_info";
  comment?: string;
};

export type SubmitReviewResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Reviewer's submission. Token-authed (no login required). When the
 * recommendation is "bid", we auto-advance the opportunity stage from
 * `identified` to `qualification` per product decision. We only
 * advance if the current stage is still `identified` — don't clobber
 * a manager who has already moved it forward.
 */
export async function submitOpportunityReviewAction(
  input: SubmitReviewInput,
): Promise<SubmitReviewResult> {
  if (!input.token) return { ok: false, error: "Missing token." };
  if (!["bid", "no_bid", "more_info"].includes(input.recommendation)) {
    return { ok: false, error: "Invalid recommendation." };
  }

  const [row] = await db
    .select()
    .from(opportunityReviewRequests)
    .where(eq(opportunityReviewRequests.token, input.token))
    .limit(1);
  if (!row) return { ok: false, error: "Review link not found." };
  if (row.completedAt) {
    return { ok: false, error: "This review has already been submitted." };
  }
  if (row.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "This review link has expired." };
  }

  const comment = (input.comment ?? "").trim().slice(0, 4000);
  const now = new Date();

  await db
    .update(opportunityReviewRequests)
    .set({
      recommendation: input.recommendation,
      comment,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(opportunityReviewRequests.id, row.id));

  // Activity entry capturing the verdict.
  await db.insert(opportunityActivities).values({
    opportunityId: row.opportunityId,
    userId: row.reviewerUserId,
    kind: "gate_decision",
    title: `Review recommendation — ${labelFor(input.recommendation)}`,
    body:
      `From ${row.reviewerName || row.reviewerEmail}` +
      (comment ? `\n\n${comment}` : ""),
    metadata: {
      reviewRequestId: row.id,
      recommendation: input.recommendation,
      reviewerEmail: row.reviewerEmail,
    },
  });

  // Auto-advance to `qualification` on Bid, but only if still in
  // `identified`. Don't clobber a manager who has already moved it.
  if (input.recommendation === "bid") {
    const [opp] = await db
      .select({ id: opportunities.id, stage: opportunities.stage })
      .from(opportunities)
      .where(eq(opportunities.id, row.opportunityId))
      .limit(1);
    if (opp && opp.stage === "identified") {
      await db
        .update(opportunities)
        .set({ stage: "qualification", updatedAt: now })
        .where(eq(opportunities.id, opp.id));
      await db.insert(opportunityActivities).values({
        opportunityId: opp.id,
        userId: row.reviewerUserId,
        kind: "stage_change",
        title: "Auto-advanced to Qualification",
        body: "Reviewer recommended Bid; stage moved from Identified to Qualification.",
        metadata: {
          fromStage: "identified",
          toStage: "qualification",
          source: "review_recommendation",
        },
      });
    }
  }

  // Notify the sender.
  if (row.senderUserId) {
    const [opp] = await db
      .select({ title: opportunities.title })
      .from(opportunities)
      .where(eq(opportunities.id, row.opportunityId))
      .limit(1);
    await db.insert(notifications).values({
      organizationId: row.organizationId,
      recipientUserId: row.senderUserId,
      actorUserId: row.reviewerUserId,
      kind: "opportunity_review_completed",
      subject: `Review back — ${labelFor(input.recommendation)}: ${opp?.title ?? "an opportunity"}`,
      body:
        `${row.reviewerName || row.reviewerEmail} recommended ${labelFor(input.recommendation)}.` +
        (comment ? `\n\n"${comment.slice(0, 300)}"` : ""),
      linkPath: `/opportunities/${row.opportunityId}`,
    });
  }

  revalidatePath(`/opportunities/${row.opportunityId}`);
  return { ok: true };
}

function labelFor(rec: "bid" | "no_bid" | "more_info"): string {
  if (rec === "bid") return "Bid";
  if (rec === "no_bid") return "No-bid";
  return "More info";
}

function isLikelyEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * For the modal — list active org members the sender can pick from.
 */
export async function listOrgReviewerCandidatesAction(): Promise<
  { id: string; name: string; email: string }[]
> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.status, "active"),
      ),
    );

  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? "",
    email: r.email,
  }));
}
