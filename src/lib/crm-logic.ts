/**
 * BL-FB-X-CRM — customer relationships, pure parts: the vocabulary of
 * roles and touches, the agency key that ties a contact to an
 * opportunity, the warmth score, and the per-agency rollups the
 * contacts page and the opportunity panel show. No I/O; the server side
 * is `crm.ts`.
 */

export const CONTACT_ROLES = [
  { key: "contracting_officer", label: "Contracting Officer", weight: 1 },
  { key: "cor", label: "COR / COTR", weight: 1 },
  { key: "program_manager", label: "Program Manager", weight: 0.9 },
  { key: "executive", label: "Executive / SES", weight: 0.9 },
  { key: "small_business", label: "Small Business Specialist", weight: 0.8 },
  { key: "technical", label: "Technical lead / SME", weight: 0.7 },
  { key: "other", label: "Other", weight: 0.5 },
] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number]["key"];
export const CONTACT_ROLE_LABELS = Object.fromEntries(CONTACT_ROLES.map((r) => [r.key, r.label])) as Record<ContactRole, string>;

export const TOUCH_KINDS = [
  { key: "meeting", label: "Meeting" },
  { key: "call", label: "Call" },
  { key: "email", label: "Email" },
  { key: "event", label: "Industry day / event" },
  { key: "note", label: "Note" },
] as const;
export type TouchKind = (typeof TOUCH_KINDS)[number]["key"];
export const TOUCH_KIND_LABELS = Object.fromEntries(TOUCH_KINDS.map((k) => [k.key, k.label])) as Record<TouchKind, string>;

export const CONTACT_LIMITS = { name: 120, title: 120, agency: 160, office: 160, email: 200, phone: 40, notes: 4000, summary: 2000 } as const;

export function normalizeRole(raw: unknown): ContactRole {
  return CONTACT_ROLES.some((r) => r.key === raw) ? (raw as ContactRole) : "other";
}

export function normalizeTouchKind(raw: unknown): TouchKind {
  return TOUCH_KINDS.some((k) => k.key === raw) ? (raw as TouchKind) : "note";
}

// Applied after punctuation is stripped, so "U.S." reads "u s" and "Dept." reads "dept".
const AGENCY_PREFIX = /^(?:the |u s |us |united states |department of (?:the )?|dept of (?:the )?|office of (?:the )?)/;

/**
 * "Department of the Navy" → "navy"; "U.S. Dept. of Energy (DOE)" →
 * "energy doe". Lower-case, punctuation out, generic prefixes off, so
 * the same agency typed three ways lands on one key.
 */
export function agencyKey(agency: string): string {
  let key = agency.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 4; i++) {
    const next = key.replace(AGENCY_PREFIX, "");
    if (next === key) break;
    key = next;
  }
  return key;
}

/** Same key, or one key inside the other when both are more than a word fragment. */
export function matchesAgency(a: string, b: string): boolean {
  const ka = agencyKey(a);
  const kb = agencyKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  return ka.length >= 4 && kb.length >= 4 && (ka.includes(kb) || kb.includes(ka));
}

export const WARMTH_THRESHOLDS = { hot: 70, warm: 40, cool: 15 } as const;
export type WarmthLabel = "hot" | "warm" | "cool" | "cold";

const DAY_MS = 86_400_000;
const toDate = (v: Date | string | null | undefined): Date | null => (v ? (v instanceof Date ? v : new Date(v)) : null);

/**
 * 0–100: how live the relationship is. Recency of the last touch counts
 * most (within a month: 60; a quarter: 45; half a year: 30; a year: 15;
 * older: 5), frequency adds up to 30 (five points a touch, six touches),
 * and the role scales the total (a contracting officer we meet monthly
 * is hot; an unknown "other" contact with the same history is warm).
 */
export function warmthScore(input: { lastTouchAt: Date | string | null | undefined; touchCount: number; role: ContactRole; now?: Date }): number {
  const last = toDate(input.lastTouchAt);
  const now = input.now ?? new Date();
  let recency = 0;
  if (last) {
    const days = Math.max(0, (now.getTime() - last.getTime()) / DAY_MS);
    recency = days <= 30 ? 60 : days <= 90 ? 45 : days <= 180 ? 30 : days <= 365 ? 15 : 5;
  }
  const frequency = Math.min(Math.max(0, input.touchCount), 6) * 5;
  const weight = CONTACT_ROLES.find((r) => r.key === input.role)?.weight ?? 0.5;
  return Math.min(100, Math.round((recency + frequency) * (0.6 + 0.4 * weight)));
}

