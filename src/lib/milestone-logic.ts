/**
 * BL-NAV-LIFECYCLE 4b-1 — the schedule's pure rules: the milestone kinds
 * and statuses, the count-back that proposes a schedule from the due date
 * (the owner's decision 4: submit T-2, White Gloves T-4, Gold T-10,
 * Red T-20, Pink T-30, kick-off at once), the state the Plan reads, and
 * the wording of the milestone_due_soon reminder. No database access;
 * tested in tests/ai/milestone-logic.test.ts.
 */
import type { MilestoneKind, MilestoneStatus } from "@/db/schema";

export const MILESTONE_KINDS: MilestoneKind[] = [
  "kick_off",
  "outline_frozen",
  "pink_team",
  "red_team",
  "gold_team",
  "white_gloves",
  "pricing_complete",
  "final_production",
  "submit",
  "other",
];

export const MILESTONE_KIND_LABELS: Record<MilestoneKind, string> = {
  kick_off: "Kick-off",
  outline_frozen: "Outline frozen",
  pink_team: "Pink team",
  red_team: "Red team",
  gold_team: "Gold team",
  white_gloves: "White Gloves",
  pricing_complete: "Pricing complete",
  final_production: "Final production",
  submit: "Submit",
  other: "Other",
};

export const MILESTONE_STATUSES: MilestoneStatus[] = ["planned", "done", "missed"];
export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  planned: "Planned",
  done: "Done",
  missed: "Missed",
};

/** Days before the response is due, per milestone the count-back proposes (decision 4). */
export const COUNT_BACK_DAYS: Partial<Record<MilestoneKind, number>> = {
  submit: 2,
  white_gloves: 4,
  gold_team: 10,
  red_team: 20,
  pink_team: 30,
};

/** The order a proposed schedule is listed in: kick-off first, then the count-back by date. */
export const PROPOSED_KINDS: MilestoneKind[] = ["kick_off", "pink_team", "red_team", "gold_team", "white_gloves", "submit"];

/** The colour-team milestones: their owner defaults to nobody, the reviewers are on the plan's colour team. */
export const COLOR_TEAM_KINDS: MilestoneKind[] = ["pink_team", "red_team", "gold_team", "white_gloves"];

/** The key the due date hangs on when it is the opportunity's response due date rather than a solicitation key date. */
export const RESPONSE_DUE_ANCHOR = "response_due";

export function isMilestoneKind(v: string): v is MilestoneKind {
  return (MILESTONE_KINDS as string[]).includes(v);
}
export function isMilestoneStatus(v: string): v is MilestoneStatus {
  return (MILESTONE_STATUSES as string[]).includes(v);
}
/** A YYYY-MM-DD day that exists. */
export function isIsoDay(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** A Date, or a timestamp, as its UTC day. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from one day to another; negative when `to` is earlier. */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / 86_400_000);
}

export type KeyDateLike = { label: string; isoDate: string; type: string };

export type ProposedMilestone = {
  kind: MilestoneKind;
  title: string;
  date: string;
  anchorKey: string | null;
  /** Set when the count-back landed before today and the milestone was moved to today. */
  clamped: boolean;
};

/**
 * The due date a schedule counts back from: the opportunity's response due
 * date, or failing that the solicitation's proposal_due key date.
 */
export function scheduleAnchor(input: { responseDueIso: string | null; keyDates: KeyDateLike[] }): { iso: string; key: string } | null {
  if (input.responseDueIso) return { iso: input.responseDueIso, key: RESPONSE_DUE_ANCHOR };
  const due = input.keyDates.find((k) => k.type === "proposal_due" && isIsoDay(k.isoDate));
  return due ? { iso: due.isoDate, key: "proposal_due" } : null;
}

/**
 * Build the schedule: the kick-off today and the count-back from the due
 * date. A milestone that would fall before today is moved to today and
 * marked clamped, so a late start still gets every round; a kind already
 * on the plan is left out, so building twice adds only what is missing.
 */
export function proposeSchedule(input: { todayIso: string; responseDueIso: string | null; keyDates: KeyDateLike[]; existingKinds?: MilestoneKind[] }): ProposedMilestone[] {
  const have = new Set(input.existingKinds ?? []);
  const anchor = scheduleAnchor(input);
  const out: ProposedMilestone[] = [];
  for (const kind of PROPOSED_KINDS) {
    if (have.has(kind)) continue;
    if (kind === "kick_off") {
      out.push({ kind, title: MILESTONE_KIND_LABELS.kick_off, date: input.todayIso, anchorKey: null, clamped: false });
      continue;
    }
    if (!anchor) continue;
    const back = COUNT_BACK_DAYS[kind] ?? 0;
    const proposed = addDays(anchor.iso, -back);
    const clamped = daysBetween(input.todayIso, proposed) < 0;
    out.push({ kind, title: MILESTONE_KIND_LABELS[kind], date: clamped ? input.todayIso : proposed, anchorKey: anchor.key, clamped });
  }
  return out.sort((a, b) => (a.date === b.date ? PROPOSED_KINDS.indexOf(a.kind) - PROPOSED_KINDS.indexOf(b.kind) : a.date.localeCompare(b.date)));
}

export type MilestoneLike = { kind: MilestoneKind; date: string; status: MilestoneStatus };

export type ScheduleState = {
  total: number;
  planned: number;
  done: number;
  missed: number;
  /** Planned milestones whose day has passed. */
  overdue: number;
  /** The next planned milestone's day, or null. */
  nextDate: string | null;
};

