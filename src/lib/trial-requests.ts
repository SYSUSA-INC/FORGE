/**
 * BL-AUTH-ABUSE Slice 2b — the Request-a-trial queue.
 *
 *   submitTrialRequest   — the public form's write: one pending request
 *                          per email; a domain a tenant already owns is
 *                          sent to that tenant's admin instead; platform
 *                          admins get an email (best-effort)
 *   listTrialRequests    — the SuperAdmin portal's queue
 *   approveTrialRequest  — a platform admin's yes: the workspace and its
 *                          admin invite (shared with "New organization"),
 *                          then a 14-day trial on it
 *   declineTrialRequest  — a platform admin's no, with an optional reason
 *
 * Platform-level (no tenant until approval). Server-only; callers own
 * auth and rate limiting.
 */
import "server-only";

import { and, asc, count, desc, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { trialRequests, users } from "@/db/schema";
import { appBaseUrl } from "@/lib/app-url";
import { recordAudit } from "@/lib/audit-log";
import { emailConfigured, sendEmail } from "@/lib/email";
import { findHomeOrganizationForEmail } from "@/lib/invite-approval";
import { log } from "@/lib/log";
import { provisionOrganizationWithAdminInvite } from "@/lib/org-provisioning";
import { startTenantTrial } from "@/lib/tenant-subscription";
import { TRIAL_REQUEST_LIMITS, trialWorkspaceName, type TrialRequestInput } from "@/lib/trial-request-logic";

type Actor = { id: string; email?: string | null; name?: string | null; organizationId?: string | null };

export type SubmitOutcome = { kind: "queued"; id: string } | { kind: "duplicate" } | { kind: "owned_domain"; organizationName: string };

/** Queue a validated request. Never creates a tenant. */
export async function submitTrialRequest(input: { value: TrialRequestInput; sourceIp: string }): Promise<SubmitOutcome> {
  const v = input.value;
  const home = await findHomeOrganizationForEmail(v.email);
  if (home) return { kind: "owned_domain", organizationName: home.name };

  const [row] = await db
    .insert(trialRequests)
    .values({
      name: v.name,
      email: v.email,
      emailDomain: v.emailDomain,
      company: v.company,
      jobTitle: v.jobTitle,
      message: v.message,
      sourceIp: input.sourceIp.slice(0, 64),
    })
    .onConflictDoNothing()
    .returning({ id: trialRequests.id });
  if (!row) return { kind: "duplicate" };

  void notifyPlatformAdmins(v).catch((err) => log.warn("[trial-requests]", "admin notification failed", { error: err }));
  return { kind: "queued", id: row.id };
}

async function notifyPlatformAdmins(v: TrialRequestInput): Promise<void> {
  if (!emailConfigured()) return;
  const admins = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.isSuperadmin, true), isNull(users.disabledAt)));
  const url = `${appBaseUrl()}/admin/trial-requests`;
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  for (const a of admins) {
    if (!a.email) continue;
    await sendEmail({
      to: a.email,
      subject: `Trial request: ${v.company} (${v.email})`,
      html: `<p><strong>${esc(v.name)}</strong>${v.jobTitle ? `, ${esc(v.jobTitle)}` : ""} at <strong>${esc(v.company)}</strong> (${esc(v.email)}) asked for a FORGE trial.</p>${v.message ? `<blockquote>${esc(v.message)}</blockquote>` : ""}<p><a href="${url}">Approve or decline in the SuperAdmin portal</a></p>`,
      text: `${v.name}${v.jobTitle ? `, ${v.jobTitle}` : ""} at ${v.company} (${v.email}) asked for a FORGE trial.${v.message ? `\n\n${v.message}` : ""}\n\nApprove or decline: ${url}`,
    });
  }
}

export type TrialRequestRow = {
  id: string;
  name: string;
  email: string;
  company: string;
  jobTitle: string;
  message: string;
  status: "pending" | "approved" | "declined";
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  declineReason: string;
  createdOrganizationId: string | null;
};

/** Pending requests oldest first, then the most recent decisions. */
export async function listTrialRequests(input?: { decidedLimit?: number }): Promise<{ pending: TrialRequestRow[]; decided: TrialRequestRow[] }> {
  const cols = {
    id: trialRequests.id,
    name: trialRequests.name,
    email: trialRequests.email,
    company: trialRequests.company,
    jobTitle: trialRequests.jobTitle,
    message: trialRequests.message,
    status: trialRequests.status,
    createdAt: trialRequests.createdAt,
    decidedAt: trialRequests.decidedAt,
    decidedBy: users.email,
    declineReason: trialRequests.declineReason,
    createdOrganizationId: trialRequests.createdOrganizationId,
  };
  const shape = (r: { createdAt: Date; decidedAt: Date | null } & Omit<TrialRequestRow, "createdAt" | "decidedAt">): TrialRequestRow => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
  });
  const [pending, decided] = await Promise.all([
    db.select(cols).from(trialRequests).leftJoin(users, eq(users.id, trialRequests.decidedByUserId)).where(eq(trialRequests.status, "pending")).orderBy(asc(trialRequests.createdAt)).limit(200),
    db
      .select(cols)
      .from(trialRequests)
      .leftJoin(users, eq(users.id, trialRequests.decidedByUserId))
      .where(ne(trialRequests.status, "pending"))
      .orderBy(desc(trialRequests.decidedAt))
      .limit(input?.decidedLimit ?? 25),
  ]);
  return { pending: pending.map(shape), decided: decided.map(shape) };
}

