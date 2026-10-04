/**
 * BL-FB-X-CRM — customer relationships, pure parts: agency keys and
 * matching, warmth, follow-up status, recency wording, rollups.
 */
import { describe, expect, it } from "vitest";
import {
  agencyAwardAttempts,
  contactCsvRow,
  pickAgenciesToRefresh,
  agencyKey,
  agencyRollups,
  contactsForAgency,
  describeRecency,
  matchesAgency,
  nextTouchStatus,
  normalizeRole,
  normalizeTouchKind,
  summarizeAgencyAwards,
  touchReminderDue,
  touchReminderSubject,
  warmthLabel,
  warmthScore,
} from "@/lib/crm-logic";

const NOW = new Date("2026-10-03T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("crm logic", () => {
  it("keys agencies so the same customer typed three ways matches", () => {
    expect(agencyKey("Department of the Navy")).toBe("navy");
    expect(agencyKey("U.S. Dept. of Energy (DOE)")).toBe("energy doe");
    expect(agencyKey("The Office of Personnel Management")).toBe("personnel management");
    expect(agencyKey("  NASA ")).toBe("nasa");
    expect(agencyKey("")).toBe("");
    expect(matchesAgency("Department of the Navy", "Navy")).toBe(true);
    expect(matchesAgency("Department of Energy", "energy")).toBe(true);
    expect(matchesAgency("Navy", "NAVSEA")).toBe(false);
    expect(matchesAgency("Air Force", "Army")).toBe(false);
    expect(matchesAgency("DOE", "Department of Energy")).toBe(false);
    expect(matchesAgency("", "Navy")).toBe(false);
    expect(normalizeRole("cor")).toBe("cor");
    expect(normalizeRole("wizard")).toBe("other");
    expect(normalizeTouchKind("call")).toBe("call");
    expect(normalizeTouchKind(undefined)).toBe("note");
  });

  it("scores warmth from recency, frequency and role", () => {
    expect(warmthScore({ lastTouchAt: daysAgo(10), touchCount: 3, role: "contracting_officer", now: NOW })).toBe(75);
    expect(warmthLabel(75)).toBe("hot");
    expect(warmthScore({ lastTouchAt: daysAgo(10), touchCount: 3, role: "other", now: NOW })).toBe(60);
    expect(warmthLabel(60)).toBe("warm");
    expect(warmthScore({ lastTouchAt: daysAgo(100), touchCount: 2, role: "program_manager", now: NOW })).toBe(38);
    expect(warmthLabel(38)).toBe("cool");
    expect(warmthScore({ lastTouchAt: daysAgo(400), touchCount: 1, role: "cor", now: NOW })).toBe(10);
    expect(warmthLabel(10)).toBe("cold");
    expect(warmthScore({ lastTouchAt: null, touchCount: 0, role: "cor", now: NOW })).toBe(0);
    expect(warmthScore({ lastTouchAt: daysAgo(1).toISOString(), touchCount: 50, role: "cor", now: NOW })).toBe(90);
  });

  it("states where the follow-up stands and how long since we spoke", () => {
    expect(nextTouchStatus(null, NOW)).toEqual({ state: "none", days: null });
    expect(nextTouchStatus(daysAgo(2), NOW)).toEqual({ state: "overdue", days: -2 });
    expect(nextTouchStatus(daysAhead(5), NOW)).toEqual({ state: "due_soon", days: 5 });
    expect(nextTouchStatus(daysAhead(17).toISOString(), NOW)).toEqual({ state: "scheduled", days: 17 });
    expect(describeRecency(null, NOW)).toBe("No contact yet");
    expect(describeRecency(NOW, NOW)).toBe("Today");
    expect(describeRecency(daysAgo(1), NOW)).toBe("1 day ago");
    expect(describeRecency(daysAgo(12), NOW)).toBe("12 days ago");
    expect(describeRecency(daysAgo(100), NOW)).toBe("3 months ago");
    expect(describeRecency(daysAgo(800), NOW)).toBe("2 years ago");
  });

  it("rolls contacts up per agency, warmest first, and finds the people at an opportunity's agency", () => {
    const contacts = [
      { id: "a", agency: "Department of the Navy", agencyKey: "navy", name: "Ana", role: "contracting_officer" as const, lastTouchAt: daysAgo(10), nextTouchAt: daysAgo(1), touchCount: 3 },
      { id: "b", agency: "Department of the Navy", agencyKey: "navy", name: "Bo", role: "technical" as const, lastTouchAt: daysAgo(200), nextTouchAt: daysAhead(3), touchCount: 1 },
      { id: "c", agency: "Army", agencyKey: "army", name: "Cy", role: "other" as const, lastTouchAt: null, nextTouchAt: null, touchCount: 0 },
    ];
    const rollups = agencyRollups(contacts, NOW);
    expect(rollups.map((r) => [r.agency, r.contacts, r.warmest, r.overdue, r.dueSoon])).toEqual([
      ["Department of the Navy", 2, 75, 1, 1],
      ["Army", 1, 0, 0, 0],
    ]);
    expect(rollups[0]!.lastTouchAt?.toISOString()).toBe(daysAgo(10).toISOString());
    expect(contactsForAgency(contacts, "Navy", NOW).map((c) => c.id)).toEqual(["a", "b"]);
    expect(contactsForAgency(contacts, "U.S. Army", NOW).map((c) => c.id)).toEqual(["c"]);
    expect(contactsForAgency(contacts, "", NOW)).toEqual([]);
    expect(contactsForAgency(contacts, "NASA", NOW)).toEqual([]);
  });

  it("summarises an agency's awards: who wins, in which NAICS, what ends soon", () => {
    const awards = [
      { recipientName: "Acme Federal", amount: 5_000_000, naicsCode: "541512", endDate: "2027-03-31", awardingSubAgency: "NAVSEA" },
      { recipientName: "Acme Federal", amount: 1_000_000.4, naicsCode: "541511", endDate: "2026-12-15", awardingSubAgency: "NAVSEA" },
      { recipientName: "Beta LLC", amount: 2_500_000, naicsCode: "541512", endDate: "2028-09-30", awardingSubAgency: "NAVAIR" },
      { recipientName: "  ", amount: Number.NaN, naicsCode: "", endDate: null, awardingSubAgency: " " },
    ];
    const s = summarizeAgencyAwards(awards, NOW);
    expect(s.awards).toBe(4);
    expect(s.totalObligated).toBe(8_500_000);
    expect(s.topRecipients).toEqual([
      { name: "Acme Federal", amount: 6_000_000, awards: 2 },
      { name: "Beta LLC", amount: 2_500_000, awards: 1 },
      { name: "Unknown recipient", amount: 0, awards: 1 },
    ]);
    expect(s.naicsMix).toEqual([
      { code: "541512", amount: 7_500_000 },
      { code: "541511", amount: 1_000_000 },
    ]);
    expect(s.endingWithinYear).toBe(2);
    expect(s.latestEndDate).toBe("2028-09-30");
    expect(s.subAgencies).toEqual(["NAVSEA", "NAVAIR"]);
    expect(summarizeAgencyAwards([], NOW)).toMatchObject({ awards: 0, totalObligated: 0, topRecipients: [], naicsMix: [], endingWithinYear: 0, latestEndDate: null, subAgencies: [] });
  });

  it("asks USAspending about an agency as sub-tier then department, our NAICS first", () => {
    expect(agencyAwardAttempts(" Department of the Navy ", ["541512", " ", "541511"])).toEqual([
      { awardingSubAgencyName: "Department of the Navy", naicsCodes: ["541512", "541511"] },
      { awardingAgencyName: "Department of the Navy", naicsCodes: ["541512", "541511"] },
      { awardingSubAgencyName: "Department of the Navy" },
      { awardingAgencyName: "Department of the Navy" },
    ]);
    expect(agencyAwardAttempts("NASA", [])).toEqual([{ awardingSubAgencyName: "NASA" }, { awardingAgencyName: "NASA" }]);
    expect(agencyAwardAttempts("  ", ["541512"])).toEqual([]);
  });

  it("owes one follow-up reminder per agreed date", () => {
    const tomorrow = new Date(NOW.getTime() + 20 * 3_600_000);
    expect(touchReminderDue(NOW, null, null)).toBe(false);
    expect(touchReminderDue(NOW, daysAhead(3), null)).toBe(false);
    expect(touchReminderDue(NOW, tomorrow, null)).toBe(true);
    expect(touchReminderDue(NOW, daysAgo(2), null)).toBe(true);
    expect(touchReminderDue(NOW, tomorrow, tomorrow)).toBe(false);
    // A new agreed date re-arms the reminder even though an older one was sent.
    expect(touchReminderDue(NOW, tomorrow, daysAgo(10))).toBe(true);
    expect(touchReminderSubject("Ana Rivera", "Navy", tomorrow, NOW)).toBe("Follow-up with Ana Rivera (Navy) is due tomorrow");
    expect(touchReminderSubject("Ana Rivera", "", daysAgo(2), NOW)).toBe("Follow-up with Ana Rivera is overdue");
  });
});

