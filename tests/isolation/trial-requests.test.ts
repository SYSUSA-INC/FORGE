/**
 * BL-AUTH-ABUSE Slice 2b — the Request-a-trial queue against Postgres: a
 * request queues once per email, a domain a tenant owns is sent to that
 * tenant, approval creates the workspace (owning the company domain)
 * with an admin invite and a 14-day trial, a decided request can't be
 * decided again, and decline creates nothing.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { allowlist, auditLogs, organizations, tenantSubscriptions, trialRequests } from "@/db/schema";
import { approveTrialRequest, declineTrialRequest, listTrialRequests, submitTrialRequest } from "@/lib/trial-requests";
import { validateTrialRequest } from "@/lib/trial-request-logic";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const DAY = 86_400_000;

describe("BL-AUTH-ABUSE — Request-a-trial queue", () => {
  let fx: TwoTenantFixture;
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const domain = `trialco-${tag}.example`;
  const createdOrgs: string[] = [];

  function input(email: string, company = "Trial Co") {
    const v = validateTrialRequest({ name: "Ana Rivera", email, company, jobTitle: "Capture lead", message: "Hi" });
    if (!v.ok) throw new Error(v.error);
    return v.value;
  }

  beforeEach(async () => {
    fx = await createTwoTenants("trial-req");
  });

  afterEach(async () => {
    const rows = await db.select({ org: trialRequests.createdOrganizationId }).from(trialRequests).where(eq(trialRequests.emailDomain, domain));
    for (const r of rows) if (r.org) createdOrgs.push(r.org);
    await db.delete(trialRequests).where(inArray(trialRequests.emailDomain, [domain, `owned-${tag}.example`]));
    if (createdOrgs.length) await db.delete(organizations).where(inArray(organizations.id, createdOrgs.splice(0)));
    await fx.cleanup();
  });

  it("queues once per email, sends owned domains to their tenant, and approves into a trial workspace", async () => {
    const first = await submitTrialRequest({ value: input(`ana@${domain}`), sourceIp: "203.0.113.7" });
    expect(first.kind).toBe("queued");
    expect(await submitTrialRequest({ value: input(`ana@${domain}`), sourceIp: "203.0.113.7" })).toEqual({ kind: "duplicate" });

    // A domain tenant A owns is pointed at A, and nothing is queued.
    await db.update(organizations).set({ emailDomains: [`owned-${tag}.example`] }).where(eq(organizations.id, fx.orgA.organizationId));
    const owned = await submitTrialRequest({ value: input(`bob@owned-${tag}.example`), sourceIp: "203.0.113.7" });
    expect(owned.kind).toBe("owned_domain");
    expect(await db.select({ id: trialRequests.id }).from(trialRequests).where(eq(trialRequests.emailDomain, `owned-${tag}.example`))).toEqual([]);

    const listed = await listTrialRequests();
    const mine = listed.pending.find((r) => r.email === `ana@${domain}`);
    expect(mine).toMatchObject({ company: "Trial Co", status: "pending" });

    const actor = { id: fx.orgA.userId, email: "admin@test", name: "Platform Admin", organizationId: fx.orgA.organizationId };
    const approved = await approveTrialRequest({ requestId: mine!.id, actor });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    createdOrgs.push(approved.organizationId);

    const [org] = await db.select({ name: organizations.name, emailDomains: organizations.emailDomains }).from(organizations).where(eq(organizations.id, approved.organizationId));
    expect(org).toEqual({ name: "Trial Co", emailDomains: [domain] });
    const [sub] = await db.select({ status: tenantSubscriptions.status, trialUntil: tenantSubscriptions.trialUntil }).from(tenantSubscriptions).where(eq(tenantSubscriptions.organizationId, approved.organizationId));
    expect(sub!.status).toBe("trial");
    expect(Math.round((sub!.trialUntil!.getTime() - Date.now()) / DAY)).toBe(14);
    const invites = await db.select({ email: allowlist.email, role: allowlist.role }).from(allowlist).where(eq(allowlist.organizationId, approved.organizationId));
    expect(invites).toEqual([{ email: `ana@${domain}`, role: "admin" }]);

    const [req] = await db.select({ status: trialRequests.status, org: trialRequests.createdOrganizationId }).from(trialRequests).where(eq(trialRequests.id, mine!.id));
    expect(req).toEqual({ status: "approved", org: approved.organizationId });
    expect(await approveTrialRequest({ requestId: mine!.id, actor })).toEqual({ ok: false, error: "This request was already approved." });
    expect(await declineTrialRequest({ requestId: mine!.id, actor })).toEqual({ ok: false, error: "This request is no longer pending." });

    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.organizationId, approved.organizationId));
    expect(audits.map((a) => a.action).sort()).toEqual(["org.create", "tenant.trial_start", "trial_request.approve"]);

    // The same person can ask again once the earlier request is decided.
    expect((await submitTrialRequest({ value: input(`ana@${domain}`), sourceIp: "203.0.113.7" })).kind).toBe("queued");
  });

  it("declines without creating anything", async () => {
    const queued = await submitTrialRequest({ value: input(`dee@${domain}`, "Dee Co"), sourceIp: "198.51.100.2" });
    if (queued.kind !== "queued") throw new Error("expected queued");
    const actor = { id: fx.orgB.userId, email: "admin@test", organizationId: fx.orgB.organizationId };
    expect(await declineTrialRequest({ requestId: queued.id, reason: "Competitor", actor })).toEqual({ ok: true });
    const [row] = await db.select({ status: trialRequests.status, reason: trialRequests.declineReason, org: trialRequests.createdOrganizationId }).from(trialRequests).where(eq(trialRequests.id, queued.id));
    expect(row).toEqual({ status: "declined", reason: "Competitor", org: null });
    expect(await approveTrialRequest({ requestId: queued.id, actor })).toEqual({ ok: false, error: "This request was already declined." });
    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgB.organizationId), eq(auditLogs.action, "trial_request.decline")));
    expect(audits).toHaveLength(1);
  });
});
