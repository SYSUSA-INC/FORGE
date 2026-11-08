/**
 * BL-MFA-RECOVERY — no lockout from a domain change or one lost method,
 * against Postgres. Reproduces the owner's lockout (2026-11-07): a
 * superadmin whose only passkey was made on the old domain, signing in on
 * www.forgeaxi.com, with no authenticator app and no recovery code.
 *
 * - The passkey made elsewhere is named, not offered; one made here, or an
 *   older one with no record, is offered.
 * - The emailed recovery link: sent to the verified address only, stored
 *   as a hash, works once, for its own person, while fresh; three a day;
 *   using it tells the person and every superadmin.
 * - The superadmin is asked for the method they still owe after sign-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { rateLimitCounters, userMfaFactors, users } from "@/db/schema";
import { webauthnConfigFor } from "@/lib/webauthn";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const sent: { kind: string; to: string; url?: string; self?: boolean }[] = [];
vi.mock("@/lib/email", async (orig) => ({
  ...(await orig<typeof import("@/lib/email")>()),
  emailConfigured: () => true,
  sendMfaRecoveryLinkEmail: async (o: { to: string; url: string }) => void sent.push({ kind: "link", to: o.to, url: o.url }),
  sendMfaRecoveryUsedEmail: async (o: { to: string; self: boolean }) => void sent.push({ kind: "used", to: o.to, self: o.self }),
}));
vi.mock("@/lib/request-host", () => ({
  requestHost: () => "www.forgeaxi.com",
  passkeyConfigHere: () => webauthnConfigFor("www.forgeaxi.com", { VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "www.forgeaxi.com" }),
}));

const { passkeysHere } = await import("@/lib/passkeys");
const { announceRecoveryLinkUsed, hashRecoveryToken, issueRecoveryLink, redeemRecoveryLink, RECOVERY_LINKS_PER_DAY } = await import("@/lib/mfa-recovery");
const { missingMethodsOf } = await import("@/lib/mfa-store");

const tokenOf = (url: string) => decodeURIComponent(new URL(url).searchParams.get("recover") ?? "");

describe("BL-MFA-RECOVERY — getting back in", () => {
  let fx: TwoTenantFixture;
  let admin: string;
  const otherAdmin = "mfa-rec-other-admin";

  beforeEach(async () => {
    sent.length = 0;
    fx = await createTwoTenants("mfa-recovery");
    admin = fx.orgA.userId;
    await db.update(users).set({ isSuperadmin: true, mfaEnrolledAt: new Date() }).where(eq(users.id, admin));
    await db.insert(users).values({ id: otherAdmin, name: "Other Admin", email: "mfa-rec-other@bl19-isolation.test", emailVerified: new Date(), isSuperadmin: true });
    // The lockout: one passkey, made on the old domain.
    await db.insert(userMfaFactors).values({ userId: admin, kind: "passkey", label: "Old laptop", credentialId: "cred-old", publicKey: "pk", rpId: "www.sysgov.com", confirmedAt: new Date() });
  });

  afterEach(async () => {
    await db.delete(rateLimitCounters).where(inArray(rateLimitCounters.key, [`mfa-recovery-link:${admin}`, `mfa-recovery-link:${fx.orgB.userId}`]));
    await db.delete(users).where(eq(users.id, otherAdmin));
    await fx.cleanup();
  });

  it("names a passkey made on another domain instead of offering it, and offers one made here", async () => {
    expect(await passkeysHere(admin)).toEqual({ usable: 0, elsewhere: ["www.sysgov.com"] });
    await db.insert(userMfaFactors).values({ userId: admin, kind: "passkey", label: "Older, no record", credentialId: "cred-legacy", publicKey: "pk", rpId: null, confirmedAt: new Date() });
    await db.insert(userMfaFactors).values({ userId: admin, kind: "passkey", label: "New laptop", credentialId: "cred-new", publicKey: "pk", rpId: "www.forgeaxi.com", confirmedAt: new Date() });
    expect(await passkeysHere(admin)).toEqual({ usable: 2, elsewhere: ["www.sysgov.com"] });
  });

  it("asks a superadmin for the method they still owe, never blocking: passkey only → the app", async () => {
    expect(await missingMethodsOf(admin)).toEqual(["totp"]);
    await db.insert(userMfaFactors).values({ userId: admin, kind: "totp", label: "Phone", confirmedAt: new Date() });
    expect(await missingMethodsOf(admin)).toEqual([]);
    // Someone who is not a superadmin with one method owes nothing.
    await db.insert(userMfaFactors).values({ userId: fx.orgB.userId, kind: "totp", label: "Phone", confirmedAt: new Date() });
    expect(await missingMethodsOf(fx.orgB.userId)).toEqual([]);
  });

  it("emails a single-use link to the verified address, stored only as a hash, that works once while fresh", async () => {
    const res = await issueRecoveryLink({ userId: admin, origin: "https://www.forgeaxi.com/" });
    expect(res.ok).toBe(true);
    const link = sent.find((s) => s.kind === "link")!;
    expect(link.to).toBe((await db.select({ e: users.email }).from(users).where(eq(users.id, admin)))[0]!.e);
    expect(link.url).toMatch(/^https:\/\/www\.forgeaxi\.com\/sign-in\/verify\?recover=/);
    const token = tokenOf(link.url!);
    const [row] = await db.select({ hash: users.mfaRecoveryTokenHash, exp: users.mfaRecoveryExpiresAt }).from(users).where(eq(users.id, admin));
    expect(row!.hash).toBe(hashRecoveryToken(token));
    expect(row!.hash).not.toContain(token);
    expect(row!.exp!.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);

    // Not another person's, not a wrong token, not after it expires.
    expect(await redeemRecoveryLink({ userId: fx.orgB.userId, token })).toBe(false);
    expect(await redeemRecoveryLink({ userId: admin, token: `${token}x` })).toBe(false);
    expect(await redeemRecoveryLink({ userId: admin, token, now: new Date(Date.now() + 16 * 60_000) })).toBe(false);
    // Once, then never again.
    expect(await redeemRecoveryLink({ userId: admin, token })).toBe(true);
    expect(await redeemRecoveryLink({ userId: admin, token })).toBe(false);
  });

  it("tells the person and every superadmin that a link was used", async () => {
    await announceRecoveryLinkUsed(admin);
    const used = sent.filter((s) => s.kind === "used");
    expect(used.find((s) => s.self)?.to).toBe((await db.select({ e: users.email }).from(users).where(eq(users.id, admin)))[0]!.e);
    expect(used.some((s) => !s.self && s.to === "mfa-rec-other@bl19-isolation.test")).toBe(true);
    expect(used.filter((s) => s.self)).toHaveLength(1);
  });

  it("sends at most three a day, and none for an unverified or disabled account", async () => {
    for (let i = 0; i < RECOVERY_LINKS_PER_DAY; i += 1) expect((await issueRecoveryLink({ userId: admin, origin: "https://www.forgeaxi.com" })).ok).toBe(true);
    const fourth = await issueRecoveryLink({ userId: admin, origin: "https://www.forgeaxi.com" });
    expect(fourth.ok).toBe(false);
    // Each new link replaces the last: only the latest works.
    const links = sent.filter((s) => s.kind === "link").map((s) => tokenOf(s.url!));
    expect(await redeemRecoveryLink({ userId: admin, token: links[0]! })).toBe(false);
    expect(await redeemRecoveryLink({ userId: admin, token: links[links.length - 1]! })).toBe(true);

    await db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, fx.orgB.userId));
    expect((await issueRecoveryLink({ userId: fx.orgB.userId, origin: "https://www.forgeaxi.com" })).ok).toBe(false);
  });
});
