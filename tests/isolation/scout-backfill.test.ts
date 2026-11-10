/**
 * BL-SCOUT-BACKFILL — a company's first scout reads everything SAM.gov still
 * holds as open in its codes (a year back, paged), keeps the best-fitting
 * finds up to a cap, and says so; the next night's run is the short window
 * again. SAM.gov is stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, samNoticeLoadRuns, samNotices, scoutCandidates } from "@/db/schema";
import { runScoutForOrganization } from "@/lib/scout";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const id = (n: number) => n.toString(16).padStart(32, "0");
const row = (n: number) => ({
  noticeId: id(n),
  title: `Cloud support ${n}`,
  solicitationNumber: `SOLN-${String(n).padStart(6, "0")}`,
  active: "Yes",
  type: "Solicitation",
  postedDate: "2026-10-12",
  naicsCode: "541512",
  description: `https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=${id(n)}`,
  department: "VETERANS AFFAIRS, DEPARTMENT OF",
});

describe("BL-SCOUT-BACKFILL — the first scout reads everything open", () => {
  let fx: TwoTenantFixture;
  beforeEach(async () => {
    fx = await createTwoTenants("scout-backfill");
    vi.stubEnv("SAMGOV_API_KEY", "SHAREDKEY0123456789abcdef");
    await db.delete(samNotices);
    await db.delete(samNoticeLoadRuns);
    await db.update(organizations).set({ primaryNaics: "541512" }).where(eq(organizations.id, fx.orgA.organizationId));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await fx.cleanup();
  });

  function stubSam(total: number) {
    const asks: { offset: string | null; from: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        if (!url.pathname.endsWith("/search")) return new Response("Description Not Found", { status: 404 });
        const offset = Number(url.searchParams.get("offset") ?? 0);
        asks.push({ offset: url.searchParams.get("offset"), from: url.searchParams.get("postedFrom") });
        const n = Math.max(0, Math.min(1000, total - offset));
        return new Response(JSON.stringify({ totalRecords: total, opportunitiesData: Array.from({ length: n }, (_, i) => row(offset + i + 1)) }), { status: 200 });
      }),
    );
    return asks;
  }

  it("pages through a long answer on the first run, keeps the best 500 and says so; the next run is the short window", async () => {
    const asks = stubSam(1200);
    const first = await runScoutForOrganization({ organizationId: fx.orgA.organizationId, trigger: "cron" });
    expect(asks.map((a) => a.offset)).toEqual([null, "1000"]);
    const daysBack = (Date.now() - new Date(asks[0]!.from!.replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$1-$2")).getTime()) / 86_400_000;
    expect(Math.round(daysBack)).toBeGreaterThanOrEqual(363);
    expect(first.created).toBe(500);
    expect(first.note).toContain("Everything still open");
    expect(first.note).toContain("1200 open notices fit the codes; the 500 best-fitting are kept");

    asks.length = 0;
    const second = await runScoutForOrganization({ organizationId: fx.orgA.organizationId, trigger: "cron" });
    expect(asks).toHaveLength(1);
    expect(asks[0]!.offset).toBeNull();
    expect(second.note).not.toContain("Everything still open");
    const waiting = await db.select({ id: scoutCandidates.id }).from(scoutCandidates).where(eq(scoutCandidates.organizationId, fx.orgA.organizationId));
    expect(waiting.length).toBeGreaterThanOrEqual(500);
  }, 120_000);

  it("a manual backfill reads the long window again, and a one-off search never does", async () => {
    const asks = stubSam(10);
    await runScoutForOrganization({ organizationId: fx.orgA.organizationId, trigger: "cron" });
    asks.length = 0;
    await runScoutForOrganization({ organizationId: fx.orgA.organizationId, trigger: "manual", backfill: true });
    const long = (Date.now() - new Date(asks[0]!.from!.replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$1-$2")).getTime()) / 86_400_000;
    expect(Math.round(long)).toBeGreaterThanOrEqual(363);
    asks.length = 0;
    await runScoutForOrganization({ organizationId: fx.orgB.organizationId, trigger: "manual", criteria: { keywords: [], extraNaics: ["541512"], postedDaysBack: 3 } });
    const short = (Date.now() - new Date(asks[0]!.from!.replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$1-$2")).getTime()) / 86_400_000;
    expect(Math.round(short)).toBeLessThanOrEqual(4);
    expect(asks).toHaveLength(1);
  }, 120_000);
});
