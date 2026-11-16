import { describe, expect, it } from "vitest";
import { buildIcs, inviteDescription, meetingReminderDue, parseMeetingTime, parseMeetingUrl } from "@/lib/review-meeting-logic";

const base = {
  reviewId: "11111111-2222-3333-4444-555555555555",
  start: new Date("2026-12-01T15:00:00.000Z"),
  summary: "Red Team review: Acme, Inc. bid",
  url: "https://teams.microsoft.com/l/meetup-join/abc",
  sections: ["Technical approach", "Past performance; awards"],
  reviewUrl: "https://forge.test/proposals/p/reviews/r",
  now: new Date("2026-11-20T08:00:00.000Z"),
};

describe("parseMeetingUrl", () => {
  it("accepts any https link and clears on blank", () => {
    expect(parseMeetingUrl("  https://zoom.us/j/123?pwd=x ")).toEqual({ ok: true, url: "https://zoom.us/j/123?pwd=x" });
    expect(parseMeetingUrl("https://example.webex.com/meet/lead").ok).toBe(true);
    expect(parseMeetingUrl("")).toEqual({ ok: true, url: null });
    expect(parseMeetingUrl(null)).toEqual({ ok: true, url: null });
  });
  it("refuses other schemes, spaces, junk and long links", () => {
    expect(parseMeetingUrl("javascript:alert(1)").ok).toBe(false);
    expect(parseMeetingUrl("ftp://x.test/a").ok).toBe(false);
    expect(parseMeetingUrl("https://a.test/x y").ok).toBe(false);
    expect(parseMeetingUrl("not a url").ok).toBe(false);
    expect(parseMeetingUrl("zoom.us/j/1").ok).toBe(false);
    expect(parseMeetingUrl(`https://a.test/${"x".repeat(500)}`).ok).toBe(false);
  });
});

describe("parseMeetingTime", () => {
  it("parses an instant, clears on blank, refuses garbage", () => {
    expect(parseMeetingTime("2026-12-01T15:00:00.000Z")).toEqual({ ok: true, at: new Date("2026-12-01T15:00:00.000Z") });
    expect(parseMeetingTime("")).toEqual({ ok: true, at: null });
    expect(parseMeetingTime("tomorrow-ish").ok).toBe(false);
  });
});

describe("meetingReminderDue", () => {
  const url = "https://zoom.us/j/1";
  const now = new Date("2026-11-30T08:00:00.000Z");
  it("is due the day before, and today, once", () => {
    expect(meetingReminderDue(now, new Date("2026-12-01T09:00:00Z"), url, null)).toBe(true);
    expect(meetingReminderDue(now, new Date("2026-12-01T23:30:00Z"), url, null)).toBe(true);
    expect(meetingReminderDue(now, new Date("2026-11-30T15:00:00Z"), url, null)).toBe(true);
  });
  it("is not due earlier, after the start, without a link or once sent", () => {
    expect(meetingReminderDue(now, new Date("2026-12-02T00:00:00Z"), url, null)).toBe(false);
    expect(meetingReminderDue(now, new Date("2026-11-30T07:00:00Z"), url, null)).toBe(false);
    expect(meetingReminderDue(now, new Date("2026-12-01T09:00:00Z"), null, null)).toBe(false);
    expect(meetingReminderDue(now, new Date("2026-12-01T09:00:00Z"), url, new Date("2026-11-30T08:00:00Z"))).toBe(false);
    expect(meetingReminderDue(now, null, url, null)).toBe(false);
  });
});

describe("buildIcs", () => {
  const ics = buildIcs(base);
  const unfolded = ics.replace(/\r\n /g, "");
  it("is a CRLF calendar with one event carrying the link and the sections", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.split("\n").every((l) => l === "" || l.endsWith("\r"))).toBe(true);
    expect(unfolded).toContain("DTSTART:20261201T150000Z");
    expect(unfolded).toContain("DTEND:20261201T160000Z");
    expect(unfolded).toContain("UID:review-11111111-2222-3333-4444-555555555555@forge");
    expect(unfolded).toContain("LOCATION:https://teams.microsoft.com/l/meetup-join/abc");
    expect(unfolded).toContain("URL:https://teams.microsoft.com/l/meetup-join/abc");
    expect(unfolded).toContain("Technical approach\; Past performance\; awards");
    expect(unfolded).toContain("SUMMARY:Red Team review: Acme\\, Inc. bid");
  });
  it("says the whole proposal when no sections are scoped, and carries instructions", () => {
    const d = inviteDescription({ ...base, sections: [], instructions: "Score\nevery section" });
    expect(d).toContain("the whole proposal");
    expect(d).toContain("Instructions: Score\nevery section");
  });
  it("folds long lines at 75 octets and a re-send raises the sequence", () => {
    const long = buildIcs({ ...base, sections: Array.from({ length: 40 }, (_, n) => `Section number ${n} é`) });
    for (const line of long.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    const seq = (s: string) => Number(/SEQUENCE:(\d+)/.exec(s)![1]);
    expect(seq(buildIcs({ ...base, now: new Date("2026-11-21T08:00:00Z") }))).toBeGreaterThan(seq(ics));
  });
});
