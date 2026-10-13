/**
 * BL-STAB-7e — platform admins see companies' own SAM.gov keys (never the
 * key) and re-encrypt them after FORGE_SECRET_KEYS is rotated (Postgres):
 * a key on an older entry moves to the first one and still works, one whose
 * entry is missing is counted and left alone, a damaged one fails loudly
 * without touching the row; a removal by a platform admin lands in the
 * company's audit log with its reason.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, organizationSamgovKeys } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const admin = { id: "PLACEHOLDER", email: "ops@forge.test", name: "Ops", image: null as null, isSuperadmin: true as const, organizationId: "PLACEHOLDER", role: "admin" as const };
vi.mock("@/lib/auth-helpers", () => ({
  requireAuth: async () => admin,
  requireSuperadmin: async () => admin,
  requireCurrentOrg: async () => ({ user: admin, organizationId: admin.organizationId, isImpersonating: false }),
  getSessionUser: async () => admin,
}));

import { adminRemoveCompanySamKeyAction, reencryptCompanySamKeysAction } from "@/app/(app)/admin/samgov-keys/actions";
import { listCompanySamKeys } from "@/lib/samgov-key-admin";
import { resolveSamCredential } from "@/lib/samgov-key";

const b64 = () => randomBytes(32).toString("base64");
const K0 = b64();
const K1 = b64();
const K2 = b64();
const KEY_A = "CompanyAkey0123456789abcdefghijklmnopAAAA";
const KEY_B = "CompanyBkey0123456789abcdefghijklmnopBBBB";
const ctx = (organizationId: string) => ({ purpose: "samgov_api_key" as const, organizationId });
const under = (ring: string, key: string, organizationId: string) => encryptSecret(key, ctx(organizationId), { FORGE_SECRET_KEYS: ring, VERCEL_ENV: "production" });

describe("BL-STAB-7e — company SAM.gov keys for platform admins", () => {
  let fx: TwoTenantFixture;
  let fx2: TwoTenantFixture;
  const orgs = () => [fx.orgA.organizationId, fx.orgB.organizationId, fx2.orgA.organizationId];
  beforeEach(async () => {
    fx = await createTwoTenants("samgov-key-admin");
    fx2 = await createTwoTenants("samgov-key-admin-2");
    admin.id = fx.orgA.userId;
    admin.organizationId = fx.orgA.organizationId;
    // The rotated keyring: k2 encrypts, k1 still decrypts, k0 is gone.
    vi.stubEnv("FORGE_SECRET_KEYS", `k2:${K2},k1:${K1}`);
    vi.stubEnv("VERCEL_ENV", "production");
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.delete(organizationSamgovKeys).where(inArray(organizationSamgovKeys.organizationId, orgs()));
    await fx.cleanup();
    await fx2.cleanup();
  });

  it("lists keys without the key, re-encrypts the older ones, and leaves what it can't read", async () => {
    const a = under(`k1:${K1}`, KEY_A, fx.orgA.organizationId);
    const b = under(`k0:${K0}`, KEY_B, fx.orgB.organizationId);
    const c = under(`k2:${K2}`, KEY_A, fx2.orgA.organizationId);
    // Damaged under k1: its tag no longer matches.
    const damaged = under(`k1:${K1}`, KEY_B, fx2.orgB.organizationId);
    const broken = damaged.ciphertext.replace(/\.([^.]+)\.([^.]+)$/, (_, tag: string, body: string) => `.${tag.slice(0, -2)}AA.${body}`);
    await db.insert(organizationSamgovKeys).values([
      { organizationId: fx.orgA.organizationId, ciphertext: a.ciphertext, keyId: a.keyId, last4: "AAAA" },
      { organizationId: fx.orgB.organizationId, ciphertext: b.ciphertext, keyId: b.keyId, last4: "BBBB" },
      { organizationId: fx2.orgA.organizationId, ciphertext: c.ciphertext, keyId: c.keyId, last4: "AAAA" },
      { organizationId: fx2.orgB.organizationId, ciphertext: broken, keyId: "k1", last4: "BBBB" },
    ]);

    const before = (await listCompanySamKeys()).rows.filter((r) => orgs().includes(r.organizationId) || r.organizationId === fx2.orgB.organizationId);
    expect(JSON.stringify(before)).not.toContain(KEY_A.slice(0, 12));
    const flags = Object.fromEntries(before.map((r) => [r.organizationId, [r.keyId, r.readable, r.current]]));
    expect(flags[fx.orgB.organizationId]).toEqual(["k0", false, false]);
    expect(flags[fx2.orgA.organizationId]).toEqual(["k2", true, true]);

    expect(flags[fx.orgA.organizationId]).toEqual(["k1", true, false]);
    // A value that doesn't decrypt under an entry that is there: the entry's value is wrong (or the value damaged).
    expect(before.find((x) => x.organizationId === fx2.orgB.organizationId)).toMatchObject({ readable: false, decrypts: "wrong_entry" });
    expect(before.find((x) => x.organizationId === fx.orgB.organizationId)).toMatchObject({ readable: false, decrypts: "missing_entry" });

    const r = await reencryptCompanySamKeysAction();
    expect(r).toMatchObject({ ok: true, moved: 1, unreadable: 1, mismatched: [{ keyId: "k1", count: 1 }], failed: 0 });
    const rows = await db.select().from(organizationSamgovKeys).where(inArray(organizationSamgovKeys.organizationId, [...orgs(), fx2.orgB.organizationId]));
    const byOrg = new Map(rows.map((x) => [x.organizationId, x]));
    // Moved to k2, and still the company's key.
    expect(byOrg.get(fx.orgA.organizationId)!.keyId).toBe("k2");
    expect(decryptSecret(byOrg.get(fx.orgA.organizationId)!.ciphertext, ctx(fx.orgA.organizationId))).toBe(KEY_A);
    const cred = await resolveSamCredential(fx.orgA.organizationId);
    expect(cred.ok && cred.cred.source).toBe("company");
    // Unreadable and damaged rows are untouched.
    expect(byOrg.get(fx.orgB.organizationId)!.ciphertext).toBe(b.ciphertext);
    expect(byOrg.get(fx2.orgB.organizationId)!.ciphertext).toBe(broken);
    const [audit] = await db.select({ metadata: auditLogs.metadata }).from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "admin.samgov_keys.reencrypt")));
    expect(audit?.metadata).toMatchObject({ moved: 1, unreadable: 1, mismatched: 1, failed: 0 });
    await db.delete(organizationSamgovKeys).where(eq(organizationSamgovKeys.organizationId, fx2.orgB.organizationId));
  });

  it("removes the company's key the admin saw, with the reason in that company's audit log", async () => {
    const b = under(`k2:${K2}`, KEY_B, fx.orgB.organizationId);
    const seenAt = new Date("2026-10-01T10:00:00.123Z");
    await db.insert(organizationSamgovKeys).values({ organizationId: fx.orgB.organizationId, ciphertext: b.ciphertext, keyId: b.keyId, last4: "BBBB", setAt: seenAt });
    const seen = { last4: "BBBB", setAt: seenAt.toISOString() };
    expect(await adminRemoveCompanySamKeyAction({ organizationId: fx.orgB.organizationId, reason: "", expected: seen })).toMatchObject({ ok: false });
    expect(await adminRemoveCompanySamKeyAction({ organizationId: "00000000-0000-0000-0000-000000000000", reason: "Leaked in a ticket", expected: seen })).toEqual({ ok: false, error: "Organization not found." });
    // The company saved a new key since the page loaded: it stays, and nothing is audited.
    expect(await adminRemoveCompanySamKeyAction({ organizationId: fx.orgB.organizationId, reason: "Leaked in a ticket", expected: { last4: "BBBB", setAt: "2026-09-01T00:00:00.000Z" } })).toEqual({
      ok: false,
      error: "The company changed its key since this page loaded; reload and check again.",
    });
    expect(await db.select().from(organizationSamgovKeys).where(eq(organizationSamgovKeys.organizationId, fx.orgB.organizationId))).toHaveLength(1);
    expect(await adminRemoveCompanySamKeyAction({ organizationId: fx.orgB.organizationId, reason: "Leaked in a ticket", expected: seen })).toEqual({ ok: true, removed: true });
    expect(await db.select().from(organizationSamgovKeys).where(eq(organizationSamgovKeys.organizationId, fx.orgB.organizationId))).toEqual([]);
    const audits = await db
      .select({ organizationId: auditLogs.organizationId, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(eq(auditLogs.action, "settings.samgov_key.remove"));
    expect(audits.filter((x) => x.organizationId === fx.orgB.organizationId)).toEqual([
      { organizationId: fx.orgB.organizationId, metadata: { last4: "BBBB", superadmin: true, reason: "Leaked in a ticket" } },
    ]);
  });
});
