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

// What SAM.gov returns for the code, whatever the keyword.
const ROWS = [
  notice(1, "2026-10-04", { title: "IT support" }), // stored: mentions it
  notice(2, "2026-10-04", { title: "Help desk" }), // stored: doesn't
  notice(3, "2026-10-04", { title: "Cloud" }), // stored: no description
  notice(4, "2026-10-06", { title: "Licenses" }), // posted after the file: read live
  notice(5, "2026-10-02", { title: "Big" }), // stored cut with no hit: read live
  notice(6, "2026-10-02", { title: "Huge" }), // stored cut with a hit
  notice(7, "2026-10-01", { title: "Modules", solicitationNumber: "SOL-78" }), // earlier notice: mentions it
  notice(8, "2026-10-03", { title: "Amendment", solicitationNumber: "SOL-78" }), // latest: doesn't
  notice(9, "2026-10-03", { title: "ServiceNow renewal" }), // title match
];
const LIVE: Record<string, string> = { [id(4)]: "ServiceNow licenses for 500 users.", [id(5)]: "Hardware… and finally ServiceNow.", [id(10)]: "Other." };

function stubSam(): URL[] {
  const calls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/search")) return new Response(JSON.stringify({ totalRecords: ROWS.length, opportunitiesData: ROWS }), { status: 200 });
      calls.push(url);
      const text = LIVE[url.searchParams.get("noticeid") ?? ""];
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
      { noticeId: id(1), state: "text", description: "Migrating the help desk to ServiceNow.", postedAt: at, digest: "1" },
      { noticeId: id(2), state: "text", description: "Help desk services, Tier 1 and 2.", postedAt: at, digest: "2" },
      { noticeId: id(3), state: "none", description: null, postedAt: at, digest: "3" },
      { noticeId: id(5), state: "truncated", description: CUT_NO_HIT, postedAt: at, digest: "5" },
      { noticeId: id(6), state: "truncated", description: CUT_HIT, postedAt: at, digest: "6" },
      { noticeId: id(7), state: "text", description: "ServiceNow modules for the VISN.", postedAt: at, digest: "7" },
      { noticeId: id(8), state: "text", description: "Amendment 1: the due date moves.", postedAt: at, digest: "8" },
      { noticeId: id(9), state: "text", description: LONG, postedAt: at, digest: "9" },
    ]);
  };
  const storeRows = () => db.select({ id: samNotices.noticeId, digest: samNotices.digest, goneOn: samNotices.goneOn }).from(samNotices).orderBy(asc(samNotices.noticeId));

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
    const r = await loadSamGovOpportunitiesAction({ naicsCodes: ["541519"], keyword: "ServiceNow" });
    if (!r.ok) throw new Error(r.error);
    // Live reads: the notice posted after the file and the cut description with no hit.
    expect(asked(calls)).toEqual([id(4), id(5)]);
    expect(r.opportunities.map((o) => o.noticeId).sort()).toEqual([id(1), id(4), id(5), id(6), id(8), id(9)]);
    expect(r.counts).toMatchObject({ matched: 6, notMentioned: 1, noDescription: 1, unchecked: 0, uncheckedNew: 0 });
    expect(r.counts.matched + r.counts.notMentioned + r.counts.noDescription + r.counts.unchecked).toBe(8);
    expect(r.scope.copyThrough).toBe("2026-10-05");
    expect(r.warning).toBeNull();
    const by = new Map(r.opportunities.map((o) => [o.noticeId, o]));
    // A match in an earlier notice of the solicitation counts.
    expect(by.get(id(8))!.match).toMatchObject({ status: "match", where: "description", snippet: expect.stringContaining("ServiceNow modules") });
    // Stored text travels as a preview; live text in full.
    expect(by.get(id(9))!.match).toMatchObject({ status: "match", where: "title" });
    expect(by.get(id(9))!.description.length).toBeLessThanOrEqual(401);
    expect(by.get(id(9))!.description.endsWith("…")).toBe(true);
    expect(by.get(id(4))!.description).toBe(LIVE[id(4)]);

    // The import takes the whole stored text, not the browser's preview, and reads nothing live for it.
    calls.length = 0;
    const imported = await importSamGovOpportunitiesAction([by.get(id(9)), by.get(id(4))]);
    expect(imported).toMatchObject({ ok: true, imported: 2 });
    expect(calls).toHaveLength(0);
    const [opp] = await db.select({ description: opportunities.description }).from(opportunities).where(eq(opportunities.noticeId, id(9)));
    expect(opp!.description).toBe(LONG);

    // Check more: stored text free, a cut one and a miss read live.
    const more = await readSamDescriptionsAction([id(1), id(5), id(10)]);
    expect(more).toMatchObject({ ok: true, descriptions: { [id(1)]: { text: "Migrating the help desk to ServiceNow." }, [id(5)]: { text: LIVE[id(5)] }, [id(10)]: { text: "Other." } } });
    expect(asked(calls)).toEqual([id(5), id(10)]);

    // Nothing a company did wrote to the copy.
    expect(await storeRows()).toEqual(before);
  });

  it("the scout takes its finds' descriptions from the copy, in full", async () => {
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
    expect(by.get(id(1))).toBe("Migrating the help desk to ServiceNow.");
    // Only a notice the copy doesn't hold is read live.
    expect(asked(calls).every((n) => n === id(4))).toBe(true);
  });

  it("with no reads left, says which unchecked notices are newer than the file", async () => {
    await seed();
    const calls = stubSam();
    const sam = await resolveSamCredential(fx.orgA.organizationId);
    if (!sam.ok) throw new Error("no key");
    const r = await findSamOpportunities(sam.cred, { naicsCodes: ["541519"], keyword: "ServiceNow", noticeTypes: OPEN_NOTICE_TYPES, postedDaysBack: 30, readBudget: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(calls).toHaveLength(0);
    expect(r.unchecked.map((o) => o.noticeId).sort()).toEqual([id(4), id(5)]);
    // The cut description isn't shown as if whole: a preview only.
    expect(r.unchecked.find((o) => o.noticeId === id(5))!.description.length).toBeLessThanOrEqual(401);
    expect(r.counts).toMatchObject({ matched: 4, unchecked: 2, uncheckedNew: 1 });
  });

  it("switched off, or never loaded, searches read SAM.gov live as before; a stale file is called out", async () => {
    await seed();
    await db.insert(platformSettings).values({ key: "sam_notice.reads", value: "off" });
    let calls = stubSam();
    let r = await loadSamGovOpportunitiesAction({ naicsCodes: ["541519"], keyword: "ServiceNow" });
    if (!r.ok) throw new Error(r.error);
    // Every notice the title didn't decide is read live (8 solicitations, one title match).
    expect(asked(calls)).toEqual([1, 2, 3, 4, 5, 6, 8].map(id));
    expect(r.scope.copyThrough).toBeNull();

    await clear();
    await seed(80);
    calls = stubSam();
    r = await loadSamGovOpportunitiesAction({ naicsCodes: ["541519"], keyword: "ServiceNow" });
    if (!r.ok) throw new Error(r.error);
    expect(r.warning).toMatch(/^FORGE's copy of SAM\.gov descriptions is from \d{4}-\d{2}-\d{2}, so newer notices are read live, 30 per search\.$/);
    expect(asked(calls)).toEqual([id(4), id(5)]);

    // A search with no keyword shows stored previews and reads nothing.
    calls = stubSam();
    r = await loadSamGovOpportunitiesAction({ naicsCodes: ["541519"] });
    if (!r.ok) throw new Error(r.error);
    expect(calls).toHaveLength(0);
    expect(r.warning).toBeNull();
    expect(r.opportunities.find((o) => o.noticeId === id(1))!.description).toBe("Migrating the help desk to ServiceNow.");
  });
});
