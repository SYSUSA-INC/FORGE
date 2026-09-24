/**
 * BL-AIP-3 — which opportunities are "due soon" today.
 *
 * `opportunity_due_soon` was the notification editor's default trigger
 * and had no emitter. The daily cron now fires it at T-7, T-3 and T-1
 * before an open opportunity's response due date. Pure date math here,
 * unit-tested; the scan and dispatch live in opportunity-due-soon-cron.ts.
 */

export const DUE_SOON_HORIZONS = [1, 3, 7] as const;
export type DueSoonHorizon = (typeof DUE_SOON_HORIZONS)[number];

/** Whole UTC days from `todayIsoDate` (YYYY-MM-DD) to `target`. */
export function daysUntil(todayIsoDate: string, target: Date): number {
  const todayMs = new Date(`${todayIsoDate}T00:00:00Z`).getTime();
  const targetDay = target.toISOString().slice(0, 10);
  const targetMs = new Date(`${targetDay}T00:00:00Z`).getTime();
  return Math.round((targetMs - todayMs) / 86_400_000);
}

/** The reminder horizon that applies today, or null. */
export function dueSoonHorizon(
  todayIsoDate: string,
  dueDate: Date | null | undefined,
): DueSoonHorizon | null {
  if (!dueDate || Number.isNaN(dueDate.getTime())) return null;
  const d = daysUntil(todayIsoDate, dueDate);
  return (DUE_SOON_HORIZONS as readonly number[]).includes(d) ? (d as DueSoonHorizon) : null;
}

export function dueSoonSubject(horizon: DueSoonHorizon, title: string, dueIsoDate: string): string {
  return `[T-${horizon}] ${title.slice(0, 80)} — response due ${dueIsoDate}`;
}

export function dueSoonBody(horizon: DueSoonHorizon, title: string, dueIsoDate: string): string {
  const when = horizon === 1 ? "tomorrow" : `in ${horizon} days`;
  return `The response for "${title}" is due ${when} (${dueIsoDate}).`;
}
