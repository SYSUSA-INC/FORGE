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
const notice = (n: number, naicsCode: string, title: string) => ({
  noticeId: id(n),
  title,
  solicitationNumber: `SOL-${n}`,
  active: "Yes",
  type: "Solicitation",
  postedDate: "2026-10-12",
  naicsCode,
  description: `https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=${id(n)}`,
  department: "VETERANS AFFAIRS, DEPARTMENT OF",
});
// What SAM.gov returns per code, whatever the keywords.
const BY_CODE: Record<string, ReturnType<typeof notice>[]> = {
  "541519": [notice(1, "541519", "IT support"), notice(2, "541519", "Help desk")],
  "541512": [notice(5, "541512", "Enterprise IT Modernization support")],
  "518210": [notice(3, "518210", "Aberdeen Test Center - Data Collection Support Services (DCSS)")],
  "541715": [notice(4, "541715", "Hazardous Materials Safety Research Initiative BAA")],
};
const STORED: [number, string][] = [
  [1, "Migrating the help desk to ServiceNow."],
  [2, "Tier 1 and 2 help desk services."],
  [3, "Data collection support services for test ranges."],
  [4, "Research into the digital transformation of pipeline safety data."],
  [5, "Modernize legacy systems."],
];

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
    await db.insert(samNotices).values(STORED.map(([n, description]) => ({ noticeId: id(n), state: "text", description, postedAt: new Date("2026-10-12T10:00:00Z"), digest: String(n) })));
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        if (!url.pathname.endsWith("/search")) return new Response("Description Not Found", { status: 404 });
        const code = url.searchParams.get("ncode") ?? "";
        asked.push(code);
        const rows = BY_CODE[code] ?? [];
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
      waiting(25, { naicsCode: "236220", status: "dismissed" }), // decided: untouched
      { ...waiting(26, { naicsCode: "236220" }), organizationId: fx.orgB.organizationId }, // another organization
    ]);

    await runScoutForOrganization({ organizationId: fx.orgA.organizationId, trigger: "manual" });

    expect(asked).toEqual(["541519", "541512", "518210", "541715"]);
    const rows = await db
      .select({ noticeId: scoutCandidates.noticeId, status: scoutCandidates.status })
      .from(scoutCandidates)
      .where(eq(scoutCandidates.organizationId, fx.orgA.organizationId));
    const has = (n: number) => rows.some((r) => r.noticeId === id(n));
    // Finds: a keyword in the description (1, 4) or the title (5). Not the DCSS notice (3) or the help desk (2).
    for (const n of [1, 4, 5, 23, 24, 25]) expect(has(n), `kept ${n}`).toBe(true);
    for (const n of [2, 3, 20, 21, 22]) expect(has(n), `not ${n}`).toBe(false);
    expect(rows.filter((r) => r.noticeId === id(1))).toHaveLength(1);
    expect(rows.find((r) => r.noticeId === id(25))?.status).toBe("dismissed");
    const [b] = await db.select({ id: scoutCandidates.id }).from(scoutCandidates).where(and(eq(scoutCandidates.organizationId, fx.orgB.organizationId), eq(scoutCandidates.noticeId, id(26))));
    expect(b).toBeDefined();

    const [run] = await db.select({ note: scoutRuns.note, searches: scoutRuns.searches }).from(scoutRuns).where(eq(scoutRuns.organizationId, fx.orgA.organizationId));
    expect(run!.searches).toBe(4);
    expect(run!.note).toContain("NAICS searched: 541519, 541512, 518210, 541715; kept notices that mention any of “Enterprise IT modernization”, “ServiceNow” or “Digital Transformation”.");
    expect(run!.note).toContain("Cleared 3 waiting finds that no longer fit your keywords and codes, or are past due.");
  });
});
