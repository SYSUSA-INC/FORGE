/**
 * BL-SCOUT-LEARN — Scout learns from a tenant's own outcomes and nobody
 * else's: each tenant's finds are nudged by its own history, a tenant with
 * none is untouched, and the admin switch and reset stop the reading.
 * SAM.gov and the embedding provider are stubbed (a word decides the axis; anything else is just related to both capabilities, near neither past outcome).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeEntries, opportunities, organizations, samNoticeLoadRuns, samNotices, scoutCandidates, scoutProfiles } from "@/db/schema";
import { getScoutLearning, resetScoutLearning, runScoutForOrganization, setScoutLearning } from "@/lib/scout";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

vi.mock("@/lib/embeddings", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/embeddings")>();
  const vec = (t: string) => (/janitor/i.test(t) ? [0, 1, 0] : /cloud/i.test(t) ? [1, 0, 0] : [0.37, 0.37, 0.85]);
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

describe("BL-SCOUT-LEARN — learning from outcomes, per tenant", () => {
  let fx: TwoTenantFixture;
  const A = () => fx.orgA.organizationId;
  const B = () => fx.orgB.organizationId;

  /** `n` opportunities taken to Capture with `word` in the title (positives), and `m` dismissed finds with `other` (negatives). */
  async function history(organizationId: string, positive: string, negative: string, n = 8, m = 14) {
    await db.insert(opportunities).values(Array.from({ length: n }, (_, i) => ({ organizationId, title: `${positive} work ${i}`, agency: "VA", description: `${positive} services`, stage: "capture" as const })));
    await db.insert(scoutCandidates).values(
      Array.from({ length: m }, (_, i) => ({
        organizationId,
        source: "org_naics" as const,
        status: "dismissed" as const,
        noticeId: `seed-${organizationId.slice(0, 6)}-${i}`,
        title: `${negative} job ${i}`,
        description: `${negative} services`,
        decidedAt: new Date(),
      })),
    );
  }

  beforeEach(async () => {
    fx = await createTwoTenants("scout-learn");
    vi.stubEnv("SAMGOV_API_KEY", "SHAREDKEY0123456789abcdef");
    await db.delete(samNotices);
    await db.delete(samNoticeLoadRuns);
    for (const o of [fx.orgA, fx.orgB]) {
      await db.update(organizations).set({ primaryNaics: "541512" }).where(eq(organizations.id, o.organizationId));
      await db.insert(knowledgeEntries).values([
        { organizationId: o.organizationId, kind: "capability" as const, title: "Cloud practice", body: "Cloud migration for civilian agencies." },
        { organizationId: o.organizationId, kind: "capability" as const, title: "Facilities", body: "Janitorial services." },
      ]);
    }
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

  const finds = async (organizationId: string) => {
    const rows = await db.select().from(scoutCandidates).where(eq(scoutCandidates.organizationId, organizationId));
    return Object.fromEntries(rows.filter((r) => r.status === "new").map((r) => [r.title.split(" ")[0]!, r]));
  };

  it("each tenant's finds are nudged by its own history only, and the opposite history gives the opposite nudge", async () => {
    await history(A(), "Cloud", "Janitorial");
    await history(B(), "Janitorial", "Cloud");
    const runA = await runScoutForOrganization({ organizationId: A(), trigger: "cron" });
    await runScoutForOrganization({ organizationId: B(), trigger: "cron" });
    expect(runA.learnedFrom).toBe(22);
    expect(runA.note).toContain("Learning from 22 outcomes");
    const a = await finds(A());
    const b = await finds(B());
    expect(a.Cloud!.affinity).toBeGreaterThan(0);
    expect(a.Janitorial!.affinity).toBeLessThan(0);
    expect(a.Cloud!.signals.some((s) => s.startsWith("Learned: +") && s.includes("Similar to “Cloud work"))).toBe(true);
    expect(b.Janitorial!.affinity).toBeGreaterThan(0);
    expect(b.Cloud!.affinity).toBeLessThan(0);
    // Capped at ±5 below 50 outcomes, and a lowered Related find is still on the list, not set aside.
    expect(Math.abs(a.Janitorial!.affinity!)).toBeLessThanOrEqual(5);
    expect(a.Janitorial!.capabilityBand).toBe("related");
    // The find that resembles nothing before is the exploration slice.
    expect(a.Records!.signals.some((s) => s.includes("New line of work"))).toBe(true);
  });

  it("a tenant with no history is untouched while another tenant has plenty", async () => {
    await history(A(), "Cloud", "Janitorial");
    const runB = await runScoutForOrganization({ organizationId: B(), trigger: "cron" });
    expect(runB.learnedFrom).toBe(0);
    for (const r of Object.values(await finds(B()))) {
      expect(r.affinity).toBeNull();
      expect(r.signals.some((s) => s.startsWith("Learned:"))).toBe(false);
    }
    expect((await getScoutLearning({ organizationId: B() })).labelled).toBe(0);
    expect((await getScoutLearning({ organizationId: A() })).labelled).toBe(22);
  });

  it("scores again on the next run without doubling the learned line", async () => {
    await history(A(), "Cloud", "Janitorial");
    await runScoutForOrganization({ organizationId: A(), trigger: "cron" });
    await runScoutForOrganization({ organizationId: A(), trigger: "manual" });
    const a = await finds(A());
    expect(a.Cloud!.signals.filter((s) => s.startsWith("Learned:")).length).toBe(1);
  });

  it("switching learning off stops it and the scores go back; switching on resumes", async () => {
    await history(A(), "Cloud", "Janitorial");
    const actor = { userId: fx.orgA.userId, email: "a@test.local" };
    const oppsBefore = (await db.select().from(opportunities).where(eq(opportunities.organizationId, A()))).length;
    await runScoutForOrganization({ organizationId: A(), trigger: "cron" });
    const before = (await finds(A())).Cloud!.fitScore;
    await setScoutLearning({ organizationId: A(), enabled: false, actor });
    expect((await getScoutLearning({ organizationId: A() })).mode).toBe("disabled");
    const off = await runScoutForOrganization({ organizationId: A(), trigger: "manual" });
    expect(off.learnedFrom).toBe(0);
    const after = (await finds(A())).Cloud!;
    expect(after.affinity).toBeNull();
    expect(after.fitScore).toBeLessThan(before);
    await setScoutLearning({ organizationId: A(), enabled: true, actor });
    expect((await runScoutForOrganization({ organizationId: A(), trigger: "manual" })).learnedFrom).toBe(22);
    // Nothing was deleted by any of it.
    expect((await db.select().from(opportunities).where(eq(opportunities.organizationId, A()))).length).toBe(oppsBefore);
  });

  it("a reset stops reading what came before it and deletes nothing", async () => {
    await history(A(), "Cloud", "Janitorial");
    await new Promise((r) => setTimeout(r, 20));
    await resetScoutLearning({ organizationId: A(), actor: { userId: fx.orgA.userId, email: "a@test.local" } });
    const view = await getScoutLearning({ organizationId: A() });
    expect(view.labelled).toBe(0);
    expect(view.line).toBe("Scout is not learning from outcomes yet: 0 so far (0 taken forward); it starts at 20 decided with 5 taken forward, so 20 more decided finds and 5 more taken forward.");
    expect((await db.select().from(scoutCandidates).where(eq(scoutCandidates.organizationId, A()))).length).toBe(14);
    expect((await db.select().from(scoutProfiles).where(eq(scoutProfiles.organizationId, B()))).length).toBe(0);
  });

  it("below 20 outcomes it is off and the run note says how many it needs", async () => {
    await history(A(), "Cloud", "Janitorial", 6, 4);
    const run = await runScoutForOrganization({ organizationId: A(), trigger: "cron" });
    expect(run.learnedFrom).toBe(0);
    expect(run.note).toContain("not learning from outcomes yet: 10 so far");
    for (const r of Object.values(await finds(A()))) expect(r.affinity).toBeNull();
  });
});
