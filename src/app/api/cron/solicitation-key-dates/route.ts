import { NextResponse, type NextRequest } from "next/server";
import { dispatchKeyDateReminders } from "@/lib/solicitation-key-date-cron";
import { dispatchOpportunityDueSoon } from "@/lib/opportunity-due-soon-cron";
import { dispatchSolicitationQaPolls } from "@/lib/solicitation-qa";
import { dispatchReviewDueReminders } from "@/lib/review-reminders";
import { dispatchContactTouchReminders } from "@/lib/crm-reminders";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * BL-FB-SOL-CALENDAR — Vercel Cron handler for key-date reminders.
 *
 * Wired in vercel.json:
 *   { "path": "/api/cron/solicitation-key-dates", "schedule": "0 8 * * *" }
 *
 * Fires daily at 08:00 UTC. Scans all solicitations with stored keyDates,
 * finds dates exactly 1, 3, or 7 days away from today, and sends in-app
 * notifications to all assigned team members.
 *
 * BL-AIP-3 — the same daily tick also fires the rules-engine
 * `opportunity_due_soon` trigger for open opportunities whose response
 * is due in 1, 3 or 7 days (see `dispatchOpportunityDueSoon`). The two
 * scans are independent; a failure in one is reported in the response
 * without blocking the other.
 *
 * BL-FB-SOL-QA — the same tick polls the SAM.gov notices of live
 * solicitations for new Q&A attachments (`dispatchSolicitationQaPolls`,
 * bounded, skipped without SAMGOV_API_KEY).
 *
 * Auth: Bearer ${CRON_SECRET} — same pattern as all other cron routes.
 */
export async function GET(req: NextRequest) {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "CRON_SECRET not set. Cron auth is required — refusing to run open-bar.",
      },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret}`;
  if (auth !== expected) {
    log.warn("[solicitation-key-date-cron]", "unauthorized call", {
      hasAuth: auth.length > 0,
    });
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  const [keyDates, dueSoon, qaPolls, reviewReminders, contactReminders] = await Promise.allSettled([
    dispatchKeyDateReminders(),
    dispatchOpportunityDueSoon(),
    dispatchSolicitationQaPolls(),
    // BL-FB-X-COLOR-TEAM Slice 2 — day-before nudge to unsubmitted reviewers.
    dispatchReviewDueReminders(),
    // BL-FB-X-CRM Slice 2 — follow-up owed to a customer contact's owner.
    dispatchContactTouchReminders(),
  ]);

  const failures: string[] = [];
  if (contactReminders.status === "rejected") {
    const message = contactReminders.reason instanceof Error ? contactReminders.reason.message : String(contactReminders.reason);
    log.error("[solicitation-key-date-cron]", "contact reminders failed", { error: message });
    failures.push(`contactReminders: ${message}`);
  }
  if (reviewReminders.status === "rejected") {
    const message = reviewReminders.reason instanceof Error ? reviewReminders.reason.message : String(reviewReminders.reason);
    log.error("[solicitation-key-date-cron]", "review reminders failed", { error: message });
    failures.push(`reviewReminders: ${message}`);
  }
  if (qaPolls.status === "rejected") {
    const message = qaPolls.reason instanceof Error ? qaPolls.reason.message : String(qaPolls.reason);
    log.error("[solicitation-key-date-cron]", "Q&A poll failed", { error: message });
    failures.push(`solicitationQa: ${message}`);
  }
  if (keyDates.status === "rejected") {
    const message =
      keyDates.reason instanceof Error
        ? keyDates.reason.message
        : String(keyDates.reason);
    log.error("[solicitation-key-date-cron]", "key-date scan failed", {
      error: message,
    });
    failures.push(`keyDates: ${message}`);
  }
  if (dueSoon.status === "rejected") {
    const message =
      dueSoon.reason instanceof Error
        ? dueSoon.reason.message
        : String(dueSoon.reason);
    log.error("[solicitation-key-date-cron]", "due-soon scan failed", {
      error: message,
    });
    failures.push(`opportunityDueSoon: ${message}`);
  }

  const body = {
    ...(keyDates.status === "fulfilled" ? keyDates.value : {}),
    opportunityDueSoon:
      dueSoon.status === "fulfilled" ? dueSoon.value : null,
    solicitationQa: qaPolls.status === "fulfilled" ? qaPolls.value : null,
    reviewReminders: reviewReminders.status === "fulfilled" ? reviewReminders.value : null,
    contactReminders: contactReminders.status === "fulfilled" ? contactReminders.value : null,
  };

  if (failures.length > 0) {
    return NextResponse.json(
      { ok: false, error: failures.join("; "), ...body },
      { status: 500 },
    );
  }
  log.info("[solicitation-key-date-cron]", "dispatch complete", body);
  return NextResponse.json({ ok: true, ...body });
}
