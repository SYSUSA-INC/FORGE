/**
 * BL-MFA-ADMIN — Administration → Security against Postgres, two
 * tenants: a company admin sees only their own members' methods, and can
 * reset a member of theirs alone (methods and codes removed, sessions
 * ended, emailed, audited in this company) — never another company's
 * person, someone who also belongs to another company, a platform
 * administrator, or themselves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships, userMfaFactors, userRecoveryCodes, users } from "@/db/schema";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const mails: { to: string; byCompanyAdmin?: boolean }[] = [];
vi.mock("@/lib/email", async (orig) => ({
  ...(await orig<typeof import("@/lib/email")>()),
  emailConfigured: () => true,
  sendMfaResetEmail: async (o: { to: string; byCompanyAdmin?: boolean }) => void mails.push(o),
}));
const { companyMemberSecurity, resetMemberSecondStep } = await import("@/lib/company-security");

const REASON = "Lost phone; confirmed by a call with their manager";

describe("BL-MFA-ADMIN — company security", () => {
  let fx: TwoTenantFixture;
  const member = "cs-member";
  const shared = "cs-shared";
  const platform = "cs-platform";

  beforeEach(async () => {
    mails.length = 0;
    fx = await createTwoTenants("company-security");
    await db.insert(users).values([
      { id: member, name: "Mia Member", email: "cs-member@bl19-isolation.test", emailVerified: new Date(), mfaEnrolledAt: new Date() },
      { id: shared, name: "Sam Shared", email: "cs-shared@bl19-isolation.test", emailVerified: new Date(), mfaEnrolledAt: new Date() },
      { id: platform, name: "Pat Platform", email: "cs-platform@bl19-isolation.test", emailVerified: new Date(), mfaEnrolledAt: new Date(), isSuperadmin: true },
    ]);
    await db.insert(memberships).values([
      { userId: member, organizationId: fx.orgA.organizationId, role: "proposal", status: "active" },
      { userId: shared, organizationId: fx.orgA.organizationId, role: "proposal", status: "active" },
      { userId: shared, organizationId: fx.orgB.organizationId, role: "admin", status: "active" },
      { userId: platform, organizationId: fx.orgA.organizationId, role: "admin", status: "active" },
    ]);
    for (const u of [member, shared, platform, fx.orgB.userId]) {
      await db.insert(userMfaFactors).values([
        { userId: u, kind: "passkey", label: "Laptop", credentialId: `${u}-cred`, publicKey: "pk", rpId: "www.forgeaxi.com", confirmedAt: new Date() },
        { userId: u, kind: "totp", label: "Phone", confirmedAt: new Date() },
      ]);
      await db.insert(userRecoveryCodes).values([{ userId: u, codeHash: "h1" }, { userId: u, codeHash: "h2" }]);
    }
  });

  afterEach(async () => {
    await db.delete(users).where(inArray(users.id, [member, shared, platform]));
    await fx.cleanup();
  });

  const actor = () => ({ userId: fx.orgA.userId, email: null });

  it("lists only this company's members, with their methods and codes", async () => {
    const rows = await companyMemberSecurity(fx.orgA.organizationId);
    expect(rows.map((r) => r.userId).sort()).toEqual([fx.orgA.userId, member, platform, shared].sort());
    expect(rows.find((r) => r.userId === member)).toMatchObject({ passkeys: 1, apps: 1, recoveryCodesLeft: 2, otherWorkspaces: 0 });
    expect(rows.find((r) => r.userId === shared)!.otherWorkspaces).toBe(1);
    expect(rows.some((r) => r.userId === fx.orgB.userId)).toBe(false);
  });

  it("resets a member of this company alone: methods and codes gone, sessions ended, emailed, audited here", async () => {
    const [before] = await db.select({ sv: users.sessionVersion }).from(users).where(eq(users.id, member));
    const res = await resetMemberSecondStep({ organizationId: fx.orgA.organizationId, actor: actor(), userId: member, reason: REASON });
    expect(res).toMatchObject({ ok: true, emailSent: true });
    expect(await db.select().from(userMfaFactors).where(eq(userMfaFactors.userId, member))).toHaveLength(0);
    expect(await db.select().from(userRecoveryCodes).where(eq(userRecoveryCodes.userId, member))).toHaveLength(0);
    const [after] = await db.select({ sv: users.sessionVersion, enrolled: users.mfaEnrolledAt }).from(users).where(eq(users.id, member));
    expect(after!.sv).toBe(before!.sv + 1);
    expect(after!.enrolled).toBeNull();
    expect(mails).toEqual([expect.objectContaining({ to: "cs-member@bl19-isolation.test", byCompanyAdmin: true })]);
    const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "user.mfa.reset")));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ reason: REASON, companyAdmin: true, factorsRemoved: 2 });
  });

  it("refuses another company's person, a shared member, a platform admin, yourself, and a short reason, changing nothing", async () => {
    const tries = [
      { userId: fx.orgB.userId, error: /not a member/ },
      { userId: shared, error: /another company/ },
      { userId: platform, error: /platform administrator/ },
      { userId: fx.orgA.userId, error: /your own/ },
    ];
    for (const t of tries) {
      const res = await resetMemberSecondStep({ organizationId: fx.orgA.organizationId, actor: actor(), userId: t.userId, reason: REASON });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(t.error);
    }
    expect((await resetMemberSecondStep({ organizationId: fx.orgA.organizationId, actor: actor(), userId: member, reason: "lost" })).ok).toBe(false);
    const left = await db.select({ userId: userMfaFactors.userId }).from(userMfaFactors).where(inArray(userMfaFactors.userId, [member, shared, platform, fx.orgB.userId]));
    expect(left).toHaveLength(8);
    expect(mails).toHaveLength(0);
  });
});