describe("Slice 4 — nightly refresh and export", () => {
  const NOW = new Date("2026-10-04T05:00:00Z");
  const H = 3_600_000;
  const w = (organizationId: string, agencyKey: string) => ({ organizationId, agencyKey, agency: agencyKey.toUpperCase() });

  it("refreshes never-fetched agencies first, then the stalest, skipping fresh ones and duplicates", () => {
    const watched = [w("a", "navy"), w("a", "navy"), w("a", "gsa"), w("b", "nasa"), w("b", "army"), w("a", "")];
    const cached = [
      { organizationId: "a", agencyKey: "gsa", fetchedAt: new Date(NOW.getTime() - 2 * H) },
      { organizationId: "b", agencyKey: "nasa", fetchedAt: new Date(NOW.getTime() - 30 * H) },
      { organizationId: "b", agencyKey: "army", fetchedAt: new Date(NOW.getTime() - 50 * H) },
      { organizationId: "b", agencyKey: "navy", fetchedAt: new Date(NOW.getTime() - 99 * H) },
    ];
    const picked = pickAgenciesToRefresh(watched, cached, NOW, { limit: 10, freshMs: 22 * H });
    expect(picked.map((p) => `${p.organizationId}/${p.agencyKey}`)).toEqual(["a/navy", "b/army", "b/nasa"]);
    expect(pickAgenciesToRefresh(watched, cached, NOW, { limit: 1, freshMs: 22 * H })).toHaveLength(1);
  });

  it("writes a contact as the row the list shows, with warmth and follow-up", () => {
    const row = contactCsvRow(
      {
        name: "Dana Ortiz",
        title: "Contracting Officer",
        role: "contracting_officer",
        agency: "GSA",
        office: "FAS",
        email: "dana@gsa.gov",
        phone: "",
        ownerName: null,
        lastTouchAt: "2026-09-30T12:00:00.000Z",
        nextTouchAt: "2026-10-01T12:00:00.000Z",
        touchCount: 3,
      },
      NOW,
    );
    expect(row).toMatchObject({ Name: "Dana Ortiz", Agency: "GSA", Owner: "", "Last touch": "2026-09-30", "Next touch": "2026-10-01", "Follow-up": "overdue", Touches: 3 });
    expect(typeof row.Warmth).toBe("number");
    expect(Object.keys(row)).toEqual(["Name", "Title", "Role", "Agency", "Office", "Email", "Phone", "Owner", "Last touch", "Touches", "Warmth", "Next touch", "Follow-up"]);
  });
});
