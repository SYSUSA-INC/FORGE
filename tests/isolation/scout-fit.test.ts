/**
 * BL-SCOUT-FIT — a find is scored against the company's own capabilities,
 * each tenant against its own and nothing else; a weak fit is kept,
 * counted and left out of the AI's queue. SAM.gov and the embedding
 * provider are stubbed (a word decides which axis a text is on).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeEntries, organizations, samNoticeLoadRuns, samNotices, scoutCandidates } from "@/db/schema";
import { listScoutCandidates, runScoutForOrganization } from "@/lib/scout";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

vi.mock("@/lib/embeddings", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/embeddings")>();
  const vec = (t: string) => (/janitor/i.test(t) ? [0, 1] : /cloud/i.test(t) ? [1, 0] : [0.7071, 0.7071]);
  return {
    ...real,
    getEmbeddingProviderStatus: () => ({ ...real.getEmbeddingProviderStatus(), active: { name: "openai" } }),
    embedBatch: async (texts: string[]) => ({ vectors: texts.map(vec), provider: "test", model: "test", stubbed: false }),
  };
});

const id = (n: number) => n.toString(16).padStart(32, "0");
const notice = (n: number, title: string) => ({
  noticeId: id(n),
  title,
  solicitationNumber: `SOLN-${String(n).padStart(6, "0")}`,
  active: "Yes",
  type: "Solicitation",
  postedDate: "2026-10-12",
  naicsCode: "541512",
  description: `https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=${id(n)}`,
  department: "VETERANS AFFAIRS, DEPARTMENT OF",
});

describe("BL-SCOUT-FIT — capability fit, per tenant", () => {
  let fx: TwoTenantFixture;
  beforeEach(async () => {
    fx = await createTwoTenants("scout-fit");
    vi.stubEnv("SAMGOV_API_KEY", "SHAREDKEY0123456789abcdef");
    await db.delete(samNotices);
    await db.delete(samNoticeLoadRuns);
    for (const o of [fx.orgA, fx.orgB]) await db.update(organizations).set({ primaryNaics: "541512" }).where(eq(organizations.id, o.organizationId));
    await db.insert(knowledgeEntries).values([
      { organizationId: fx.orgA.organizationId, kind: "capability" as const, title: "Cloud practice", body: "Cloud migration for civilian agencies." },
      { organizationId: fx.orgB.organizationId, kind: "capability" as const, title: "Facilities", body: "Janitorial services." },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        if (!url.pathname.endsWith("/search")) return new Response("Description Not Found", { status: 404 });
        return new Response(JSON.stringify({ totalRecords: 3, opportunitiesData: [notice(1, "Cloud support services"), notice(2, "Janitorial services for the campus"), notice(3, "Records scanning")] }), { status: 200 });
      }),
    );
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await fx.cleanup();
  });

  const bands = async (organizationId: string) => {
    const rows = await db.select().from(scoutCandidates).where(eq(scoutCandidates.organizationId, organizationId));
    return Object.fromEntries(rows.map((r) => [r.title, r.capabilityBand]));
  };

  it("bands each find against its own tenant's capabilities, and nothing crosses", async () => {
    await runScoutForOrganization({ organizationId: fx.orgA.organizationId, trigger: "cron" });
    await runScoutForOrganization({ organizationId: fx.orgB.organizationId, trigger: "cron" });
    expect(await bands(fx.orgA.organizationId)).toEqual({ "Cloud support services": "related", "Janitorial services for the campus": "weak", "Records scanning": "related" });
    expect(await bands(fx.orgB.organizationId)).toEqual({ "Cloud support services": "weak", "Janitorial services for the campus": "related", "Records scanning": "related" });
  });

  it("keeps and counts the weak find, ranks it below the rest, and says so in the run note", async () => {
    const run = await runScoutForOrganization({ organizationId: fx.orgA.organizationId, trigger: "cron" });
    expect(run.created).toBe(3);
    expect(run.weakHidden).toBe(1);
    expect(run.note).toContain("1 waiting find matches nothing your company does");
    const list = await listScoutCandidates({ organizationId: fx.orgA.organizationId, status: "new" });
    const weak = list.find((c) => c.capabilityBand === "weak")!;
    const cloud = list.find((c) => c.title.startsWith("Cloud"))!;
    expect(weak.title).toBe("Janitorial services for the campus");
    expect(weak.capabilityBasis).toContain("Closest: Cloud practice");
    expect(weak.signals.some((s) => s.startsWith("Weak capability fit."))).toBe(true);
    expect(weak.fitScore).toBeLessThan(cloud.fitScore);
  });

  it("scores again on the next run without doubling the capability line", async () => {
    await runScoutForOrganization({ organizationId: fx.orgA.organizationId, trigger: "cron" });
    await runScoutForOrganization({ organizationId: fx.orgA.organizationId, trigger: "manual" });
    const rows = await db.select().from(scoutCandidates).where(and(eq(scoutCandidates.organizationId, fx.orgA.organizationId), eq(scoutCandidates.capabilityBand, "weak")));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.signals.filter((s) => s.includes("capability fit")).length).toBe(1);
  });

  it("a tenant with nothing to compare with is not scored, not penalised, and the run says why", async () => {
    await db.delete(knowledgeEntries).where(eq(knowledgeEntries.organizationId, fx.orgA.organizationId));
    const run = await runScoutForOrganization({ organizationId: fx.orgA.organizationId, trigger: "cron" });
    expect(run.created).toBe(3);
    expect(run.weakHidden).toBe(0);
    expect(run.note).toContain("Capability fit not scored");
    expect(Object.values(await bands(fx.orgA.organizationId)).every((b) => b === null)).toBe(true);
  });
});
