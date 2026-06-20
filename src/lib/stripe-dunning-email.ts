import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { memberships, organizations, users } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { log } from "@/lib/log";

/**
 * BL-17 Slice 4 — single notification email on invoice.payment_failed.
 *
 * Stripe Smart Retries owns retry timing (configurable in Stripe
 * Dashboard; default is 3 retries over 1-2 weeks). For every retry
 * Stripe fires another `invoice.payment_failed` event — but emailing
 * the admin three times for the same invoice is spammy. We dedupe by
 * the invoice id: only the FIRST payment_failed for a given invoice
 * fires an email.
 *
 * Recipients: every active org admin. Sales-led customers may have
 * billing-only contacts in the future; until then admins are the
 * right audience.
 *
 * Future slice can fan out to FORGE-side notification_delivery rows
 * for in-app notifications. For now, email is the only surface.
 */
export async function sendPaymentFailedEmail(input: {
  organizationId: string;
  invoiceId: string;
  amountDueCents: number;
  currency: string;
  hostedInvoiceUrl: string | null;
  attemptCount: number;
  nextPaymentAttemptAt: Date | null;
}): Promise<void> {
  // Dedup by invoice id. We've already inserted a payment_event row
  // for this Stripe event; we count how many prior `payment_event`
  // rows exist for the same invoice id in the payload. The current
  // event is the +1 — if we see any duplicates AT ALL, the first
  // delivery was previously emailed and we can short-circuit.
  //
  // Note: this is best-effort dedup. A race between two webhook
  // deliveries of the SAME event id can't occur because Slice 2's
  // ON CONFLICT DO NOTHING wins on stripe_event_id uniqueness.
  const priorCount = await countPriorPaymentFailedForInvoice(
    input.organizationId,
    input.invoiceId,
  );
  if (priorCount > 1) {
    log.info(
      "[dunning-email]",
      "skipping retry payment_failed email (already sent on first attempt)",
      { invoiceId: input.invoiceId, priorCount },
    );
    return;
  }

  // Recipients — org admins.
  const recipients = await db
    .select({ email: users.email, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.organizationId, input.organizationId),
        eq(memberships.role, "admin"),
        eq(memberships.status, "active"),
      ),
    );
  if (recipients.length === 0) {
    log.warn(
      "[dunning-email]",
      "no active admins on org — payment_failed email skipped",
      { organizationId: input.organizationId },
    );
    return;
  }

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);

  const amount = formatMoney(input.amountDueCents, input.currency);
  const nextAttempt = input.nextPaymentAttemptAt
    ? input.nextPaymentAttemptAt.toLocaleDateString("en-US", {
        dateStyle: "medium",
      })
    : "the next scheduled retry";

  for (const r of recipients) {
    try {
      await sendEmail({
        to: r.email,
        subject: `FORGE payment failed — ${amount} for ${org?.name ?? "your organization"}`,
        html: buildHtml({
          orgName: org?.name ?? "Your organization",
          recipientName: r.name ?? null,
          amount,
          nextAttempt,
          attemptCount: input.attemptCount,
          hostedInvoiceUrl: input.hostedInvoiceUrl,
        }),
        text: buildText({
          orgName: org?.name ?? "Your organization",
          amount,
          nextAttempt,
          attemptCount: input.attemptCount,
          hostedInvoiceUrl: input.hostedInvoiceUrl,
        }),
      });
    } catch (err) {
      log.error("[dunning-email]", "send failed", {
        to: r.email,
        error: err instanceof Error ? err.message : String(err),
      });
      // Don't throw — failing to email one admin shouldn't kill the
      // webhook handler. Other admins still get the message.
    }
  }
}

async function countPriorPaymentFailedForInvoice(
  organizationId: string,
  invoiceId: string,
): Promise<number> {
  // JSONB path match on payload->data->object->id. Bounded to org_id +
  // event_type so the existing partial index applies.
  const result = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM "payment_event"
    WHERE "organization_id" = ${organizationId}
      AND "event_type" = 'invoice.payment_failed'
      AND "payload"->'data'->'object'->>'id' = ${invoiceId}
  `);
  const row = (result.rows as { count: string }[])[0];
  return row ? Number(row.count) : 0;
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function buildHtml(args: {
  orgName: string;
  recipientName: string | null;
  amount: string;
  nextAttempt: string;
  attemptCount: number;
  hostedInvoiceUrl: string | null;
}): string {
  const greeting = args.recipientName ? `Hi ${args.recipientName},` : "Hi,";
  const cta = args.hostedInvoiceUrl
    ? `<p style="margin: 20px 0;">
         <a href="${args.hostedInvoiceUrl}"
            style="display:inline-block;background:#2DD4BF;color:#0b1220;padding:10px 18px;border-radius:8px;font-weight:600;text-decoration:none;">
           Update payment method →
         </a>
       </p>`
    : "";
  return /* html */ `
    <p style="margin:0 0 16px 0;">${greeting}</p>
    <p style="margin:0 0 16px 0;">
      A recent FORGE subscription charge of <strong>${args.amount}</strong>
      for <strong>${args.orgName}</strong> didn't go through. Stripe will
      automatically retry on <strong>${args.nextAttempt}</strong>; you don't
      need to do anything if the issue resolves itself (e.g. temporary
      card decline, expired card replaced).
    </p>
    <p style="margin:0 0 16px 0;">
      If you'd like to update your payment method now to avoid any
      service interruption, click below:
    </p>
    ${cta}
    <p style="margin:24px 0 0 0;color:#94a3b8;font-size:12px;">
      This is attempt ${args.attemptCount} of Stripe's retry sequence.
      After all retries are exhausted, your subscription will be
      automatically cancelled and FORGE access will revert to your
      previous tier.
    </p>
  `;
}

function buildText(args: {
  orgName: string;
  amount: string;
  nextAttempt: string;
  attemptCount: number;
  hostedInvoiceUrl: string | null;
}): string {
  const lines = [
    `A FORGE subscription charge of ${args.amount} for ${args.orgName} didn't go through.`,
    `Stripe will retry on ${args.nextAttempt}.`,
    "",
  ];
  if (args.hostedInvoiceUrl) {
    lines.push(
      `To update your payment method now: ${args.hostedInvoiceUrl}`,
      "",
    );
  }
  lines.push(
    `This is attempt ${args.attemptCount} of Stripe's retry sequence. After all retries are exhausted, your subscription will be automatically cancelled.`,
  );
  return lines.join("\n");
}