export function scheduleState(rows: MilestoneLike[], todayIso: string): ScheduleState {
  const planned = rows.filter((r) => r.status === "planned");
  const upcoming = planned.filter((r) => daysBetween(todayIso, r.date) >= 0).map((r) => r.date).sort();
  return {
    total: rows.length,
    planned: planned.length,
    done: rows.filter((r) => r.status === "done").length,
    missed: rows.filter((r) => r.status === "missed").length,
    overdue: planned.length - upcoming.length,
    nextDate: upcoming[0] ?? null,
  };
}

export const MILESTONE_HORIZONS = [1, 3, 7] as const;
export type MilestoneHorizon = (typeof MILESTONE_HORIZONS)[number];

/** The reminder horizon that applies today to a planned milestone, or null. */
export function milestoneHorizon(todayIso: string, dateIso: string): MilestoneHorizon | null {
  const d = daysBetween(todayIso, dateIso);
  return (MILESTONE_HORIZONS as readonly number[]).includes(d) ? (d as MilestoneHorizon) : null;
}

/** Subject and body of the milestone_due_soon reminder. */
export function milestoneDueSoonMessage(input: { horizon: MilestoneHorizon; title: string; dateIso: string; opportunityTitle: string }): { subject: string; body: string } {
  const when = input.horizon === 1 ? "tomorrow" : `in ${input.horizon} days`;
  const opp = input.opportunityTitle || "an opportunity";
  return {
    subject: `[T-${input.horizon}] ${input.title.slice(0, 80)} — ${opp.slice(0, 80)}`,
    body: `The ${input.title} milestone on the plan for ${opp} is ${when} (${input.dateIso}).`,
  };
}

// ---------------------------------------------------------------------------
// BL-NAV-LIFECYCLE 4b-2 — the schedule drawn as a timeline (design §2.6).
// ---------------------------------------------------------------------------

export type TimelineBar = {
  id: string;
  label: string;
  kind: MilestoneKind;
  status: MilestoneStatus;
  date: string;
  /** The stretch of work that ends at this milestone: from the one before it (or the start) to its day. */
  startPct: number;
  endPct: number;
  /** Planned and past its day. */
  overdue: boolean;
};

export type TimelineMark = { label: string; iso: string; pct: number; kind: "due" | "key_date" | "parts" };

export type TimelineLayout = {
  /** The earliest day drawn: today, or the earliest milestone or part if earlier. */
  startIso: string;
  /** The last day drawn: the due date the schedule hangs on, else the latest milestone or part. */
  endIso: string;
  days: number;
  /** Where today falls, or null when today is outside the span. */
  todayPct: number | null;
  bars: TimelineBar[];
  marks: TimelineMark[];
};

export type TimelineMilestone = MilestoneLike & { id: string; title: string };

const MIN_BAR_PCT = 1.5;

/**
 * Positions for the timeline, as percentages of the span from the
 * earliest date to the due date. Milestones become bars, each running
 * from the milestone before it to its own day, so the rounds read as the
 * stretches of work they close; the key dates and the parts' due dates
 * are marks on the axis; today is the marker. Null when there is nothing
 * to draw.
 */
export function timelineLayout(input: { todayIso: string; anchor: { iso: string; key: string } | null; keyDates: KeyDateLike[]; milestones: TimelineMilestone[]; partDueDates?: string[] }): TimelineLayout | null {
  const parts = (input.partDueDates ?? []).filter(isIsoDay);
  if (input.milestones.length === 0 && !input.anchor && parts.length === 0) return null;
  const dated = [...input.milestones.map((m) => m.date), ...parts];
  const startIso = [input.todayIso, ...dated].sort()[0];
  const endCandidate = input.anchor?.iso ?? [...dated].sort().slice(-1)[0] ?? input.todayIso;
  const endIso = endCandidate < startIso ? startIso : endCandidate;
  const days = Math.max(1, daysBetween(startIso, endIso));
  const pct = (iso: string) => Math.min(100, Math.max(0, (daysBetween(startIso, iso) / days) * 100));
  const inSpan = (iso: string) => iso >= startIso && iso <= endIso;

  const sorted = [...input.milestones].sort((a, b) => (a.date === b.date ? PROPOSED_KINDS.indexOf(a.kind) - PROPOSED_KINDS.indexOf(b.kind) : a.date.localeCompare(b.date)));
  let cursor = 0;
  const bars: TimelineBar[] = sorted.map((m) => {
    const startPct = cursor;
    const endPct = Math.min(100, Math.max(pct(m.date), startPct + MIN_BAR_PCT));
    cursor = Math.min(pct(m.date), 100 - MIN_BAR_PCT);
    return { id: m.id, label: m.title, kind: m.kind, status: m.status, date: m.date, startPct, endPct, overdue: m.status === "planned" && daysBetween(input.todayIso, m.date) < 0 };
  });

  const marks: TimelineMark[] = [];
  if (input.anchor) marks.push({ label: input.anchor.key === RESPONSE_DUE_ANCHOR ? "Response due" : "Proposal due", iso: input.anchor.iso, pct: pct(input.anchor.iso), kind: "due" });
  for (const k of input.keyDates) {
    if (!isIsoDay(k.isoDate) || !inSpan(k.isoDate) || k.isoDate === input.anchor?.iso) continue;
    marks.push({ label: k.label, iso: k.isoDate, pct: pct(k.isoDate), kind: "key_date" });
  }
  const byDay = new Map<string, number>();
  for (const p of parts) if (inSpan(p)) byDay.set(p, (byDay.get(p) ?? 0) + 1);
  for (const [iso, n] of byDay) marks.push({ label: `${n} ${n === 1 ? "part" : "parts"} due`, iso, pct: pct(iso), kind: "parts" });
  marks.sort((a, b) => a.iso.localeCompare(b.iso));

  return { startIso, endIso, days, todayPct: inSpan(input.todayIso) ? pct(input.todayIso) : null, bars, marks };
}
