/**
 * BL-STAB-10d — the owner's scout (Postgres, SAM.gov stubbed): keywords
 * "Enterprise IT modernization, ServiceNow, Digital Transformation", the
 * Scout page's codes and the organization's own. A find must be in one of
 * the codes AND mention a keyword; the Scout page's codes are searched
 * first; waiting finds that no longer fit are cleared, per organization.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, samNoticeLoadRuns, samNotices, scoutCandidates, scoutRuns } from "@/db/schema";
import { runScoutForOrganization, saveScoutProfile } from "@/lib/scout";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const id = (n: number) => n.toString(16).padStart(32, "0");
const notice = (n: number, naicsCode: string, title: string, o: Record<string, unknown> = {}) => ({
  noticeId: id(n),
  title,
  solicitationNumber: `SOL-${n}`,
  active: "Yes",
  type: "Solicitation",
  postedDate: "2026-10-12",
  naicsCode,
  description: `https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=${id(n)}`,
  department: "VETERANS AFFAIRS, DEPARTMENT OF",
  ...o,
});
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
// What SAM.gov returns per code, whatever the keywords.
const BY_CODE: Record<string, ReturnType<typeof notice>[]> = {
  "541519": [
    notice(1, "541519", "IT support"),
    notice(2, "541519", "Help desk"),
    notice(6, "541519", "ServiceNow licenses", { responseDeadLine: inDays(-1) }), // already past due
  ],
  "541512": [
    notice(5, "541512", "Enterprise IT Modernization support"),
    // A solicitation whose latest notice (an amendment) doesn't repeat the keyword.
    notice(7, "541512", "ServiceNow platform support", { solicitationNumber: "SOL-AMD", postedDate: "2026-10-10" }),
    notice(8, "541512", "Amendment 0001", { solicitationNumber: "SOL-AMD", postedDate: "2026-10-12" }),
  ],
  "518210": [notice(3, "518210", "Aberdeen Test Center - Data Collection Support Services (DCSS)")],
  "541715": [
    notice(4, "541715", "Hazardous Materials Safety Research Initiative BAA"),
    notice(9, "541715", "Pipeline data platform"), // only a link in FORGE's copy: read live
    notice(10, "541715", "Records platform"), // a link in the copy, already waiting: not read, not judged
  ],
};
const STORED: [number, string][] = [
  [1, "Migrating the help desk to ServiceNow."],
  [2, "Tier 1 and 2 help desk services."],
  [3, "Data collection support services for test ranges."],
  [4, "Research into the digital transformation of pipeline safety data."],
  [5, "Modernize legacy systems."],
  [6, "ServiceNow licenses."],
  [7, "ServiceNow modules for the VISN."],
  [8, "Extends the response date."],
];
const LIVE: Record<string, string> = { [id(9)]: "<p>Digital transformation of pipeline records.</p>" };

describe("BL-STAB-10d — the scout finds what both its keywords and its codes ask for", () => {
  let fx: TwoTenantFixture;
  const clearCopy = async () => {
    await db.delete(samNotices);
    await db.delete(samNoticeLoadRuns);
  };

  beforeEach(async () => {
    fx = await createTwoTenants("scout-run");
    vi.stubEnv("SAMGOV_API_KEY", "SHAREDKEY0123456789abcdef");
    await clearCopy();
    await db.insert(samNoticeLoadRuns).values({ status: "ok", sourceModifiedAt: new Date(Date.now() - 6 * 3_600_000), newestPostedAt: new Date("2026-10-12T20:00:00Z") });
    await db.insert(samNotices).values([
      ...STORED.map(([n, description]) => ({ noticeId: id(n), state: "text", description, postedAt: new Date("2026-10-12T10:00:00Z"), digest: String(n) })),
      { noticeId: id(9), state: "link", description: null, postedAt: new Date("2026-10-12T10:00:00Z"), digest: "9" },
      { noticeId: id(10), state: "link", description: null, postedAt: new Date("2026-10-12T10:00:00Z"), digest: "10" },
    ]);
    // The organization's own codes, one saved with its label (Settings → Classification).
    await db.update(organizations).set({ primaryNaics: "518210", naicsList: ["541715 - Research and Development"] }).where(eq(organizations.id, fx.orgA.organizationId));
    await saveScoutProfile({
      organizationId: fx.orgA.organizationId,
      patch: { keywords: ["Enterprise IT modernization", "ServiceNow", "Digital Transformation"], extraNaics: ["541519", "541512"] },
      actor: { userId: fx.orgA.userId },
    });
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await clearCopy();
    await fx.cleanup();
  });

  it("keeps only notices in its codes that mention a keyword, searching the Scout page's codes first", async () => {
    const asked: string[] = [];
    const read: string[] = [];
    let byCode = BY_CODE;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        if (!url.pathname.endsWith("/search")) {
          const nid = url.searchParams.get("noticeid") ?? "";
          read.push(nid);
          return LIVE[nid] ? new Response(JSON.stringify({ description: LIVE[nid] }), { status: 200 }) : new Response("Description Not Found", { status: 404 });
        }
        const code = url.searchParams.get("ncode") ?? "";
        asked.push(code);
        const rows = byCode[code] ?? [];
        return new Response(JSON.stringify({ totalRecords: rows.length, opportunitiesData: rows }), { status: 200 });
      }),
    );
    const due = (days: number) => new Date(Date.now() + days * 86_400_000);
    const waiting = (n: number, o: Partial<typeof scoutCandidates.$inferInsert> = {}) => ({
      organizationId: fx.orgA.organizationId,
      source: "org_naics" as const,
      noticeId: id(n),
      title: `Waiting ${n}`,
      naicsCode: "541519",
      responseDueAt: due(20),
      fitScore: 50,
      ...o,
    });
    await db.insert(scoutCandidates).values([
      waiting(1, { title: "IT support", description: "Migrating the help desk to ServiceNow." }), // still fits
      waiting(20, { naicsCode: "518210", description: "Data collection support." }), // no keyword
      waiting(21, { naicsCode: "236220", title: "ServiceNow for construction" }), // another code
      waiting(22, { title: "ServiceNow renewal", responseDueAt: due(-2) }), // past due
      waiting(23, { source: "watchlist_award", naicsCode: "", responseDueAt: null }), // a watchlisted award: not judged
      waiting(24, { title: "Mystery" }), // no description, not in the copy: can't tell yet
      // Saved before the matched keyword was kept: only an earlier notice names it.
      waiting(8, { naicsCode: "541512", title: "Amendment 0001", description: "Extends the response date." }),
      // The search couldn't settle it this run: its saved text alone doesn't clear it.
      waiting(10, { naicsCode: "541715", title: "Records platform", description: "An older summary." }),
      waiting(25, { naicsCode: "236220", status: "dismissed" }), // decided: untouched
      { ...waiting(26, { naicsCode: "236220" }), organizationId: fx.orgB.organizationId }, // another organization
    ]);

    const idOf = async (n: number) =>
      (await db.select({ id: scoutCandidates.id, createdAt: scoutCandidates.createdAt }).from(scoutCandidates).where(and(eq(scoutCandidates.organizationId, fx.orgA.organizationId), eq(scoutCandidates.noticeId, id(n)))))[0];
    const before = await idOf(1);
    const before8 = await idOf(8);

    await runScoutForOrganization({ organizationId: fx.orgA.organizationId, trigger: "manual" });

    expect(asked).toEqual(["541519", "541512", "518210", "541715"]);
    // Only the notice FORGE's copy holds as a link is read live.
    expect(read).toEqual([id(9)]);
    const rowsOf = () =>
      db
        .select({ id: scoutCandidates.id, noticeId: scoutCandidates.noticeId, status: scoutCandidates.status, matchedKeyword: scoutCandidates.matchedKeyword, createdAt: scoutCandidates.createdAt })
        .from(scoutCandidates)
        .where(eq(scoutCandidates.organizationId, fx.orgA.organizationId));
    let rows = await rowsOf();
    const has = (n: number) => rows.some((r) => r.noticeId === id(n));
    // Finds: a keyword in the description (1, 4), the title (5), an earlier notice of the
    // solicitation (8, through 7), or a description read live (9). Not the DCSS notice (3),
    // the help desk (2) or the past-due notice (6).
    for (const n of [1, 4, 5, 8, 9, 10, 23, 24, 25]) expect(has(n), `kept ${n}`).toBe(true);
    for (const n of [2, 3, 6, 7, 20, 21, 22]) expect(has(n), `not ${n}`).toBe(false);
    // Waiting finds the search found again are the same rows, not deleted and re-inserted,
    // and one saved before the matched keyword was kept now has it.
    expect(rows.find((r) => r.noticeId === id(1))).toMatchObject({ id: before!.id, createdAt: before!.createdAt });
    expect(rows.find((r) => r.noticeId === id(8))).toMatchObject({ id: before8!.id, matchedKeyword: "ServiceNow" });
    expect(rows.find((r) => r.noticeId === id(25))?.status).toBe("dismissed");
    const [b] = await db.select({ id: scoutCandidates.id }).from(scoutCandidates).where(and(eq(scoutCandidates.organizationId, fx.orgB.organizationId), eq(scoutCandidates.noticeId, id(26))));
    expect(b).toBeDefined();

    const [run] = await db.select({ note: scoutRuns.note, searches: scoutRuns.searches }).from(scoutRuns).where(eq(scoutRuns.organizationId, fx.orgA.organizationId));
    expect(run!.searches).toBe(4);
    expect(run!.note).toContain("NAICS searched: 541519, 541512, 518210, 541715; kept notices that mention any of “Enterprise IT modernization”, “ServiceNow” or “Digital Transformation”.");
    expect(run!.note).toContain("Removed 3 waiting finds that no longer fit your keywords and codes, or are past due.");
    expect(run!.note).toContain("1 notice already past the response date left out.");

    // Next night the solicitation's earlier notice has left the window: the amendment stays,
    // because the keyword it was kept for is still searched; nothing is re-created.
    byCode = { ...BY_CODE, "541512": [notice(8, "541512", "Amendment 0001", { solicitationNumber: "SOL-AMD", postedDate: "2026-10-12" })] };
    const firstIds = new Map(rows.map((r) => [r.noticeId, r.id]));
    await runScoutForOrganization({ organizationId: fx.orgA.organizationId, trigger: "manual" });
    rows = await rowsOf();
    for (const n of [1, 4, 5, 8, 9]) expect(rows.find((r) => r.noticeId === id(n))?.id, `same row ${n}`).toBe(firstIds.get(id(n)));
  });

  it("a saved code FORGE can't read is named and never clears a find", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        const rows = url.pathname.endsWith("/search") ? (BY_CODE[url.searchParams.get("ncode") ?? ""] ?? []) : [];
        return new Response(JSON.stringify({ totalRecords: rows.length, opportunitiesData: rows }), { status: 200 });
      }),
    );
    await db.update(organizations).set({ naicsList: ["541715 - Research and Development", "Computer Systems Design"] }).where(eq(organizations.id, fx.orgA.organizationId));
    await db.insert(scoutCandidates).values({ organizationId: fx.orgA.organizationId, source: "org_naics", noticeId: id(30), title: "ServiceNow support", naicsCode: "541330", fitScore: 50 });
    await runScoutForOrganization({ organizationId: fx.orgA.organizationId, trigger: "manual" });
    const [kept] = await db.select({ id: scoutCandidates.id }).from(scoutCandidates).where(and(eq(scoutCandidates.organizationId, fx.orgA.organizationId), eq(scoutCandidates.noticeId, id(30))));
    expect(kept).toBeDefined();
    const [run] = await db.select({ note: scoutRuns.note }).from(scoutRuns).where(eq(scoutRuns.organizationId, fx.orgA.organizationId));
    expect(run!.note).toContain('Not read as a NAICS code: "Computer Systems Design"');
  });
});
