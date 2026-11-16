/**
 * BL-NAV-LIFECYCLE 5c — a review round's meeting, pure. The lead pastes a
 * link from their own calendar (Teams, Zoom, Webex: any https URL; FORGE
 * creates no meeting) and sets a start time. This file validates both,
 * builds the `.ics` invite that carries the link and the sections in
 * scope, and decides when the day-before reminder is due. No I/O.
 */

export const MEETING_URL_MAX = 500;
/** The invite has no end-time field: every meeting is held for an hour. */
export const MEETING_MINUTES = 60;

export type MeetingUrlResult = { ok: true; url: string | null } | { ok: false; error: string };

/** A pasted link: blank clears it; otherwise an http(s) URL with no spaces. */
export function parseMeetingUrl(raw: string | null | undefined): MeetingUrlResult {
  const text = (raw ?? "").trim();
  if (!text) return { ok: true, url: null };
  if (text.length > MEETING_URL_MAX) return { ok: false, error: `The meeting link must be ${MEETING_URL_MAX} characters or fewer.` };
  if (/\s/.test(text)) return { ok: false, error: "The meeting link must be one URL, with no spaces." };
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, error: "That does not look like a link. Paste the full address, starting with https://." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "The meeting link must start with https:// (or http://)." };
  }
  return { ok: true, url: parsed.toString() };
}

export type MeetingTimeResult = { ok: true; at: Date | null } | { ok: false; error: string };

/** An ISO instant from the browser: blank clears it. */
export function parseMeetingTime(raw: string | null | undefined): MeetingTimeResult {
  const text = (raw ?? "").trim();
  if (!text) return { ok: true, at: null };
  const at = new Date(text);
  if (Number.isNaN(at.getTime())) return { ok: false, error: "That meeting time is not a valid date and time." };
  return { ok: true, at };
}

/**
 * The day-before reminder: due once the meeting falls today or tomorrow
 * (UTC), it has not started, a link is set and no reminder has gone. The
 * daily cron runs at 08:00 UTC, so a meeting tomorrow is reminded today.
 */
export function meetingReminderDue(now: Date, meetingAt: Date | null, meetingUrl: string | null, sentAt: Date | null): boolean {
  if (!meetingAt || !meetingUrl || sentAt) return false;
  if (meetingAt.getTime() <= now.getTime()) return false;
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const endOfTomorrow = dayStart + 2 * 24 * 60 * 60 * 1000;
  return meetingAt.getTime() < endOfTomorrow;
}

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 §3.1: lines fold at 75 octets; the continuation starts with one space. */
function icsFold(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, "utf8");
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.map((l, i) => (i === 0 ? l : ` ${l}`));
}

export type ReviewInvite = {
  reviewId: string;
  start: Date;
  /** "Red Team review: <proposal title>". */
  summary: string;
  url: string;
  /** Titles of the sections this reviewer is scoped to; empty = the whole proposal. */
  sections: string[];
  /** The lead's charge to the reviewers, if any. */
  instructions?: string;
  /** The link back into FORGE. */
  reviewUrl: string;
  now: Date;
};

/** The invite text shared by the `.ics` description and the email. */
export function inviteDescription(i: Pick<ReviewInvite, "url" | "sections" | "instructions" | "reviewUrl">): string {
  const scope = i.sections.length > 0 ? `Sections in scope: ${i.sections.join("; ")}.` : "Sections in scope: the whole proposal.";
  const lines = [`Join: ${i.url}`, scope];
  const charge = (i.instructions ?? "").trim();
  if (charge) lines.push(`Instructions: ${charge}`);
  lines.push(`Review in FORGE: ${i.reviewUrl}`);
  return lines.join("\n");
}

/**
 * One calendar event. The uid is stable per round, and the sequence rises
 * with each send, so a re-sent invite (a moved time) updates the earlier
 * one in the reviewer's calendar instead of adding a second.
 */
export function buildIcs(i: ReviewInvite): string {
  const end = new Date(i.start.getTime() + MEETING_MINUTES * 60 * 1000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FORGE//Review meeting//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:review-${i.reviewId}@forge`,
    `SEQUENCE:${Math.floor(i.now.getTime() / 60000)}`,
    `DTSTAMP:${icsStamp(i.now)}`,
    `DTSTART:${icsStamp(i.start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(i.summary)}`,
    `DESCRIPTION:${icsEscape(inviteDescription(i))}`,
    `LOCATION:${icsEscape(i.url)}`,
    `URL:${i.url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.flatMap(icsFold).join("\r\n") + "\r\n";
}
