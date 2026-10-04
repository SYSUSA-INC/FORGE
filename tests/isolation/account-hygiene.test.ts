/**
 * BL-AUTH-ABUSE Slice 1 — removing accounts, against Postgres: the delete
 * guards hold, a deleted member's workspace keeps its data and hears
 * about it, a sole workspace goes only when asked, and the bulk purge
 * takes exactly the unverified, old, alone accounts it previewed.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships, organizations, proposals, users } from "@/db/schema";
import { deleteUserAccount, listUnverifiedPurgeCandidates, purgeUnverifiedAccounts } from "@/lib/account-hygiene";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const DAY = 86_400_000;

describe("BL-AUTH-ABUSE — deleting and purging accounts", () => {
  let fx: TwoTenantFixture;
  const tag = `hyg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const extraUsers: string[] = [];
  const extraOrgs: string[] = [];

  async function user(id: string, opts: { verified: boolean; ageDays: number; superadmin?: boolean }) {
    const full = `${tag}-${id}`;
    await db.insert(users).values({
      id: full,
      name: `Test ${id}`,
      email: `${full}@hygiene.test`,
      emailVerified: opts.verified ? new Date() : null,
      isSuperadmin: !!opts.superadmin,
      createdAt: new Date(Date.now() - opts.ageDays * DAY),
    });
    extraUsers.push(full);
    return full;
  }

  async function workspace(name: string, ownerId: string) {
    const [org] = await db.insert(organizations).values({ name, slug: `${tag}-${name}`.toLowerCase().slice(0, 60) }).returning({ id: organizations.id });
    extraOrgs.push(org!.id);
    await db.insert(memberships).values({ userId: ownerId, organizationId: org!.id, role: "admin", status: "active" });
    return org!.id;
  }

  beforeEach(async () => {
    fx = await createTwoTenants("hygiene");
  });

  afterEach(async () => {
    if (extraOrgs.length) await db.delete(organizations).where(inArray(organizations.id, extraOrgs.splice(0)));
    if (extraUsers.length) await db.delete(users).where(inArray(users.id, extraUsers.splice(0)));
    await fx.cleanup();
  });

  it("guards the delete, keeps shared workspaces and removes a sole one only when asked", async () => {
    const actor = { id: fx.orgA.userId, email: "a@test", organizationId: fx.orgA.organizationId };
    expect(await deleteUserAccount({ userId: fx.orgA.userId, actor, deleteSoleWorkspaces: true })).toEqual({ ok: false, error: "You cannot delete your own account." });
    const admin = await user("root", { verified: true, ageDays: 1, superadmin: true });
    expect(await deleteUserAccount({ userId: admin, actor, deleteSoleWorkspaces: true })).toEqual({ ok: false, error: "Revoke superadmin before deleting this account." });
    expect(await deleteUserAccount({ userId: `${tag}-nobody`, actor, deleteSoleWorkspaces: true })).toEqual({ ok: false, error: "User not found." });

    // B's only admin, with a colleague: blocked until the colleague is gone.
    const colleague = await user("colleague", { verified: true, ageDays: 3 });
    await db.insert(memberships).values({ userId: colleague, organizationId: fx.orgB.organizationId, role: "author", status: "active" });
    const blocked = await deleteUserAccount({ userId: fx.orgB.userId, actor, deleteSoleWorkspaces: true });
    expect(blocked.ok).toBe(false);
    expect((blocked as { error: string }).error).toMatch(/only admin of/);

    // The colleague goes; B and its data stay and B's log says so.
    expect(await deleteUserAccount({ userId: colleague, actor, deleteSoleWorkspaces: true })).toEqual({ ok: true, deletedWorkspaces: [] });
    expect(await db.select({ id: users.id }).from(users).where(eq(users.id, colleague))).toEqual([]);
    expect(await db.select({ id: proposals.id }).from(proposals).where(eq(proposals.id, fx.orgB.proposalId))).toHaveLength(1);
    const bLog = await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgB.organizationId), eq(auditLogs.action, "user.delete")));
    expect(bLog).toHaveLength(1);

    // A lone account keeps its workspace unless asked; asked, it goes too.
    const loner = await user("loner", { verified: true, ageDays: 5 });
    const lonerOrg = await workspace("Loner Co", loner);
    expect(await deleteUserAccount({ userId: loner, actor, deleteSoleWorkspaces: false })).toEqual({ ok: true, deletedWorkspaces: [] });
    expect(await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, lonerOrg))).toHaveLength(1);

    const solo = await user("solo", { verified: false, ageDays: 5 });
    const soloOrg = await workspace("Solo Co", solo);
    expect(await deleteUserAccount({ userId: solo, actor, deleteSoleWorkspaces: true })).toEqual({ ok: true, deletedWorkspaces: [{ id: soloOrg, name: "Solo Co" }] });
    expect(await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, soloOrg))).toEqual([]);

    // Tenant A untouched; every delete recorded in the acting admin's log.
    expect(await db.select({ id: proposals.id }).from(proposals).where(eq(proposals.id, fx.orgA.proposalId))).toHaveLength(1);
    const aLog = await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "user.delete")));
    expect(aLog).toHaveLength(3);
  });

  it("purges only unverified, old accounts alone in their workspaces — and only those previewed", async () => {
    const actor = { id: fx.orgA.userId, email: "a@test", organizationId: fx.orgA.organizationId };
    const bot = await user("bot", { verified: false, ageDays: 30 });
    const botOrg = await workspace("Bot Co", bot);
    const bare = await user("bare", { verified: false, ageDays: 30 });
    const fresh = await user("fresh", { verified: false, ageDays: 1 });
    await workspace("Fresh Co", fresh);
    const real = await user("real", { verified: true, ageDays: 30 });
    const invited = await user("invited", { verified: false, ageDays: 30 });
    await db.insert(memberships).values({ userId: invited, organizationId: fx.orgA.organizationId, role: "author", status: "active" });
    const unlisted = await user("unlisted", { verified: false, ageDays: 30 });

    const ours = new Set([bot, bare, fresh, real, invited, unlisted]);
    const preview = await listUnverifiedPurgeCandidates({ olderThanDays: 7 });
    const mine = preview.candidates.filter((c) => ours.has(c.id));
    expect(mine.map((c) => c.id).sort()).toEqual([bare, bot, unlisted].sort());
    expect(mine.find((c) => c.id === bot)!.workspaces).toEqual([{ id: botOrg, name: "Bot Co" }]);
    expect(preview.sharedWorkspace).toBeGreaterThanOrEqual(1);

    // The admin confirms bot, bare, and two that are not eligible; "unlisted" was never confirmed.
    const res = await purgeUnverifiedAccounts({ olderThanDays: 7, userIds: [bot, bare, fresh, invited], actor });
    expect(res).toEqual({ deleted: 2, workspacesDeleted: 1, skipped: 2 });
    const left = await db.select({ id: users.id }).from(users).where(inArray(users.id, [...ours]));
    expect(left.map((u) => u.id).sort()).toEqual([fresh, real, invited, unlisted].sort());
    expect(await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, botOrg))).toEqual([]);
    expect(await db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.organizationId, fx.orgA.organizationId), eq(memberships.userId, invited)))).toHaveLength(1);

    const audits = await db.select({ action: auditLogs.action, metadata: auditLogs.metadata }).from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "user.purge_unverified")));
    expect(audits).toHaveLength(1);
    expect((audits[0]!.metadata as { deleted: number }).deleted).toBe(2);

    // Nothing confirmed, nothing deleted.
    expect(await purgeUnverifiedAccounts({ olderThanDays: 7, userIds: [], actor })).toEqual({ deleted: 0, workspacesDeleted: 0, skipped: 0 });
  });
});
