/**
 * BL-AUTH-ABUSE Slice 1 — removing accounts that should not exist.
 *
 *   deleteUserAccount              — one account, by a platform admin; the
 *                                    workspaces only they belonged to go
 *                                    with it when asked
 *   listUnverifiedPurgeCandidates  — the bulk clean-up's preview: unverified,
 *                                    older than N days, alone in their
 *                                    workspaces (purgeDecision)
 *   purgeUnverifiedAccounts        — deletes the previewed accounts that are
 *                                    still eligible, and their workspaces
 *
 * Every foreign key to "user" is CASCADE (memberships, sessions, accounts,
 * per-user settings) or SET NULL (authored content stays, unattributed),
 * so deleting the user row is safe for tenant data. Platform-wide by
 * design: callers are superadmin-gated. Server-only.
 */
import "server-only";

import { and, asc, count, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { memberships, organizations, users, verificationTokens } from "@/db/schema";
import {
  PURGE_LIMITS,
  deletionBlocker,
  purgeDecision,
  sanitizePurgeDays,
  soleWorkspaces,
  type DeletionMembership,
  type PurgeMembership,
} from "@/lib/account-hygiene-logic";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";

type Actor = { id: string; email?: string | null; organizationId: string | null };

/** Per-workspace head counts for the given workspaces (any status / active / active admins). */
async function workspaceCounts(organizationIds: string[]) {
  const counts = new Map<string, { total: number; active: number; activeAdmins: number }>();
  if (organizationIds.length === 0) return counts;
  const rows = await db
    .select({
      organizationId: memberships.organizationId,
      total: count(),
      active: sql<number>`count(*) filter (where ${memberships.status} = 'active')`.mapWith(Number),
      activeAdmins: sql<number>`count(*) filter (where ${memberships.status} = 'active' and ${memberships.role} = 'admin')`.mapWith(Number),
    })
    .from(memberships)
    .where(inArray(memberships.organizationId, organizationIds))
    .groupBy(memberships.organizationId);
  for (const r of rows) counts.set(r.organizationId, { total: Number(r.total), active: r.active, activeAdmins: r.activeAdmins });
  return counts;
}

/** The person's memberships with what their departure would do to each workspace. */
export async function membershipsForDeletion(userId: string): Promise<DeletionMembership[]> {
  const rows = await db
    .select({
      organizationId: memberships.organizationId,
      organizationName: organizations.name,
      role: memberships.role,
      status: memberships.status,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(eq(memberships.userId, userId));
  const counts = await workspaceCounts(rows.map((r) => r.organizationId));
  return rows.map((r) => {
    const c = counts.get(r.organizationId) ?? { total: 1, active: 0, activeAdmins: 0 };
    return { ...r, role: String(r.role), status: String(r.status), activeMembers: c.active, activeAdmins: c.activeAdmins, totalMembers: c.total };
  });
}

async function auditPlatform(actor: Actor, action: string, resourceType: string, resourceId: string, metadata: Record<string, unknown>) {
  if (actor.organizationId) {
    await recordAudit({ organizationId: actor.organizationId, actor: { userId: actor.id, email: actor.email }, action, resourceType, resourceId, metadata: { ...metadata, superadmin: true } });
  } else {
    log.info("[account-hygiene]", action, { actorUserId: actor.id, resourceId, ...metadata });
  }
}

async function dropTokensFor(emails: string[]) {
  const identifiers = emails.flatMap((e) => [`verify-email:${e.toLowerCase()}`, `reset-password:${e.toLowerCase()}`]);
  if (identifiers.length === 0) return;
  await db.delete(verificationTokens).where(inArray(verificationTokens.identifier, identifiers));
}

export type DeleteUserResult = { ok: true; deletedWorkspaces: { id: string; name: string }[] } | { ok: false; error: string };

/**
 * Delete one account. Refuses yourself, platform admins and the last
 * admin of a workspace that still has other people. Workspaces only this
 * person belonged to are deleted too when `deleteSoleWorkspaces` is set,
 * otherwise left empty for a platform admin to re-staff. Audited in every
 * surviving workspace they belonged to and in the acting admin's own.
 */
export async function deleteUserAccount(input: { userId: string; actor: Actor; deleteSoleWorkspaces: boolean }): Promise<DeleteUserResult> {
  const [target] = await db
    .select({ id: users.id, email: users.email, name: users.name, isSuperadmin: users.isSuperadmin, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!target) return { ok: false, error: "User not found." };

  const held = await membershipsForDeletion(target.id);
  const blocker = deletionBlocker({ targetId: target.id, actorId: input.actor.id, isSuperadmin: target.isSuperadmin, memberships: held });
  if (blocker) return { ok: false, error: blocker };

  const sole = input.deleteSoleWorkspaces ? soleWorkspaces(held) : [];
  const soleIds = new Set(sole.map((w) => w.id));
  const metadata = { email: target.email, name: target.name ?? "", verified: !!target.emailVerified, deletedWorkspaces: sole.map((w) => w.name) };

  // The workspaces that stay hear about it in their own log.
  for (const m of held) {
    if (soleIds.has(m.organizationId)) continue;
    await recordAudit({
      organizationId: m.organizationId,
      actor: { userId: input.actor.id, email: input.actor.email },
      action: "user.delete",
      resourceType: "user",
      resourceId: target.id,
      metadata: { ...metadata, role: m.role, superadmin: true },
    });
  }

  // The account first (its memberships cascade), then the workspaces it
  // leaves empty — a failure in between strands an empty workspace, never
  // a person without theirs.
  await db.delete(users).where(eq(users.id, target.id));
  if (sole.length > 0) {
    await db.delete(organizations).where(inArray(organizations.id, [...soleIds]));
  }
  await dropTokensFor([target.email]);
  await auditPlatform(input.actor, "user.delete", "user", target.id, metadata);
  return { ok: true, deletedWorkspaces: sole };
}

export type PurgeCandidate = { id: string; email: string; name: string | null; createdAt: string; workspaces: { id: string; name: string }[] };

/** Unverified accounts older than the cutoff that are alone in every workspace they hold. */
export async function listUnverifiedPurgeCandidates(input: { olderThanDays: number; now?: Date }): Promise<{
  candidates: PurgeCandidate[];
  sharedWorkspace: number;
  cutoff: string;
}> {
  const days = sanitizePurgeDays(input.olderThanDays);
  const cutoff = new Date((input.now ?? new Date()).getTime() - days * 86_400_000);
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, isSuperadmin: users.isSuperadmin, createdAt: users.createdAt })
    .from(users)
    .where(and(isNull(users.emailVerified), eq(users.isSuperadmin, false), lte(users.createdAt, cutoff)))
    .orderBy(asc(users.createdAt))
    .limit(PURGE_LIMITS.batchMax);
  if (rows.length === 0) return { candidates: [], sharedWorkspace: 0, cutoff: cutoff.toISOString() };

  const held = await db
    .select({ userId: memberships.userId, organizationId: memberships.organizationId, organizationName: organizations.name })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(inArray(memberships.userId, rows.map((r) => r.id)));
  const counts = await workspaceCounts([...new Set(held.map((h) => h.organizationId))]);
  const byUser = new Map<string, PurgeMembership[]>();
  for (const h of held) {
    const list = byUser.get(h.userId) ?? [];
    list.push({ organizationId: h.organizationId, organizationName: h.organizationName, memberCount: counts.get(h.organizationId)?.total ?? 1 });
    byUser.set(h.userId, list);
  }

  const candidates: PurgeCandidate[] = [];
  let sharedWorkspace = 0;
  for (const r of rows) {
    const d = purgeDecision({ id: r.id, verified: false, isSuperadmin: r.isSuperadmin, createdAt: r.createdAt }, byUser.get(r.id) ?? [], cutoff);
    if (d.eligible) candidates.push({ id: r.id, email: r.email, name: r.name, createdAt: r.createdAt.toISOString(), workspaces: d.workspaces });
    else if (d.reason === "shared_workspace") sharedWorkspace++;
  }
  return { candidates, sharedWorkspace, cutoff: cutoff.toISOString() };
}

/**
 * Delete the previewed accounts that are still eligible (anyone who
 * verified, joined a shared workspace or was made a platform admin since
 * the preview is skipped), with their sole workspaces. One audit row.
 */
export async function purgeUnverifiedAccounts(input: { olderThanDays: number; userIds: string[]; actor: Actor; now?: Date }): Promise<{
  deleted: number;
  workspacesDeleted: number;
  skipped: number;
}> {
  const wanted = new Set(input.userIds.slice(0, PURGE_LIMITS.batchMax));
  if (wanted.size === 0) return { deleted: 0, workspacesDeleted: 0, skipped: 0 };
  const { candidates } = await listUnverifiedPurgeCandidates({ olderThanDays: input.olderThanDays, now: input.now });
  const chosen = candidates.filter((c) => wanted.has(c.id));
  if (chosen.length === 0) return { deleted: 0, workspacesDeleted: 0, skipped: wanted.size };

  // Re-check "never verified" at delete time: someone who clicks their
  // link between the preview and this statement keeps their account, and
  // their workspace with it — workspaces go only for accounts removed.
  const removed = await db
    .delete(users)
    .where(and(inArray(users.id, chosen.map((c) => c.id)), isNull(users.emailVerified), eq(users.isSuperadmin, false)))
    .returning({ id: users.id });
  const removedIds = new Set(removed.map((r) => r.id));
  const gone = chosen.filter((c) => removedIds.has(c.id));
  const workspaceIds = [...new Set(gone.flatMap((c) => c.workspaces.map((w) => w.id)))];
  if (workspaceIds.length > 0) await db.delete(organizations).where(inArray(organizations.id, workspaceIds));
  await dropTokensFor(gone.map((c) => c.email));

  await auditPlatform(input.actor, "user.purge_unverified", "user", "bulk", {
    olderThanDays: sanitizePurgeDays(input.olderThanDays),
    deleted: removed.length,
    workspacesDeleted: workspaceIds.length,
    emails: gone.slice(0, 50).map((c) => c.email),
  });
  return { deleted: removed.length, workspacesDeleted: workspaceIds.length, skipped: wanted.size - removed.length };
}