export function warmthLabel(score: number): WarmthLabel {
  return score >= WARMTH_THRESHOLDS.hot ? "hot" : score >= WARMTH_THRESHOLDS.warm ? "warm" : score >= WARMTH_THRESHOLDS.cool ? "cool" : "cold";
}

export type NextTouchState = "none" | "overdue" | "due_soon" | "scheduled";

/** Where the agreed follow-up stands; "due soon" is within a week. */
export function nextTouchStatus(nextTouchAt: Date | string | null | undefined, now: Date = new Date()): { state: NextTouchState; days: number | null } {
  const next = toDate(nextTouchAt);
  if (!next) return { state: "none", days: null };
  const days = Math.ceil((next.getTime() - now.getTime()) / DAY_MS);
  return { state: days < 0 ? "overdue" : days <= 7 ? "due_soon" : "scheduled", days };
}

/** "No contact yet" / "Today" / "12 days ago" / "3 months ago" / "2 years ago". */
export function describeRecency(lastTouchAt: Date | string | null | undefined, now: Date = new Date()): string {
  const last = toDate(lastTouchAt);
  if (!last) return "No contact yet";
  const days = Math.floor((now.getTime() - last.getTime()) / DAY_MS);
  if (days <= 0) return "Today";
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 730) {
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

export type ContactLike = {
  id: string;
  agency: string;
  agencyKey: string;
  name: string;
  role: ContactRole;
  lastTouchAt: Date | string | null;
  nextTouchAt: Date | string | null;
  touchCount: number;
};

export type AgencyRollup = {
  agency: string;
  agencyKey: string;
  contacts: number;
  warmest: number;
  lastTouchAt: Date | null;
  overdue: number;
  dueSoon: number;
};

/** One row per agency, warmest first: how many people we know, how warm, when we last spoke, follow-ups owed. */
export function agencyRollups(contacts: readonly ContactLike[], now: Date = new Date()): AgencyRollup[] {
  const map = new Map<string, AgencyRollup>();
  for (const c of contacts) {
    const key = c.agencyKey || agencyKey(c.agency) || "unassigned";
    let r = map.get(key);
    if (!r) {
      r = { agency: c.agency || "No agency", agencyKey: key, contacts: 0, warmest: 0, lastTouchAt: null, overdue: 0, dueSoon: 0 };
      map.set(key, r);
    }
    r.contacts += 1;
    r.warmest = Math.max(r.warmest, warmthScore({ lastTouchAt: c.lastTouchAt, touchCount: c.touchCount, role: c.role, now }));
    const last = toDate(c.lastTouchAt);
    if (last && (!r.lastTouchAt || last > r.lastTouchAt)) r.lastTouchAt = last;
    const next = nextTouchStatus(c.nextTouchAt, now).state;
    if (next === "overdue") r.overdue += 1;
    if (next === "due_soon") r.dueSoon += 1;
  }
  return Array.from(map.values()).sort((a, b) => b.warmest - a.warmest || a.agency.localeCompare(b.agency));
}

/** The people we know at an opportunity's agency, warmest first. */
export function contactsForAgency<T extends ContactLike>(contacts: readonly T[], oppAgency: string, now: Date = new Date()): T[] {
  if (!agencyKey(oppAgency)) return [];
  return contacts
    .filter((c) => matchesAgency(c.agencyKey || c.agency, oppAgency))
    .sort((a, b) => warmthScore({ lastTouchAt: b.lastTouchAt, touchCount: b.touchCount, role: b.role, now }) - warmthScore({ lastTouchAt: a.lastTouchAt, touchCount: a.touchCount, role: a.role, now }) || a.name.localeCompare(b.name));
}

// ── Slice 2 — procurement history and follow-up reminders ───────────

export type AwardLike = {
  recipientName: string;
  amount: number;
  naicsCode: string;
  endDate: string | null;
  awardingSubAgency: string;
};

export type AgencyAwardsSummary = {
  awards: number;
  totalObligated: number;
  topRecipients: { name: string; amount: number; awards: number }[];
  naicsMix: { code: string; amount: number }[];
  /** Awards whose period of performance ends within the next 12 months. */
  endingWithinYear: number;
  latestEndDate: string | null;
  subAgencies: string[];
};

/** What an agency has been buying, in one glance: who wins, in which NAICS, what ends soon. */
export function summarizeAgencyAwards(awards: readonly AwardLike[], now: Date = new Date()): AgencyAwardsSummary {
  const recipients = new Map<string, { amount: number; awards: number }>();
  const naics = new Map<string, number>();
  const subs = new Map<string, number>();
  let total = 0;
  let endingSoon = 0;
  let latest: string | null = null;
  const horizon = new Date(now.getTime() + 365 * DAY_MS).toISOString().slice(0, 10);
  const todayIso = now.toISOString().slice(0, 10);
  for (const a of awards) {
    const amount = Number.isFinite(a.amount) ? a.amount : 0;
    total += amount;
    const name = a.recipientName.trim() || "Unknown recipient";
    const r = recipients.get(name) ?? { amount: 0, awards: 0 };
    r.amount += amount;
    r.awards += 1;
    recipients.set(name, r);
    if (a.naicsCode) naics.set(a.naicsCode, (naics.get(a.naicsCode) ?? 0) + amount);
    if (a.awardingSubAgency.trim()) subs.set(a.awardingSubAgency.trim(), (subs.get(a.awardingSubAgency.trim()) ?? 0) + 1);
    if (a.endDate) {
      if (a.endDate >= todayIso && a.endDate <= horizon) endingSoon += 1;
      if (!latest || a.endDate > latest) latest = a.endDate;
    }
  }
  return {
    awards: awards.length,
    totalObligated: Math.round(total),
    topRecipients: Array.from(recipients.entries())
      .map(([name, v]) => ({ name, amount: Math.round(v.amount), awards: v.awards }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5),
    naicsMix: Array.from(naics.entries())
      .map(([code, amount]) => ({ code, amount: Math.round(amount) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5),
    endingWithinYear: endingSoon,
    latestEndDate: latest,
    subAgencies: Array.from(subs.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([s]) => s),
  };
}

export type AgencyAwardAttempt = { awardingAgencyName?: string; awardingSubAgencyName?: string; naicsCodes?: string[] };

/**
 * How to ask USAspending about an agency we only know by name: as a
 * sub-tier (most agency strings are, "Department of the Navy"), then as
 * a top-tier department, then without our NAICS filter so an agency we
 * have never sold to still shows what it buys. Stop at the first hit.
 */
export function agencyAwardAttempts(agency: string, naicsCodes: readonly string[]): AgencyAwardAttempt[] {
  const name = agency.trim();
  if (!name) return [];
  const codes = naicsCodes.map((c) => c.trim()).filter(Boolean);
  const attempts: AgencyAwardAttempt[] = [];
  if (codes.length) {
    attempts.push({ awardingSubAgencyName: name, naicsCodes: codes }, { awardingAgencyName: name, naicsCodes: codes });
  }
  attempts.push({ awardingSubAgencyName: name }, { awardingAgencyName: name });
  return attempts;
}

export const TOUCH_REMINDER_HORIZON_MS = DAY_MS;

/** A reminder is owed once per agreed date: within a day of it or past it, and not already sent for that date. */
export function touchReminderDue(now: Date, nextTouchAt: Date | null | undefined, reminderFor: Date | null | undefined): boolean {
  if (!nextTouchAt) return false;
  if (reminderFor && reminderFor.getTime() === nextTouchAt.getTime()) return false;
  return nextTouchAt.getTime() - now.getTime() <= TOUCH_REMINDER_HORIZON_MS;
}

export function touchReminderSubject(contactName: string, agency: string, nextTouchAt: Date, now: Date): string {
  const overdue = nextTouchAt.getTime() < now.getTime();
  return `Follow-up with ${contactName}${agency ? ` (${agency})` : ""} ${overdue ? "is overdue" : "is due tomorrow"}`;
}
