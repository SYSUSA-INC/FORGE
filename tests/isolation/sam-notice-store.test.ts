/**
 * BL-STAB-10b — searches read FORGE's copy of SAM.gov's descriptions
 * first (Postgres, SAM.gov stubbed): stored text decides for free, a miss
 * or a description cut at 32,000 characters with no hit costs one live
 * read, the import takes the whole stored text rather than the preview,
 * the switch and a stale file behave as before 10b-3, and nothing a
 * company does writes to the copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, platformSettings, samNoticeLoadRuns, samNotices, scoutCandidates } from "@/db/schema";
import { resolveSamCredential } from "@/lib/samgov-key";
import { runScoutForOrganization, saveScoutProfile } from "@/lib/scout";
import { findSamOpportunities } from "@/lib/samgov-search";
import { OPEN_NOTICE_TYPES } from "@/lib/samgov-match";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const user = { id: "PLACEHOLDER", email: "capture@store.test", name: "Capture", image: null as null, isSuperadmin: false as const, organizationId: "PLACEHOLDER", role: "admin" as const };
// What the import's recompete radar is shown (it reads the description).
const flagged = vi.hoisted(() => [] as { noticeId: string; description: string }[]);
vi.mock("@/lib/recompete-radar", () => ({
  flagSamResults: async (_org: string, rows: { noticeId: string; description: string }[]) => {
    flagged.push(...rows.map((r) => ({ noticeId: r.noticeId, description: r.description })));
    return {};
  },
}));
vi.mock("@/lib/auth-helpers", () => ({
  requireAuth: async () => user,
  requireCurrentOrg: async () => ({ user, organizationId: user.organizationId, isImpersonating: false }),
  getSessionUser: async () => user,
}));

import { importSamGovOpportunitiesAction, loadSamGovOpportunitiesAction, readSamDescriptionsAction } from "@/app/(app)/opportunities/import/actions";

const id = (n: number) => n.toString(16).padStart(32, "0");
const notice = (n: number, postedDate: string, o: Record<string, unknown> = {}) => ({
  noticeId: id(n),
  title: `Notice ${n}`,
  solicitationNumber: `SOL-${n}`,
  active: "Yes",
  type: "Solicitation",
  postedDate,
  description: `https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=${id(n)}`,
  department: "VETERANS AFFAIRS, DEPARTMENT OF",
  ...o,
});
const LONG = `ServiceNow platform renewal. ${"Scope of work continues. ".repeat(60).trim()}`;
const CUT_NO_HIT = `${"Data center hardware. ".repeat(1500)}...`;
const CUT_HIT = `ServiceNow modules. ${"More scope. ".repeat(3000)}...`;
// The file's plain text keeps literal angle brackets and ampersands.
const BRACKETS = "Response time <4 hours. Migrating the help desk to ServiceNow. Uptime >99.9% & more.";

// What SAM.gov returns for the code, whatever the keyword.
const ROWS = [
  notice(1, "2026-10-04", { title: "IT support" }), // stored: mentions it, among angle brackets
  notice(2, "2026-10-04", { title: "Help desk" }), // stored: doesn't
  notice(3, "2026-10-04", { title: "Cloud" }), // stored: no description
  notice(4, "2026-10-06", { title: "Licenses" }), // posted after the file: read live
  notice(5, "2026-10-02", { title: "Big" }), // stored cut with no hit: read live
  notice(6, "2026-10-02", { title: "Huge" }), // stored cut with a hit
  notice(7, "2026-10-01", { title: "Modules", solicitationNumber: "SOL-78" }), // earlier notice: mentions it
  notice(8, "2026-10-03", { title: "Amendment", solicitationNumber: "SOL-78" }), // latest: doesn't
  notice(9, "2026-10-03", { title: "ServiceNow renewal" }), // title match
  notice(11, "2026-10-02", { title: "Tooling" }), // stored with paragraphs run together: read live
];
const LIVE: Record<string, string> = {
  [id(4)]: "ServiceNow licenses for 500 users.",
  [id(5)]: "Hardware… and finally ServiceNow.",
  [id(6)]: "<p>ServiceNow modules, live.</p>",
  [id(10)]: "Other.",
  [id(11)]: "<p>Background</p><p>ServiceNow is the tool.</p>",
};
// SAM.gov failing for a notice (not a key or quota failure): it stays unread.
const DOWN = new Set([id(1)]);

function stubSam(rows = ROWS, live = LIVE): URL[] {
  const calls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/search")) return new Response(JSON.stringify({ totalRecords: rows.length, opportunitiesData: rows }), { status: 200 });
      calls.push(url);
      const nid = url.searchParams.get("noticeid") ?? "";
      if (DOWN.has(nid)) return new Response("busy", { status: 503 });
      const text = live[nid];
      return text === undefined ? new Response("Description Not Found", { status: 404 }) : new Response(JSON.stringify({ description: text }), { status: 200 });
    }),
  );
  return calls;
}
const asked = (calls: URL[]) => calls.map((u) => u.searchParams.get("noticeid")).sort();

describe("BL-STAB-10b — searches read FORGE's copy of SAM.gov descriptions first", () => {
  let fx: TwoTenantFixture;
  const clear = async () => {
    await db.delete(samNotices);
    await db.delete(samNoticeLoadRuns);
    await db.delete(platformSettings).where(like(platformSettings.key, "sam_notice.%"));
  };
  const seed = async (fileAgeHours = 10) => {
    await db.insert(samNoticeLoadRuns).values({ status: "ok", sourceModifiedAt: new Date(Date.now() - fileAgeHours * 3_600_000), newestPostedAt: new Date("2026-10-05T20:00:00Z") });
    const at = new Date("2026-10-02T12:00:00Z");
    await db.insert(samNotices).values([
      { noticeId: id(1), state: "text", description: BRACKETS, postedAt: at, digest: "1" },
      { noticeId: id(2), state: "text", description: "Help desk services, Tier 1 and 2.", postedAt: at, digest: "2" },
      { noticeId: id(3), state: "none", description: null, postedAt: at, digest: "3" },
      { noticeId: id(5), state: "truncated", description: CUT_NO_HIT, postedAt: at, digest: "5" },
      { noticeId: id(6), state: "truncated", description: CUT_HIT, postedAt: at, digest: "6" },
      { noticeId: id(7), state: "text", description: "ServiceNow modules for the VISN.", postedAt: at, digest: "7" },
      { noticeId: id(8), state: "text", description: "Amendment 1: the due date moves.", postedAt: at, digest: "8" },
      { noticeId: id(9), state: "text", description: LONG, postedAt: at, digest: "9" },
      { noticeId: id(11), state: "text", description: "BackgroundServiceNow is the tool.", postedAt: at, digest: "11" },
    ]);
  };
  const storeRows = () => db.select({ id: samNotices.noticeId, digest: samNotices.digest, goneOn: samNotices.goneOn }).from(samNotices).orderBy(asc(samNotices.noticeId));
  const descriptionOf = async (n: number) =>
    (await db.select({ description: opportunities.description }).from(opportunities).where(eq(opportunities.noticeId, id(n))))[0]?.description;
  const search = async (keyword: string, readBudget?: number, rows = ROWS, live = LIVE) => {
    const calls = stubSam(rows, live);
    const sam = await resolveSamCredential(fx.orgA.organizationId);
    if (!sam.ok) throw new Error("no key");
    const r = await findSamOpportunities(sam.cred, { naicsCodes: ["541519"], keyword, noticeTypes: OPEN_NOTICE_TYPES, postedDaysBack: 30, readBudget });
    if (!r.ok) throw new Error(r.error);
    return { r, calls, find: (n: number) => [...r.notices, ...r.unchecked].find((o) => o.noticeId === id(n)) };
  };

  beforeEach(async () => {
    fx = await createTwoTenants("sam-notice-store");
    user.id = fx.orgA.userId;
    user.organizationId = fx.orgA.organizationId;
    vi.stubEnv("SAMGOV_API_KEY", "SHAREDKEY0123456789abcdef");
    await clear();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await clear();
    await fx.cleanup();
  });

  it("decides from the copy for free and reads SAM.gov live only for what it can't decide", async () => {
    await seed();
    const before = await storeRows();
    const calls = stubSam();
    flagged.length = 0;
    const r = await loadSamGovOpportunitiesAction({ naicsCodes: ["541519"], keyword: "ServiceNow" });
    if (!r.ok) throw new Error(r.error);
    // The radar sees the copy's whole text, though the browser gets only a preview.
    expect(flagged.find((f) => f.noticeId === id(9))?.description).toBe(LONG);
    expect(flagged.find((f) => f.noticeId === id(4))?.description).toBe(LIVE[id(4)]);
    // Live reads: posted after the file, cut with no hit, and run together around the keyword.
    expect(asked(calls)).toEqual([id(4), id(5), id(11)]);
    expect(r.opportunities.map((o) => o.noticeId).sort()).toEqual([1, 4, 5, 6, 8, 9, 11].map(id));
    expect(r.counts).toMatchObject({ matched: 7, notMentioned: 1, noDescription: 1, unchecked: 0, uncheckedNew: 0 });
    expect(r.counts.matched + r.counts.notMentioned + r.counts.noDescription + r.counts.unchecked).toBe(9);
    expect(r.scope.copyThrough).toBe("2026-10-05");
    expect(r.warning).toBeNull();
    const by = new Map(r.opportunities.map((o) => [o.noticeId, o]));
    // A literal "<" in the copy's text is text: the keyword between "<" and ">" is found, and shown as written.
    expect(by.get(id(1))!.match).toMatchObject({ status: "match", where: "description", snippet: expect.stringContaining("<4 hours. Migrating the help desk to ServiceNow. Uptime >99.9% & more.") });
    expect(by.get(id(1))!.preview).toBe(BRACKETS);
    // A match in an earlier notice of the solicitation counts.
    expect(by.get(id(8))!.match).toMatchObject({ status: "match", where: "description", snippet: expect.stringContaining("ServiceNow modules") });
    // Stored text travels only as a preview beside an empty description; live text in full.
    expect(by.get(id(9))!.match).toMatchObject({ status: "match", where: "title" });
    expect(by.get(id(9))!.description).toBe("");
    expect(by.get(id(9))!.preview!.length).toBeLessThanOrEqual(401);
    expect(by.get(id(9))!.preview!.endsWith("…")).toBe(true);
    expect(by.get(id(4))!.description).toBe(LIVE[id(4)]);

    // The import takes whole text from the copy (no live read), and keeps text readable.
    calls.length = 0;
    expect(await importSamGovOpportunitiesAction([by.get(id(9)), by.get(id(4)), by.get(id(1)), by.get(id(11))])).toMatchObject({ ok: true, imported: 4 });
    expect(calls).toHaveLength(0);
    expect(await descriptionOf(9)).toBe(LONG);
    expect(await descriptionOf(1)).toBe(BRACKETS);
    expect(await descriptionOf(11)).toBe("Background\nServiceNow is the tool.");

    // Check more reads SAM.gov first; the copy answers (as partial) only when SAM.gov doesn't.
    const more = await readSamDescriptionsAction([id(1), id(5), id(10)]);
    expect(more).toMatchObject({ ok: true, descriptions: { [id(1)]: { text: expect.stringContaining("&lt;4 hours"), partial: true }, [id(5)]: { text: LIVE[id(5)] }, [id(10)]: { text: "Other." } } });
    expect(asked(calls)).toEqual([id(1), id(5), id(10)]);

    // Switched off before the import: a preview is never saved; the description is read live.
    await db.insert(platformSettings).values({ key: "sam_notice.reads", value: "off" });
    calls.length = 0;
    expect(await importSamGovOpportunitiesAction([by.get(id(6))])).toMatchObject({ ok: true, imported: 1 });
    expect(asked(calls)).toEqual([id(6)]);
    expect(await descriptionOf(6)).toBe("ServiceNow modules, live.");

    // Nothing a company did wrote to the copy.
    expect(await storeRows()).toEqual(before);
  });

  it("an excluded word in the latest notice rules the solicitation out, whatever earlier notices say", async () => {
    await seed();
    // The latest notice's text names it: out, with no live read; an earlier hit doesn't override it.
    let s = await search("ServiceNow -due");
    expect(s.find(8)).toBeUndefined();
    expect(asked(s.calls)).not.toContain(id(8));
    // The latest notice is clear of it: the earlier hit counts. A cut text naming it is out too.
    s = await search("ServiceNow -hardware");
    expect(s.find(8)?.match).toMatchObject({ status: "match", snippet: expect.stringContaining("ServiceNow modules") });
    expect(s.find(5)).toBeUndefined();
    expect(asked(s.calls)).not.toContain(id(5));

    // A newer notice the copy doesn't hold yet: the earlier hit waits for it to be read.
    const rows = [...ROWS, notice(12, "2026-10-07", { title: "Mod 2", solicitationNumber: "SOL-78" })];
    s = await search("ServiceNow -hardware", 0, rows);
    expect(s.r.unchecked.find((o) => o.noticeId === id(12))).toMatchObject({ afterCopy: true, earlierMatch: { status: "match" } });
    s = await search("ServiceNow -hardware", undefined, rows, { ...LIVE, [id(12)]: "Mod 2 adds a hardware refresh." });
    expect(s.find(12)).toBeUndefined();
    s = await search("ServiceNow -hardware", undefined, rows, { ...LIVE, [id(12)]: "Mod 2 moves the date." });
    expect(s.find(12)?.match).toMatchObject({ status: "match", snippet: expect.stringContaining("ServiceNow modules") });
  });

  it("the scout takes its finds' descriptions from the copy, in full and readable", async () => {
    await seed();
    await saveScoutProfile({ organizationId: fx.orgA.organizationId, patch: { keywords: ["ServiceNow"] }, actor: { userId: fx.orgA.userId } });
    const calls = stubSam();
    await runScoutForOrganization({ organizationId: fx.orgA.organizationId, trigger: "manual" });
    const rows = await db
      .select({ noticeId: scoutCandidates.noticeId, description: scoutCandidates.description })
      .from(scoutCandidates)
      .where(eq(scoutCandidates.organizationId, fx.orgA.organizationId));
    const by = new Map(rows.map((r) => [r.noticeId, r.description]));
    expect(by.get(id(9))).toBe(LONG);
    expect(by.get(id(1))).toBe(BRACKETS);
    // Only what the copy can't settle is read live: not held (4), cut off with no hit (5), run
    // together around the keyword (11); the matches it read live are kept in full.
    expect(asked(calls)).toEqual([id(4), id(5), id(11)]);
    expect(by.get(id(4))).toBe(LIVE[id(4)]);
    expect(by.get(id(11))).toBe("Background\nServiceNow is the tool.");
  });

  it("with no reads left, counts only notices the copy can't hold as newer than it", async () => {
    await seed();
    let s = await search("ServiceNow", 0);
    expect(s.calls).toHaveLength(0);
    expect(s.r.unchecked.map((o) => o.noticeId).sort()).toEqual([4, 5, 11].map(id));
    expect(s.r.counts).toMatchObject({ matched: 4, notMentioned: 1, noDescription: 1, unchecked: 3, uncheckedNew: 1 });
    expect(s.find(4)?.afterCopy).toBe(true);
    // A cut description is shown as a preview, never as the description.
    expect(s.find(5)).toMatchObject({ description: "", preview: expect.stringMatching(/…$/) });
    // In the file only as a link: not counted as newer than the copy.
    await db.insert(samNotices).values({ noticeId: id(4), state: "link", description: null, postedAt: new Date("2026-10-05T10:00:00Z"), digest: "4" });
    s = await search("ServiceNow", 0);
    expect(s.r.counts).toMatchObject({ unchecked: 3, uncheckedNew: 0 });
    expect(s.find(4)?.afterCopy).toBeUndefined();
  });

  it("switched off, or never loaded, searches read SAM.gov live as before; a stale file is called out", async () => {
    await seed();
    await db.insert(platformSettings).values({ key: "sam_notice.reads", value: "off" });
    let calls = stubSam();
    let r = await loadSamGovOpportunitiesAction({ naicsCodes: ["541519"], keyword: "ServiceNow" });
    if (!r.ok) throw new Error(r.error);
    // Every notice the title didn't decide is read live (9 solicitations, one title match).
    expect(asked(calls)).toEqual([1, 2, 3, 4, 5, 6, 8, 11].map(id));
    expect(r.scope.copyThrough).toBeNull();

    await clear();
    await seed(80);
    calls = stubSam();
    r = await loadSamGovOpportunitiesAction({ naicsCodes: ["541519"], keyword: "ServiceNow" });
    if (!r.ok) throw new Error(r.error);
    expect(r.warning).toMatch(/^FORGE's copy of SAM\.gov descriptions is from \d{4}-\d{2}-\d{2}, so newer notices are read live, 30 per search\.$/);
    expect(asked(calls)).toEqual([id(4), id(5), id(11)]);

    // A search with no keyword shows stored previews and reads nothing.
    calls = stubSam();
    r = await loadSamGovOpportunitiesAction({ naicsCodes: ["541519"] });
    if (!r.ok) throw new Error(r.error);
    expect(calls).toHaveLength(0);
    expect(r.warning).toBeNull();
    expect(r.opportunities.find((o) => o.noticeId === id(1))).toMatchObject({ description: "", preview: BRACKETS });
  });
});
