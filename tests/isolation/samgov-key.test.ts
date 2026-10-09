/**
 * BL-STAB-7b — a company's own SAM.gov key, against Postgres with fetch
 * stubbed (two tenants): saved only after SAM.gov recognises it,
 * encrypted and bound to its company, audited with the last four only,
 * used for that company's searches and never another's; unreadable or
 * removed keys fall back to FORGE's shared key; tests are rate-limited.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, organizationSamgovKeys } from "@/db/schema";
import { getSamKeyStatus, removeCompanySamKey, resolveSamCredential, setCompanySamKey } from "@/lib/samgov-key";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const sessionUserStub = {
  id: "PLACEHOLDER",
  email: "admin@samkey.test",
  name: "Company Admin",
  image: null as null,
  isSuperadmin: false as const,
  organizationId: "PLACEHOLDER",
  role: "admin" as const,
};
const flags = { impersonating: false };
vi.mock("@/lib/auth-helpers", () => ({
  requireAuth: async () => sessionUserStub,
  requireCurrentOrg: async () => ({ user: sessionUserStub, organizationId: sessionUserStub.organizationId, isImpersonating: flags.impersonating }),
  requireOrgAdmin: async () => sessionUserStub,
  getSessionUser: async () => sessionUserStub,
}));

import { loadSamGovOpportunitiesAction } from "@/app/(app)/opportunities/import/actions";
import { setCompanySamKeyAction } from "@/app/(app)/settings/integrations/samgov-key-actions";

const KEY_A = "CompanyAkey0123456789abcdefghijklmnopAAAA";
const RING = `k1:${randomBytes(32).toString("base64")}`;
const SHARED = "SharedKey0123456789abcdefghijklmnopqSHRD";
const OWNER_BODY = "<html><body><h1>API_KEY_INVALID</h1></body></html>";

function stubFetch(status: number, body = "{}"): URL[] {
  const calls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string) => {
      calls.push(new URL(String(input)));
      return new Response(status === 200 ? JSON.stringify({ totalRecords: 0, opportunitiesData: [] }) : body, { status });
    }),
  );
  return calls;
}

describe("BL-STAB-7b — a company's own SAM.gov key", () => {
  let fx: TwoTenantFixture;
  const actorA = () => ({ userId: fx.orgA.userId, email: "a@test" });

  beforeEach(async () => {
    fx = await createTwoTenants("samgov-key");
    sessionUserStub.id = fx.orgA.userId;
    sessionUserStub.organizationId = fx.orgA.organizationId;
    flags.impersonating = false;
    vi.stubEnv("FORGE_SECRET_KEYS", RING);
    vi.stubEnv("SAMGOV_API_KEY", SHARED);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await fx.cleanup();
  });

  const rowsFor = (organizationId: string) => db.select().from(organizationSamgovKeys).where(eq(organizationSamgovKeys.organizationId, organizationId));
  const auditsFor = (organizationId: string, action: string) =>
    db
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.action, action)));

  it("saves a recognised key for its company only, encrypted, and uses it there alone", async () => {
    const calls = stubFetch(200);
    const res = await setCompanySamKey({ organizationId: fx.orgA.organizationId, rawKey: ` ${KEY_A} `, actor: actorA() });
    expect(res).toEqual({ ok: true, message: "Saved. SAM.gov accepted the key (••••AAAA); FORGE uses it for your company from now on." });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.searchParams.get("api_key")).toBe(KEY_A);

    const [row] = await rowsFor(fx.orgA.organizationId);
    expect(row).toMatchObject({ keyId: "k1", last4: "AAAA", status: "ok" });
    expect(row!.verifiedAt).not.toBeNull();
    expect(row!.ciphertext).not.toContain(KEY_A);
    const audits = await auditsFor(fx.orgA.organizationId, "settings.samgov_key.set");
    expect(audits).toEqual([{ metadata: { last4: "AAAA", previousLast4: null, status: "ok" } }]);
    expect(JSON.stringify(audits)).not.toContain(KEY_A);
    expect(await rowsFor(fx.orgB.organizationId)).toHaveLength(0);

    const a = await resolveSamCredential(fx.orgA.organizationId);
    expect(a.ok && [a.cred.source, a.cred.revealForSamRequest()]).toEqual(["company", KEY_A]);
    const b = await resolveSamCredential(fx.orgB.organizationId);
    expect(b.ok && [b.cred.source, b.cred.revealForSamRequest()]).toEqual(["platform", SHARED]);
    expect(await getSamKeyStatus(fx.orgA.organizationId)).toMatchObject({ inUse: "company", usable: true, canSave: true, company: { last4: "AAAA", readable: true, setByName: expect.any(String) } });

    // A company request path sends A's key, and only to SAM.gov.
    const search = stubFetch(200);
    await loadSamGovOpportunitiesAction({ keyword: "cyber" });
    expect(search.map((u) => [u.hostname, u.searchParams.get("api_key")])).toEqual([["api.sam.gov", KEY_A]]);

    vi.stubEnv("SAMGOV_API_KEY", "");
    const none = await resolveSamCredential(fx.orgB.organizationId);
    expect(none).toMatchObject({ ok: false, failure: { cls: "missing_key" } });
  });

  it("refuses a key SAM.gov rejects or can't check, keeps the one in use, and rate-limits tests", async () => {
    stubFetch(200);
    await setCompanySamKey({ organizationId: fx.orgA.organizationId, rawKey: KEY_A, actor: actorA() });
    const other = "OtherKey0123456789abcdefghijklmnopqrBBBB";

    stubFetch(401, OWNER_BODY);
    expect(await setCompanySamKey({ organizationId: fx.orgA.organizationId, rawKey: other, actor: actorA() })).toEqual({
      ok: false,
      error: "SAM.gov rejected this key: it is invalid, expired or not yet active. Nothing was saved. Your current key (••••AAAA) is still in use.",
    });
    expect(await auditsFor(fx.orgA.organizationId, "settings.samgov_key.test_failed")).toEqual([{ metadata: { last4: "BBBB", result: "key_invalid" } }]);
    stubFetch(503);
    expect((await setCompanySamKey({ organizationId: fx.orgA.organizationId, rawKey: other, actor: actorA() })).ok).toBe(false);
    expect((await rowsFor(fx.orgA.organizationId))[0]).toMatchObject({ last4: "AAAA", status: "ok" });

    stubFetch(429, "<h1>OVER_RATE_LIMIT</h1>");
    const limited = await setCompanySamKey({ organizationId: fx.orgA.organizationId, rawKey: other, actor: actorA() });
    expect(limited.ok && limited.message).toMatch(/^Saved \(••••BBBB\), but SAM\.gov says this key's request limit/);
    expect((await rowsFor(fx.orgA.organizationId))[0]).toMatchObject({ last4: "BBBB", status: "rate_limited", verifiedAt: null });

    // Five tests per company per hour: the sixth is refused before SAM.gov is asked.
    stubFetch(200);
    expect((await setCompanySamKey({ organizationId: fx.orgA.organizationId, rawKey: KEY_A, actor: actorA() })).ok).toBe(true);
    const sixth = stubFetch(200);
    const refused = await setCompanySamKey({ organizationId: fx.orgA.organizationId, rawKey: KEY_A, actor: actorA() });
    expect(refused.ok || refused.error).toMatch(/^Too many key tests for your company in the last hour/);
    expect(sixth).toHaveLength(0);
  });

  it("without a keyring (or on a preview) nothing is saved or read; removal still works", async () => {
    stubFetch(200);
    await setCompanySamKey({ organizationId: fx.orgA.organizationId, rawKey: KEY_A, actor: actorA() });
    const [saved] = await rowsFor(fx.orgA.organizationId);

    // A's ciphertext copied into B's row does not decrypt for B.
    await db.insert(organizationSamgovKeys).values({ organizationId: fx.orgB.organizationId, ciphertext: saved!.ciphertext, keyId: "k1", last4: "AAAA" });
    const copied = await resolveSamCredential(fx.orgB.organizationId);
    expect(copied.ok && copied.cred.revealForSamRequest()).toBe(SHARED);

    // The preview case keeps the valid ring: only the preview rule can refuse it.
    for (const env of [{ FORGE_SECRET_KEYS: "" }, { FORGE_SECRET_KEYS: RING, VERCEL_ENV: "preview" }]) {
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
      const calls = stubFetch(200);
      expect((await setCompanySamKey({ organizationId: fx.orgA.organizationId, rawKey: KEY_A, actor: actorA() })).ok).toBe(false);
      expect(calls).toHaveLength(0);
      const a = await resolveSamCredential(fx.orgA.organizationId);
      expect(a.ok && a.cred.source).toBe("platform");
      expect(await getSamKeyStatus(fx.orgA.organizationId)).toMatchObject({ inUse: "platform", canSave: false, company: { readable: false } });
      vi.unstubAllEnvs();
      vi.stubEnv("SAMGOV_API_KEY", SHARED);
    }

    vi.stubEnv("FORGE_SECRET_KEYS", "");
    expect(await removeCompanySamKey({ organizationId: fx.orgB.organizationId, actor: { userId: fx.orgB.userId } })).toEqual({ ok: true, removed: true });
    expect(await rowsFor(fx.orgA.organizationId)).toHaveLength(1);
    expect(await removeCompanySamKey({ organizationId: fx.orgA.organizationId, actor: actorA() })).toEqual({ ok: true, removed: true });
    expect(await auditsFor(fx.orgA.organizationId, "settings.samgov_key.remove")).toEqual([{ metadata: { last4: "AAAA" } }]);
    expect(await getSamKeyStatus(fx.orgA.organizationId)).toMatchObject({ inUse: "platform", company: null });
  });

  it("the save action is refused while a platform admin impersonates the company", async () => {
    flags.impersonating = true;
    const calls = stubFetch(200);
    expect(await setCompanySamKeyAction({ key: KEY_A })).toEqual({ ok: false, error: "Read-only while impersonating." });
    expect(calls).toHaveLength(0);
    expect(await rowsFor(fx.orgA.organizationId)).toHaveLength(0);
  });
});