/** How many requests wait for a decision (the portal's header count). */
export async function pendingTrialRequestCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(trialRequests).where(eq(trialRequests.status, "pending"));
  return Number(row?.n ?? 0);
}

export type ApproveResult =
  | { ok: true; organizationId: string; inviteUrl: string | null; emailSent: boolean; warning?: string }
  | { ok: false; error: string };

/**
 * Approve: claim the request (so two admins can't both approve), create
 * the workspace named after the company with the requester invited as
 * its admin, then start the 14-day trial. A failure before the workspace
 * exists puts the request back in the queue.
 */
export async function approveTrialRequest(input: { requestId: string; actor: Actor }): Promise<ApproveResult> {
  const [req] = await db.select().from(trialRequests).where(eq(trialRequests.id, input.requestId)).limit(1);
  if (!req) return { ok: false, error: "Request not found." };
  if (req.status !== "pending") return { ok: false, error: `This request was already ${req.status}.` };
  const home = await findHomeOrganizationForEmail(req.email);
  if (home) return { ok: false, error: `${home.name} now owns ${req.emailDomain}; invite ${req.email} there instead, or decline this request.` };

  const now = new Date();
  const claimed = await db
    .update(trialRequests)
    .set({ status: "approved", decidedAt: now, decidedByUserId: input.actor.id, updatedAt: now })
    .where(and(eq(trialRequests.id, req.id), eq(trialRequests.status, "pending")))
    .returning({ id: trialRequests.id });
  if (claimed.length === 0) return { ok: false, error: "Someone else decided this request a moment ago." };

  const made = await provisionOrganizationWithAdminInvite({
    orgName: trialWorkspaceName(req.company),
    adminEmail: req.email,
    adminTitle: req.jobTitle || null,
    actor: { id: input.actor.id, email: input.actor.email, name: input.actor.name },
    auditMetadata: { trialRequestId: req.id },
  });
  if (!made.ok) {
    await db
      .update(trialRequests)
      .set({ status: "pending", decidedAt: null, decidedByUserId: null, updatedAt: new Date() })
      .where(eq(trialRequests.id, req.id));
    return made;
  }

  const trial = await startTenantTrial({ organizationId: made.organizationId, actor: { userId: input.actor.id, email: input.actor.email } });
  if (!trial.ok) log.error("[trial-requests]", "workspace created but trial not started", { requestId: req.id, organizationId: made.organizationId, error: trial.error });
  await db.update(trialRequests).set({ createdOrganizationId: made.organizationId, updatedAt: new Date() }).where(eq(trialRequests.id, req.id));
  await recordAudit({
    organizationId: made.organizationId,
    actor: { userId: input.actor.id, email: input.actor.email },
    action: "trial_request.approve",
    resourceType: "trial_request",
    resourceId: req.id,
    metadata: { company: req.company, email: req.email, trialStarted: trial.ok, superadmin: true },
  });
  return { ok: true, organizationId: made.organizationId, inviteUrl: made.inviteUrl, emailSent: made.emailSent, warning: made.warning };
}

/** Decline with an optional internal reason. Nothing is sent to the requester. */
export async function declineTrialRequest(input: { requestId: string; reason?: string; actor: Actor }): Promise<{ ok: true } | { ok: false; error: string }> {
  const reason = (input.reason ?? "").trim().slice(0, TRIAL_REQUEST_LIMITS.declineReasonMax);
  const now = new Date();
  const done = await db
    .update(trialRequests)
    .set({ status: "declined", decidedAt: now, decidedByUserId: input.actor.id, declineReason: reason, updatedAt: now })
    .where(and(eq(trialRequests.id, input.requestId), eq(trialRequests.status, "pending")))
    .returning({ id: trialRequests.id, email: trialRequests.email, company: trialRequests.company });
  if (done.length === 0) return { ok: false, error: "This request is no longer pending." };
  const metadata = { email: done[0]!.email, company: done[0]!.company, reason, superadmin: true };
  if (input.actor.organizationId) {
    await recordAudit({ organizationId: input.actor.organizationId, actor: { userId: input.actor.id, email: input.actor.email }, action: "trial_request.decline", resourceType: "trial_request", resourceId: input.requestId, metadata });
  } else {
    log.info("[trial-requests]", "trial_request.decline", { actorUserId: input.actor.id, requestId: input.requestId, ...metadata });
  }
  return { ok: true };
}
