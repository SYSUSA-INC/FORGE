/**
 * BL-16 apiAccess — workspace API tokens and the read-only /api/v1 API,
 * against Postgres and through the real route handlers. A token reads
 * only its own workspace; another workspace's ids are 404s; the plan
 * gate, revoking and expiry all refuse; list paging is complete and
 * stable when rows share a timestamp; creates, revokes and reads are
 * audited.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiTokens, auditLogs, opportunities, proposalSections, tenantSubscriptions } from "@/db/schema";
import { createApiToken, revokeApiToken } from "@/lib/api-tokens";
import { GET as getMe } from "@/app/api/v1/me/route";
import { GET as listOpps } from "@/app/api/v1/opportunities/route";
import { GET as getOpp } from "@/app/api/v1/opportunities/[id]/route";
import { GET as listProposals } from "@/app/api/v1/proposals/route";
import { GET as getProposal } from "@/app/api/v1/proposals/[id]/route";
import { GET as getSection } from "@/app/api/v1/proposals/[id]/sections/[sectionId]/route";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const req = (path: string, token?: string) =>
  new Request(`https://forge.test${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

async function json(res: Response) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe("BL-16 apiAccess — tokens and /api/v1", () => {
  let fx: TwoTenantFixture;
  let tiers: { cleanup: () => Promise<void> }[] = [];
  const tag = Date.now().toString(36);

  beforeEach(async () => {
    fx = await createTwoTenants("api");
    tiers = [
      await createTierAndSubscribe({ organizationId: fx.orgA.organizationId, slug: `api-a-${tag}`, name: "API A", featureFlags: { apiAccess: true } }),
      await createTierAndSubscribe({ organizationId: fx.orgB.organizationId, slug: `api-b-${tag}`, name: "API B" }),
    ];
  });

  afterEach(async () => {
    for (const t of tiers) await t.cleanup();
    await fx.cleanup();
  });

  it("reads only the token's own workspace, and every refusal path holds", async () => {
    const actorA = { userId: fx.orgA.userId, email: "a@test" };
    // B's plan has no API access, so B can't make a token.
    const refusedB = await createApiToken({ organizationId: fx.orgB.organizationId, name: "B sync", expiresInDays: 90, actor: { userId: fx.orgB.userId, email: "b@test" } });
    expect(refusedB).toMatchObject({ ok: false, error: expect.stringMatching(/isn't included/) });

    const made = await createApiToken({ organizationId: fx.orgA.organizationId, name: "CRM sync", expiresInDays: 90, actor: actorA });
    if (!made.ok) throw new Error(made.error);
    const token = made.token;
    const [stored] = await db.select().from(apiTokens).where(and(eq(apiTokens.id, made.id), eq(apiTokens.organizationId, fx.orgA.organizationId)));
    expect(stored!.tokenHash).not.toContain(token.slice(6));
    expect(stored!.tokenPrefix).toBe(token.slice(0, 12));

    const me = await json(await getMe(req("/api/v1/me", token)));
    expect(me).toMatchObject({ status: 200, body: { organization: { id: fx.orgA.organizationId }, token: { name: "CRM sync" } } });

    const opps = await json(await listOpps(req("/api/v1/opportunities", token)));
    expect(opps.status).toBe(200);
    expect(opps.body.data.map((o: { id: string }) => o.id)).toEqual([fx.orgA.opportunityId]);

    // Another workspace's ids are simply not there.
    const ctx = (id: string) => ({ params: { id } });
    expect((await getOpp(req(`/api/v1/opportunities/${fx.orgB.opportunityId}`, token), ctx(fx.orgB.opportunityId))).status).toBe(404);
    expect((await getProposal(req(`/api/v1/proposals/${fx.orgB.proposalId}`, token), ctx(fx.orgB.proposalId))).status).toBe(404);
    expect((await getProposal(req("/api/v1/proposals/not-a-uuid", token), ctx("not-a-uuid"))).status).toBe(404);
    const own = await json(await getProposal(req(`/api/v1/proposals/${fx.orgA.proposalId}`, token), ctx(fx.orgA.proposalId)));
    expect(own).toMatchObject({ status: 200, body: { data: { id: fx.orgA.proposalId, opportunityId: fx.orgA.opportunityId, sections: [] } } });
    const props = await json(await listProposals(req("/api/v1/proposals?stage=draft", token)));
    expect(props.body.data.map((p: { id: string }) => p.id)).toEqual([fx.orgA.proposalId]);
    expect((await listProposals(req("/api/v1/proposals?stage=bogus", token))).status).toBe(400);

    // Unauthenticated and unknown tokens.
    expect((await listOpps(req("/api/v1/opportunities"))).status).toBe(401);
    expect((await listOpps(req("/api/v1/opportunities", `forge_${"z".repeat(43)}`))).status).toBe(401);

    // The plan gate is checked on every request.
    await db.update(tenantSubscriptions).set({ customOverrides: { featureFlags: { apiAccess: false } } }).where(eq(tenantSubscriptions.organizationId, fx.orgA.organizationId));
    expect(await json(await listOpps(req("/api/v1/opportunities", token)))).toMatchObject({ status: 403, body: { error: expect.stringMatching(/isn't included/) } });
    await db.update(tenantSubscriptions).set({ customOverrides: {} }).where(eq(tenantSubscriptions.organizationId, fx.orgA.organizationId));

    const [used] = await db.select({ lastUsedAt: apiTokens.lastUsedAt }).from(apiTokens).where(and(eq(apiTokens.id, made.id), eq(apiTokens.organizationId, fx.orgA.organizationId)));
    expect(used!.lastUsedAt).not.toBeNull();

    // B can't revoke A's token; A can, and then it's refused.
    expect(await revokeApiToken({ organizationId: fx.orgB.organizationId, tokenId: made.id, actor: { userId: fx.orgB.userId, email: "b@test" } })).toMatchObject({ ok: false });
    expect(await revokeApiToken({ organizationId: fx.orgA.organizationId, tokenId: made.id, actor: actorA })).toEqual({ ok: true });
    expect(await json(await listOpps(req("/api/v1/opportunities", token)))).toMatchObject({ status: 401, body: { error: expect.stringMatching(/revoked/) } });

    // An expired token is refused too.
    const second = await createApiToken({ organizationId: fx.orgA.organizationId, name: "BI", expiresInDays: 30, actor: actorA });
    if (!second.ok) throw new Error(second.error);
    await db.update(apiTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(and(eq(apiTokens.id, second.id), eq(apiTokens.organizationId, fx.orgA.organizationId)));
    expect(await json(await getMe(req("/api/v1/me", second.token)))).toMatchObject({ status: 401, body: { error: expect.stringMatching(/expired/) } });

    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    const actions = audits.map((a) => a.action);
    expect(actions.filter((a) => a === "api_token.create")).toHaveLength(2);
    expect(actions).toContain("api_token.revoke");
    // me, the opportunity list, the own proposal, the proposal list — refusals and 404s are not reads.
    expect(actions.filter((a) => a === "api.v1.read")).toHaveLength(4);
    expect(await db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgB.organizationId), eq(auditLogs.action, "api.v1.read")))).toEqual([]);
  });

  it("pages through every row exactly once when rows share a timestamp", async () => {
    const made = await createApiToken({ organizationId: fx.orgA.organizationId, name: "Pager", expiresInDays: 0, actor: { userId: fx.orgA.userId, email: "a@test" } });
    if (!made.ok) throw new Error(made.error);
    // A minute ahead, so updated_since below picks out exactly these four.
    const same = new Date(Date.now() + 60_000);
    await db.insert(opportunities).values([1, 2, 3, 4].map((n) => ({ organizationId: fx.orgA.organizationId, title: `Same-ms ${n}`, updatedAt: same })));

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i++) {
      const q: string = cursor ? `?limit=2&cursor=${cursor}` : "?limit=2";
      const page = await json(await listOpps(req(`/api/v1/opportunities${q}`, made.token)));
      expect(page.status).toBe(200);
      seen.push(...page.body.data.map((o: { id: string }) => o.id));
      cursor = page.body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(seen).toContain(fx.orgA.opportunityId);
    expect(seen).not.toContain(fx.orgB.opportunityId);

    const since = await json(await listOpps(req(`/api/v1/opportunities?updated_since=${encodeURIComponent(same.toISOString())}`, made.token)));
    expect(since.body.data.map((o: { title: string }) => o.title).sort()).toEqual(["Same-ms 1", "Same-ms 2", "Same-ms 3", "Same-ms 4"]);
  });

  it("Slice 2b: returns a section's final text only through its own proposal and workspace", async () => {
    const made = await createApiToken({ organizationId: fx.orgA.organizationId, name: "Docs sync", expiresInDays: 90, actor: { userId: fx.orgA.userId, email: "a@test" } });
    if (!made.ok) throw new Error(made.error);
    const [mine] = await db
      .insert(proposalSections)
      .values({
        proposalId: fx.orgA.proposalId,
        kind: "technical",
        title: "Technical approach",
        instructions: "Describe the approach.",
        bodyDoc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "We deliver " },
                { type: "text", text: "late ", marks: [{ type: "tcDelete", attrs: {} }] },
                { type: "text", text: "on time." },
              ],
            },
          ],
        },
      })
      .returning({ id: proposalSections.id });
    const [theirs] = await db
      .insert(proposalSections)
      .values({ proposalId: fx.orgB.proposalId, kind: "management", title: "B's plan", content: "Secret plan." })
      .returning({ id: proposalSections.id });

    const ctx = (id: string, sectionId: string) => ({ params: { id, sectionId } });
    const path = (p: string, s: string) => `/api/v1/proposals/${p}/sections/${s}`;

    const ok = await json(await getSection(req(path(fx.orgA.proposalId, mine!.id), made.token), ctx(fx.orgA.proposalId, mine!.id)));
    expect(ok).toMatchObject({
      status: 200,
      body: { data: { id: mine!.id, proposalId: fx.orgA.proposalId, title: "Technical approach", instructions: "Describe the approach.", text: "We deliver on time.", hasPendingChanges: true } },
    });
    expect(ok.body.data.html).not.toContain("late");

    // Another workspace's section — by its own proposal id or smuggled under ours — is a 404.
    expect((await getSection(req(path(fx.orgB.proposalId, theirs!.id), made.token), ctx(fx.orgB.proposalId, theirs!.id))).status).toBe(404);
    expect((await getSection(req(path(fx.orgA.proposalId, theirs!.id), made.token), ctx(fx.orgA.proposalId, theirs!.id))).status).toBe(404);
    expect((await getSection(req(path(fx.orgA.proposalId, "nope"), made.token), ctx(fx.orgA.proposalId, "nope"))).status).toBe(404);

    const reads = await db
      .select({ resourceId: auditLogs.resourceId })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "api.v1.read")));
    expect(reads.map((r) => r.resourceId)).toEqual(["proposals.sections.get"]);
  });
});
