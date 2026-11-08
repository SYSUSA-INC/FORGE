/**
 * BL-NAV-LIFECYCLE 3c-3 — the daily sweep of expired partner invites.
 *
 * An invite link lives 14 days (`PARTNER_INVITE_DAYS`). Until this sweep
 * ran, an expired link only *read* as expired: its hash stayed on the
 * row, and a partner invited but never answered stayed *invited* on the
 * Partners tab for good. The sweep retires every expired link (token hash
 * cleared; the row stays so the tab can still say "invite to … expired
 * on …") and sends an *invited* partner back to *candidate* when its only
 * links expired unanswered (`planInviteSweep`, pure). One audit row per
 * affected partner, `opportunity.partner.invite.expire`, actor the
 * system.
 *
 * Cross-org by design: a background worker gated by CRON_SECRET, like the
 * other cron libs. Each write is scoped by the row's own organization.
 */
import "server-only";

import { and, asc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { opportunityPartnerInvites, opportunityPartners } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";
import { planInviteSweep, type SweepInvite } from "@/lib/partner-invite-logic";

/** Expired links retired per run; the rest wait for the next day. */
export const INVITE_SWEEP_BATCH = 500;

export type InviteSweepSummary = {
  /** Expired links that still worked when the sweep ran. */
  expired: number;
  /** Links retired (token hash cleared). */
  cleared: number;
  /** Partners sent back to *candidate*. */
  reverted: number;
  organizations: number;
  errors: number;
};

export async function sweepExpiredPartnerInvites(now = new Date()): Promise<InviteSweepSummary> {
  const summary: InviteSweepSummary = { expired: 0, cleared: 0, reverted: 0, organizations: 0, errors: 0 };
  const expired = await db
    .select({
      id: opportunityPartnerInvites.id,
      organizationId: opportunityPartnerInvites.organizationId,
      opportunityId: opportunityPartnerInvites.opportunityId,
      partnerId: opportunityPartnerInvites.partnerId,
      email: opportunityPartnerInvites.email,
      expiresAt: opportunityPartnerInvites.expiresAt,
      submittedAt: opportunityPartnerInvites.submittedAt,
    })
    .from(opportunityPartnerInvites)
    .where(and(lte(opportunityPartnerInvites.expiresAt, now), isNotNull(opportunityPartnerInvites.tokenHash)))
    .orderBy(asc(opportunityPartnerInvites.expiresAt))
    .limit(INVITE_SWEEP_BATCH);
  summary.expired = expired.length;
  if (expired.length === 0) return summary;

  const byOrg = new Map<string, typeof expired>();
  for (const row of expired) byOrg.set(row.organizationId, [...(byOrg.get(row.organizationId) ?? []), row]);
  summary.organizations = byOrg.size;

  for (const [organizationId, rows] of byOrg) {
    try {
      const partnerIds = [...new Set(rows.map((r) => r.partnerId))];
      // Every link of the affected partners, so a partner re-invited since keeps its new link and its status.
      const [invites, partners] = await Promise.all([
        db
          .select({ id: opportunityPartnerInvites.id, partnerId: opportunityPartnerInvites.partnerId, expiresAt: opportunityPartnerInvites.expiresAt, submittedAt: opportunityPartnerInvites.submittedAt, tokenHash: opportunityPartnerInvites.tokenHash })
          .from(opportunityPartnerInvites)
          .where(and(eq(opportunityPartnerInvites.organizationId, organizationId), inArray(opportunityPartnerInvites.partnerId, partnerIds))),
        db
          .select({ id: opportunityPartners.id, status: opportunityPartners.status })
          .from(opportunityPartners)
          .where(and(eq(opportunityPartners.organizationId, organizationId), inArray(opportunityPartners.id, partnerIds))),
      ]);
      const plan = planInviteSweep(invites satisfies SweepInvite[], partners, now);
      if (plan.clear.length > 0) {
        await db
          .update(opportunityPartnerInvites)
          .set({ tokenHash: null })
          .where(and(eq(opportunityPartnerInvites.organizationId, organizationId), inArray(opportunityPartnerInvites.id, plan.clear)));
      }
      if (plan.revert.length > 0) {
        await db
          .update(opportunityPartners)
          .set({ status: "candidate", updatedAt: now })
          .where(and(eq(opportunityPartners.organizationId, organizationId), inArray(opportunityPartners.id, plan.revert), eq(opportunityPartners.status, "invited")));
      }
      const reverted = new Set(plan.revert);
      const cleared = new Set(plan.clear);
      const audited = new Set<string>();
      for (const row of rows) {
        if (!cleared.has(row.id) || audited.has(row.partnerId)) continue;
        audited.add(row.partnerId);
        await recordAudit({
          organizationId,
          actor: { userId: null, email: "system" },
          action: "opportunity.partner.invite.expire",
          resourceType: "opportunity",
          resourceId: row.opportunityId,
          metadata: { partnerId: row.partnerId, email: row.email, expiresAt: row.expiresAt.toISOString(), submitted: row.submittedAt !== null, reverted: reverted.has(row.partnerId) },
        });
      }
      summary.cleared += plan.clear.length;
      summary.reverted += plan.revert.length;
    } catch (err) {
      summary.errors += 1;
      log.error("[partner-invite-cron]", "sweep failed for organization", { organizationId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  log.info("[partner-invite-cron]", "sweep complete", summary);
  return summary;
}
