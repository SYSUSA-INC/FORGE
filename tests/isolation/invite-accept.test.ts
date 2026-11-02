/**
 * BL-AUTH-INVITE — accepting pending invitations by verified email
 * (the OAuth / existing-account path that needs no emailed token).
 *
 * Runtime test against Postgres: provisions two tenants, invites a
 * fresh address into one of them, creates the user as an OAuth sign-in
 * would, and asserts the membership lands in the right tenant only,
 * the invite is consumed, the email is marked verified, and a second
 * pass is a no-op.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { allowlist, memberships, users, verificationTokens } from "@/db/schema";
import { acceptInvite, attachPendingInvitesByEmail } from "@/lib/invite-accept";
import { consumeToken, issueToken, markTokenSent } from "@/lib/tokens";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-AUTH-INVITE — attachPendingInvitesByEmail", () => {
  let fx: TwoTenantFixture;
  const createdUserIds: string[] = [];

  beforeEach(async () => {
    fx = await createTwoTenants("invite-accept");
  });

  afterEach(async () => {
    if (createdUserIds.length > 0) {
      for (const id of createdUserIds) {
        await db.delete(users).where(eq(users.id, id));
      }
      createdUserIds.length = 0;
    }
    await fx.cleanup();
  });

  async function newUser(email: string): Promise<string> {
    const id = `invite-accept-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(users).values({ id, email, name: "Invitee" });
    createdUserIds.push(id);
    return id;
  }

  it("creates the membership in the invited tenant only, consumes the invite and verifies the email", async () => {
    const email = `invitee-${Date.now().toString(36)}@bl-auth.test`;
    const [inv] = await db
      .insert(allowlist)
      .values({
        email,
        organizationId: fx.orgA.organizationId,
        role: "author",
        title: "Writer",
        invitedByUserId: fx.orgA.userId,
      })
      .returning({ id: allowlist.id });

    const userId = await newUser(email.toUpperCase());
    const result = await attachPendingInvitesByEmail({ userId, email: email.toUpperCase() });

    expect(result.attached).toBe(1);
    expect(result.alreadyMember).toBe(0);
    expect(result.organizationIds).toEqual([fx.orgA.organizationId]);

    const rows = await db
      .select({ organizationId: memberships.organizationId, role: memberships.role, title: memberships.title })
      .from(memberships)
      .where(eq(memberships.userId, userId));
    expect(rows).toEqual([
      { organizationId: fx.orgA.organizationId, role: "author", title: "Writer" },
    ]);

    const [consumed] = await db
      .select({ consumedAt: allowlist.consumedAt })
      .from(allowlist)
      .where(and(eq(allowlist.id, inv!.id), eq(allowlist.organizationId, fx.orgA.organizationId)));
    expect(consumed?.consumedAt).not.toBeNull();

    const [u] = await db.select({ emailVerified: users.emailVerified }).from(users).where(eq(users.id, userId));
    expect(u?.emailVerified).not.toBeNull();

    // Org B is untouched and a second pass finds nothing to do.
    const inB = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, fx.orgB.organizationId)));
    expect(inB).toEqual([]);
    const again = await attachPendingInvitesByEmail({ userId, email });
    expect(again).toEqual({ attached: 0, alreadyMember: 0, organizationIds: [] });
  });

  it("BL-AUTH-DOMAIN — skips a cross-domain invite until a platform admin approves it", async () => {
    const email = `held-${Date.now().toString(36)}@other-company.test`;
    const [inv] = await db
      .insert(allowlist)
      .values({
        email,
        organizationId: fx.orgA.organizationId,
        role: "viewer",
        invitedByUserId: fx.orgA.userId,
        crossDomain: true,
      })
      .returning({ id: allowlist.id });
    const userId = await newUser(email);

    // Held: the provider proving the address does not let the tenant have it.
    const held = await attachPendingInvitesByEmail({ userId, email });
    expect(held).toEqual({ attached: 0, alreadyMember: 0, organizationIds: [] });
    const before = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, fx.orgA.organizationId)));
    expect(before).toEqual([]);
    const [stillOpen] = await db
      .select({ consumedAt: allowlist.consumedAt })
      .from(allowlist)
      .where(and(eq(allowlist.id, inv!.id), eq(allowlist.organizationId, fx.orgA.organizationId)));
    expect(stillOpen?.consumedAt).toBeNull();

    // Approved by the platform: the next sign-in picks it up.
    await db
      .update(allowlist)
      .set({ platformApprovedAt: new Date(), platformApprovedByUserId: fx.orgB.userId })
      .where(and(eq(allowlist.id, inv!.id), eq(allowlist.organizationId, fx.orgA.organizationId)));
    const approved = await attachPendingInvitesByEmail({ userId, email });
    expect(approved.attached).toBe(1);
    expect(approved.organizationIds).toEqual([fx.orgA.organizationId]);
  });

  it("ignores revoked and consumed invites and unknown addresses", async () => {
    const email = `revoked-${Date.now().toString(36)}@bl-auth.test`;
    await db.insert(allowlist).values({
      email,
      organizationId: fx.orgA.organizationId,
      role: "viewer",
      revoked: true,
    });
    await db.insert(allowlist).values({
      email,
      organizationId: fx.orgB.organizationId,
      role: "viewer",
      consumedAt: new Date(),
    });
    const userId = await newUser(email);
    const result = await attachPendingInvitesByEmail({ userId, email });
    expect(result.attached).toBe(0);
    const rows = await db.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.userId, userId));
    expect(rows).toEqual([]);
    expect(await attachPendingInvitesByEmail({ userId, email: "" })).toEqual({
      attached: 0,
      alreadyMember: 0,
      organizationIds: [],
    });
  });
});

describe("BL-STAB-8a-0 — acceptInvite never rewrites an existing account", () => {
  let fx: TwoTenantFixture;
  const createdUserIds: string[] = [];
  beforeEach(async () => {
    fx = await createTwoTenants("invite-accept-8a0");
  });
  afterEach(async () => {
    for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
    createdUserIds.length = 0;
    await fx.cleanup();
  });

  async function invite(email: string) {
    const [inv] = await db
      .insert(allowlist)
      .values({ email, organizationId: fx.orgA.organizationId, role: "author", invitedByUserId: fx.orgA.userId })
      .returning({ id: allowlist.id });
    const raw = await issueToken("invite", inv!.id);
    return { id: inv!.id, raw };
  }

  it("refuses the sign-up form for an address that already has an account, spends nothing, and the next sign-in attaches the invite", async () => {
    const email = `taken-${Date.now().toString(36)}@bl-auth.test`;
    const id = `invite-8a0-${Date.now().toString(36)}`;
    await db.insert(users).values({ id, email, name: "Original", passwordHash: "hash-original", emailVerified: new Date() });
    createdUserIds.push(id);
    const inv = await invite(email);

    const res = await acceptInvite({ inviteId: inv.id, rawToken: inv.raw, name: "Impostor", passwordHash: "hash-impostor" });
    expect(res).toMatchObject({ ok: false, status: 409, code: "existing_account" });

    const [u] = await db.select({ name: users.name, passwordHash: users.passwordHash }).from(users).where(eq(users.id, id));
    expect(u).toEqual({ name: "Original", passwordHash: "hash-original" });
    const [row] = await db.select({ consumedAt: allowlist.consumedAt }).from(allowlist).where(eq(allowlist.id, inv.id));
    expect(row?.consumedAt).toBeNull();
    // The token was not spent.
    expect(await consumeToken("invite", inv.id, inv.raw)).toBe(true);

    // The account's own sign-in accepts the invite.
    const attached = await attachPendingInvitesByEmail({ userId: id, email });
    expect(attached.attached).toBe(1);
    const rows = await db.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.userId, id), eq(memberships.organizationId, fx.orgA.organizationId)));
    expect(rows).toEqual([{ role: "author" }]);
  });

  it("creates a new address's account, membership and verified email from an emailed link, and spends the token", async () => {
    const email = `fresh-${Date.now().toString(36)}@bl-auth.test`;
    const inv = await invite(email);
    // BL-STAB-8b-1 — the link went through the inbox.
    await markTokenSent("invite", inv.id);
    const res = await acceptInvite({ inviteId: inv.id, rawToken: inv.raw, name: "Fresh", passwordHash: "hash-fresh" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    createdUserIds.push(res.userId);
    expect(res.verified).toBe(true);
    const [u] = await db.select({ emailVerified: users.emailVerified, passwordHash: users.passwordHash }).from(users).where(eq(users.id, res.userId));
    expect(u?.emailVerified).not.toBeNull();
    expect(u?.passwordHash).toBe("hash-fresh");
    const [row] = await db.select({ consumedAt: allowlist.consumedAt }).from(allowlist).where(eq(allowlist.id, inv.id));
    expect(row?.consumedAt).not.toBeNull();
    expect(await consumeToken("invite", inv.id, inv.raw)).toBe(false);
  });

  it("BL-STAB-8b-1 — a copied invite link creates the account unverified and queues the verification email", async () => {
    const email = `copied-${Date.now().toString(36)}@bl-auth.test`;
    const inv = await invite(email);
    const res = await acceptInvite({ inviteId: inv.id, rawToken: inv.raw, name: "Copied", passwordHash: "hash-copied" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    createdUserIds.push(res.userId);
    expect(res.verified).toBe(false);
    const [u] = await db.select({ emailVerified: users.emailVerified }).from(users).where(eq(users.id, res.userId));
    expect(u?.emailVerified).toBeNull();
    // The membership exists all the same; the verification link was issued (email itself is stubbed here).
    const rows = await db.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.userId, res.userId), eq(memberships.organizationId, fx.orgA.organizationId)));
    expect(rows).toEqual([{ role: "author" }]);
    const [tok] = await db.select({ identifier: verificationTokens.identifier }).from(verificationTokens).where(eq(verificationTokens.identifier, `verify-email:${email}`));
    expect(tok?.identifier).toBe(`verify-email:${email}`);
    await db.delete(verificationTokens).where(eq(verificationTokens.identifier, `verify-email:${email}`));
  });
});
