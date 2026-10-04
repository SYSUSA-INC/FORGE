/**
 * BL-16 API Slice 2a — a platform admin revokes a tenant's API tokens
 * (one, or all at once) with a reason that lands in that tenant's audit
 * log; the tenant's token list shows "FORGE support" as the revoker; the
 * other tenant's tokens are untouched. The OpenAPI document is served
 * without a token.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiTokens, auditLogs, users } from "@/db/schema";
import { createApiToken, listApiTokens, PLATFORM_REVOKER_LABEL, revokeAllApiTokens, revokeApiToken } from "@/lib/api-tokens";
import { GET as getMe } from "@/app/api/v1/me/route";
import { GET as getOpenApi } from "@/app/api/v1/openapi.json/route";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const req = (path: string, token: string) => new Request(`https://forge.test${path}`, { headers: { authorization: `Bearer ${token}` } });

describe("BL-16 API Slice 2a — platform-admin token revoke + OpenAPI", () => {
  let fx: TwoTenantFixture;
  let tiers: { cleanup: () => Promise<void> }[] = [];
  let adminId = "";
  const tag = Date.now().toString(36);

  beforeEach(async () => {
    fx = await createTwoTenants("apiadm");
    tiers = [
      await createTierAndSubscribe({ organizationId: fx.orgA.organizationId, slug: `apiadm-a-${tag}`, name: "API admin A", featureFlags: { apiAccess: true } }),
      await createTierAndSubscribe({ organizationId: fx.orgB.organizationId, slug: `apiadm-b-${tag}`, name: "API admin B", featureFlags: { apiAccess: true } }),
    ];
    const [admin] = await db
      .insert(users)
      .values({ email: `platform-${tag}-${Math.random().toString(36).slice(2, 8)}@forge.test`, name: "Platform Pat", isSuperadmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
  });

  afterEach(async () => {
    for (const t of tiers) await t.cleanup();
    await fx.cleanup();
    await db.delete(users).where(eq(users.id, adminId));
  });

  it("revokes one token with a reason, shows FORGE support as the revoker, and audits it in the tenant's log", async () => {
    const made = await createApiToken({ organizationId: fx.orgA.organizationId, name: "Leaky sync", expiresInDays: 90, actor: { userId: fx.orgA.userId, email: "a@test" } });
    if (!made.ok) throw new Error(made.error);
    const admin = { userId: adminId, email: "pat@forge.test" };

    // The tenant id scopes the revoke: naming the wrong tenant does nothing.
    expect(await revokeApiToken({ organizationId: fx.orgB.organizationId, tokenId: made.id, actor: admin, platformReason: "wrong tenant" })).toMatchObject({ ok: false });
    expect(await revokeApiToken({ organizationId: fx.orgA.organizationId, tokenId: made.id, actor: admin, platformReason: "Reported leaked in ticket 42" })).toEqual({ ok: true });
    expect((await getMe(req("/api/v1/me", made.token))).status).toBe(401);

    const [row] = await listApiTokens(fx.orgA.organizationId);
    expect(row).toMatchObject({ id: made.id, state: "revoked", revokedBy: PLATFORM_REVOKER_LABEL });

    const [audit] = await db
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "api_token.revoke")));
    expect(audit!.metadata).toMatchObject({ byPlatformAdmin: true, reason: "Reported leaked in ticket 42", name: "Leaky sync" });
  });

  it("a member's own revoke names the member, not FORGE support", async () => {
    const made = await createApiToken({ organizationId: fx.orgA.organizationId, name: "Old BI", expiresInDays: 30, actor: { userId: fx.orgA.userId, email: "a@test" } });
    if (!made.ok) throw new Error(made.error);
    await revokeApiToken({ organizationId: fx.orgA.organizationId, tokenId: made.id, actor: { userId: fx.orgA.userId, email: "a@test" } });
    const [row] = await listApiTokens(fx.orgA.organizationId);
    expect(row!.revokedBy).not.toBe(PLATFORM_REVOKER_LABEL);
    expect(row!.revokedBy).toBeTruthy();
  });

  it("revoke-all ends only this tenant's active tokens and writes one audit row", async () => {
    const actorA = { userId: fx.orgA.userId, email: "a@test" };
    const a1 = await createApiToken({ organizationId: fx.orgA.organizationId, name: "A one", expiresInDays: 90, actor: actorA });
    const a2 = await createApiToken({ organizationId: fx.orgA.organizationId, name: "A two", expiresInDays: 0, actor: actorA });
    const b1 = await createApiToken({ organizationId: fx.orgB.organizationId, name: "B one", expiresInDays: 90, actor: { userId: fx.orgB.userId, email: "b@test" } });
    if (!a1.ok || !a2.ok || !b1.ok) throw new Error("token create failed");
    // An expired token stays "expired" rather than turning into "revoked".
    const a3 = await createApiToken({ organizationId: fx.orgA.organizationId, name: "A old", expiresInDays: 30, actor: actorA });
    if (!a3.ok) throw new Error(a3.error);
    await db.update(apiTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(and(eq(apiTokens.id, a3.id), eq(apiTokens.organizationId, fx.orgA.organizationId)));

    const res = await revokeAllApiTokens({ organizationId: fx.orgA.organizationId, actor: { userId: adminId, email: "pat@forge.test" }, reason: "Compromised integration" });
    expect(res).toEqual({ ok: true, revoked: 2 });

    const states = Object.fromEntries((await listApiTokens(fx.orgA.organizationId)).map((t) => [t.name, t.state]));
    expect(states).toEqual({ "A one": "revoked", "A two": "revoked", "A old": "expired" });
    expect((await getMe(req("/api/v1/me", b1.token))).status).toBe(200);

    const rows = await db
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "api_token.revoke_all")));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toMatchObject({ byPlatformAdmin: true, reason: "Compromised integration", count: 2 });
    expect(
      await db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgB.organizationId), eq(auditLogs.action, "api_token.revoke_all"))),
    ).toEqual([]);

    // Nothing left to revoke: no second audit row.
    expect(await revokeAllApiTokens({ organizationId: fx.orgA.organizationId, actor: { userId: adminId, email: "pat@forge.test" }, reason: "again" })).toEqual({ ok: true, revoked: 0 });
  });

  it("serves the OpenAPI document without a token", async () => {
    const res = await getOpenApi();
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toContain("/opportunities");
  });
});
