/**
 * BL-AIP-7b part ii — "PWin movers", pure parts.
 *
 * The nightly cron freezes the calibrated PWin of every live
 * opportunity whenever it changes (and weekly as a baseline). A mover is
 * an opportunity whose estimate moved by at least `minDelta` points
 * between its oldest snapshot inside the window and its latest one,
 * with the factor changes that explain the move. Unit-tested.
 */

export type MoverFactor = { key: string; label: string; logOdds: number; detail: string };

export type MoverSnapshot = {
  opportunityId: string;
  pwin: number;
  confidence: string;
  factors: MoverFactor[];
  createdAt: Date;
};

export type PwinMover = {
  opportunityId: string;
  from: number;
  to: number;
  /** to − from, in PWin points. */
  delta: number;
  /** Days between the two snapshots. */
  days: number;
  confidence: string;
  /** Up to two factor changes, largest first, e.g. "▲ Evaluation: strategic fit 4/5". */
  reasons: string[];
};

export type MoverOptions = {
  now: Date;
  /** How far back the baseline may be. */
  windowDays?: number;
  /** Smallest move that counts, in PWin points. */
  minDelta?: number;
  /** Smallest factor change (log-odds) worth naming. */
  minFactorShift?: number;
  limit?: number;
};

const DAY_MS = 24 * 60 * 60_000;

/**
 * Was this snapshot's estimate materially different from the previous
 * one? The nightly cron uses it to skip a row when nothing moved.
 */
export function snapshotChanged(
  prev: { pwin: number; confidence: string; factors: MoverFactor[] } | null,
  next: { pwin: number; confidence: string; factors: MoverFactor[] },
): boolean {
  if (!prev) return true;
  if (prev.pwin !== next.pwin || prev.confidence !== next.confidence) return true;
  return factorSignature(prev.factors) !== factorSignature(next.factors);
}

function factorSignature(factors: MoverFactor[]): string {
  return factors
    .map((f) => `${f.key}=${Math.round(f.logOdds * 100) / 100}`)
    .sort()
    .join("|");
}

/** The factor changes between two snapshots, largest first. */
export function explainMove(
  from: MoverFactor[],
  to: MoverFactor[],
  minFactorShift = 0.15,
  max = 2,
): string[] {
  const before = new Map(from.map((f) => [f.key, f]));
  const after = new Map(to.map((f) => [f.key, f]));
  const keys = new Set([...before.keys(), ...after.keys()]);
  const changes: { shift: number; text: string }[] = [];
  for (const key of keys) {
    const a = before.get(key);
    const b = after.get(key);
    const shift = (b?.logOdds ?? 0) - (a?.logOdds ?? 0);
    if (Math.abs(shift) < minFactorShift) continue;
    const label = (b ?? a)!.label;
    const detail = b ? b.detail : `no longer applies (was: ${a!.detail})`;
    changes.push({ shift, text: `${shift > 0 ? "▲" : "▼"} ${label}: ${detail}`.slice(0, 160) });
  }
  return changes
    .sort((x, y) => Math.abs(y.shift) - Math.abs(x.shift))
    .slice(0, max)
    .map((c) => c.text);
}

/**
 * Movers from a set of snapshots (any opportunities, any order). Per
 * opportunity: the latest snapshot against the oldest one inside the
 * window; a single snapshot is not a move. Sorted by the size of the
 * move, largest first.
 */
export function computeMovers(rows: MoverSnapshot[], opts: MoverOptions): PwinMover[] {
  const windowDays = opts.windowDays ?? 7;
  const minDelta = opts.minDelta ?? 5;
  const limit = opts.limit ?? 6;
  const since = opts.now.getTime() - windowDays * DAY_MS;

  const byOpp = new Map<string, MoverSnapshot[]>();
  for (const r of rows) {
    if (r.createdAt.getTime() < since) continue;
    const list = byOpp.get(r.opportunityId) ?? [];
    list.push(r);
    byOpp.set(r.opportunityId, list);
  }

  const movers: PwinMover[] = [];
  for (const [opportunityId, list] of byOpp) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const delta = last.pwin - first.pwin;
    if (Math.abs(delta) < minDelta) continue;
    movers.push({
      opportunityId,
      from: first.pwin,
      to: last.pwin,
      delta,
      days: Math.max(1, Math.round((last.createdAt.getTime() - first.createdAt.getTime()) / DAY_MS)),
      confidence: last.confidence,
      reasons: explainMove(first.factors, last.factors, opts.minFactorShift),
    });
  }
  return movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, limit);
}
