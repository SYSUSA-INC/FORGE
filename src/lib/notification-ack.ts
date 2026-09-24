/**
 * BL-AIP-3 — when reading the inbox counts as acknowledging deliveries.
 *
 * `notification_delivery.acked_at` drives the SLA cron: an unacked
 * delivery past its rule's SLA is marked breached and escalated. Nothing
 * ever wrote `acked_at`, so every rule with an SLA breached and escalated
 * even after the recipient had read the notification.
 *
 * Inbox rows and delivery rows are not linked by id, so acknowledgement
 * is by time: marking inbox rows read acknowledges this recipient's
 * in-app deliveries sent up to the newest row read, plus a short grace
 * for clock skew between the two inserts. Pure so it is unit-tested.
 */

export const ACK_GRACE_MS = 2 * 60_000;

/**
 * The `sent_at` cutoff up to which deliveries count as acknowledged, or
 * null when no valid timestamps were given.
 */
export function ackCutoff(
  createdAts: ReadonlyArray<Date | string | null | undefined>,
  graceMs: number = ACK_GRACE_MS,
): Date | null {
  let max = Number.NEGATIVE_INFINITY;
  for (const v of createdAts) {
    if (!v) continue;
    const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
    if (Number.isNaN(t)) continue;
    if (t > max) max = t;
  }
  return Number.isFinite(max) ? new Date(max + graceMs) : null;
}
