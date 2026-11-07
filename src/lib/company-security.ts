import "server-only";

import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { memberships, userMfaFactors, userRecoveryCodes, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { companyResetBlocker, type MemberSecurityInput } from "@/lib/company-security-logic";
import { emailConfigured, sendMfaResetEmail } from "@/lib/email";
import { log } from "@/lib/log";
import { cleanResetReason } from "@/lib/mfa";
import { resetMfa } from "@/lib/mfa-store";

/**
 * BL-MFA-ADMIN — Administration → Security: each member of a company
 * with the methods they hold, and a company admin's reset of a member who
 * lost their device. Every query is scoped to the organization's own
 * memberships; the reset re-checks the member is this company's, and only
 * this company's (`companyResetBlocker`). Callers own auth.
 */
export type MemberSecurityRow = MemberSecurityInput & {
  name: string | null;
  email: string;
  role: string;
  recoveryCodesLeft: number;
  lastSecondStepAt: string | null;
};

export async function companyMemberSecurity(organizationId: string): Promise<MemberSecurityRow[]> {
  const members = await db
    .select({ userId: users.id, name: users.name, email: users.email, role: memberships.role, status: memberships.status, isSuperadmin: users.isSuperadmin, enrolledAt: users.mfaEnrolledAt, lastPass: users.mfaPassAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, organizationId))
    .orderBy(asc(users.name), asc(users.email));
  const ids = members.map((m) => m.userId);
  if (ids.length === 0) return [];
  const [factors, codes, others] = await Promise.all([
    db
      .select({ userId: userMfaFactors.userId, kind: userMfaFactors.kind, n: sql<number>`count(*)::int` })
      .from(userMfaFactors)
      .where(and(inArray(userMfaFactors.userId, ids), isNotNull(userMfaFactors.confirmedAt)))
      .groupBy(userMfaFactors.userId, userMfaFactors.kind),
    db
      .select({ userId: userRecoveryCodes.userId, n: sql<number>`count(*)::int` })
      .from(userRecoveryCodes)
      .where(and(inArray(userRecoveryCodes.userId, ids), isNull(userRecoveryCodes.usedAt)))
      .groupBy(userRecoveryCodes.userId),
    db
      .select({ userId: memberships.userId, n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(inArray(memberships.userId, ids), ne(memberships.organizationId, organizationId), eq(memberships.status, "active")))
      .groupBy(memberships.userId),
  ]);
  const count = (userId: string, kind: string) => factors.find((f) => f.userId === userId && f.kind === kind)?.n ?? 0;
  return members.map((m) => ({
    userId: m.userId,
    name: m.name,
    email: m.email,
    role: m.role,
    status: m.status,
    isSuperadmin: m.isSuperadmin,
    passkeys: count(m.userId, "passkey"),
    apps: count(m.userId, "totp"),
    enrolled: !!m.enrolledAt,
    recoveryCodesLeft: codes.find((c) => c.userId === m.userId)?.n ?? 0,
    otherWorkspaces: others.find((o) => o.userId === m.userId)?.n ?? 0,
    lastSecondStepAt: m.lastPass ? m.lastPass.toISOString() : null,
  }));
}

/**
 * A company admin resets a member's second step: every passkey, app and
 * recovery code removed, every session ended, the member emailed with the
 * reason, `user.mfa.reset` audited in this company. Their password is
 * unchanged; they set it up again at the next sign-in.
 */
export async function resetMemberSecondStep(input: {
  organizationId: string;
  actor: { userId: string; email: string | null };
  userId: string;
  reason: string;
}): Promise<{ ok: true; emailSent: boolean; warning?: string } | { ok: false; error: string }> {
  const reason = cleanResetReason(input.reason);
  if (!reason.ok) return reason;
  const member = (await companyMemberSecurity(input.organizationId)).find((m) => m.userId === input.userId);
  if (!member) return { ok: false, error: "That person is not a member of this company." };
  const blocker = companyResetBlocker(input.actor.userId, member);
  if (blocker) return { ok: false, error: blocker };

  const removed = await resetMfa(member.userId);
  let emailSent = false;
  let warning: string | undefined;
  try {
    if (!emailConfigured()) throw new Error("email is not configured on this deployment");
    await sendMfaResetEmail({ to: member.email, reason: reason.reason, byEmail: input.actor.email, byCompanyAdmin: true });
    emailSent = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("[company-security]", "reset email failed", { userId: member.userId, error: message });
    warning = `The reset is done but the email could not be sent (${message}). Tell them yourself: their next sign-in sets two-step sign-in up again.`;
  }
  await recordAudit({
    organizationId: input.organizationId,
    actor: input.actor,
    action: "user.mfa.reset",
    resourceType: "user",
    resourceId: member.userId,
    metadata: { targetEmail: member.email, reason: reason.reason, factorsRemoved: removed.factors, recoveryCodesRemoved: removed.recoveryCodes, emailSent, companyAdmin: true },
  });
  return { ok: true, emailSent, warning };
}
