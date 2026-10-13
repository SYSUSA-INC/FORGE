/**
 * BL-STAB-10e — the scout's AI triage is grounded in what the organization
 * says it does (Postgres; SAM.gov and the model stubbed): the snapshot
 * carries its capability statement first, then its other capability
 * entries (not archived ones, not another organization's), and the
 * keyword the notice was found for; the prompt says NAICS and set-aside
 * alone never make a pursue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { knowledgeEntries, samNoticeLoadRuns, samNotices } from "@/db/schema";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const sent = vi.hoisted(() => [] as { system: string; messages: { content: string }[] }[]);
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  getAIProviderStatus: () => ({ active: { name: "anthropic" } }),
  completeStructuredForTenant: async (args: { system: string; messages: { content: string }[] }) => {
    sent.push(args);
    return { data: { recommendation: "watch", confidence: 0.5, rationale: "Scope unclear.", nextActions: [] }, model: "test", stubbed: false };
  },
}));
vi.mock("@/lib/subscription-gates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/subscription-gates")>()),
  ensureFeature: async () => undefined,
  enforceQuota: async () => undefined,
  refundQuota: async () => undefined,
}));

import { runScoutForOrganization, saveScoutProfile } from "@/lib/scout";

const id = (n: number) => n.toString(16).padStart(32, "0");

describe("BL-STAB-10e — the scout's triage knows what the organization does", () => {
  let fx: TwoTenantFixture;
  beforeEach(async () => {
    fx = await createTwoTenants("scout-triage");
    vi.stubEnv("SAMGOV_API_KEY", "SHAREDKEY0123456789abcdef");
    sent.length = 0;
    await db.delete(samNotices);
    await db.delete(samNoticeLoadRuns);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await fx.cleanup();
  });

  it("sends the capability statement first, the other capabilities, and the matched keyword", async () => {
    const entry = (organizationId: string, title: string, body: string, o: Partial<typeof knowledgeEntries.$inferInsert> = {}) => ({
      organizationId,
      kind: "capability" as const,
      title,
      body,
      ...o,
    });
    await db.insert(knowledgeEntries).values([
      entry(fx.orgA.organizationId, "Cloud practice", "<p>Cloud migration for civilian agencies.</p>", { qualityScore: 0.9 }),
      entry(fx.orgA.organizationId, "Capability statement", "ServiceNow ITSM implementation and help desk modernization.", { tags: ["onboarding", "capability-statement"], qualityScore: 0.1 }),
      entry(fx.orgA.organizationId, "Old practice", "Retired offering.", { archivedAt: new Date() }),
      entry(fx.orgB.organizationId, "Other company", "Janitorial services."),
      { organizationId: fx.orgA.organizationId, kind: "past_performance" as const, title: "A contract", body: "Not a capability." },
    ]);
    await saveScoutProfile({ organizationId: fx.orgA.organizationId, patch: { keywords: ["ServiceNow"], extraNaics: ["541519"] }, actor: { userId: fx.orgA.userId } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/search")) {
          const row = {
            noticeId: id(1),
            title: "Help desk support",
            solicitationNumber: "SOL-1",
            active: "Yes",
            type: "Solicitation",
            postedDate: "2026-10-12",
            naicsCode: "541519",
            description: `https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=${id(1)}`,
            department: "VETERANS AFFAIRS, DEPARTMENT OF",
          };
          return new Response(JSON.stringify({ totalRecords: 1, opportunitiesData: [row] }), { status: 200 });
        }
        return new Response(JSON.stringify({ description: "Tier 1 help desk on ServiceNow." }), { status: 200 });
      }),
    );

    await runScoutForOrganization({ organizationId: fx.orgA.organizationId, trigger: "manual" });

    expect(sent).toHaveLength(1);
    const snapshot = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(sent[0]!.messages[0]!.content)![1]!);
    expect(snapshot.organization.capabilities).toEqual([
      { title: "Capability statement", text: "ServiceNow ITSM implementation and help desk modernization." },
      { title: "Cloud practice", text: "Cloud migration for civilian agencies." },
    ]);
    expect(snapshot.candidate.matchedKeyword).toBe("ServiceNow");
    expect(sent[0]!.system).toContain("A NAICS match or set-aside eligibility only makes a notice eligible; on its own it is never a reason to pursue.");
    expect(sent[0]!.system).toContain("how sure you are of the recommendation, not the chance of winning");
  });
});
