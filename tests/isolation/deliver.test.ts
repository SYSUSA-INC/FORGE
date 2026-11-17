/**
 * BL-NAV-LIFECYCLE 6a — Deliver against Postgres. Two tenants. Asserts:
 * tenant B cannot read tenant A's Deliver tab, record a submission on
 * A's opportunity or attach A's render to its own; the sign-off gate blocks until five colours are signed off, and
 * an org admin or the proposal manager (never the capture manager) may
 * override with a reason; recording keeps a copy of the file with its
 * SHA-256, marks the proposal and the opportunity submitted, writes the
 * timeline and the audit rows, and starts the harvest once.
 */

import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

const runDurable = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ jobId: "job", reused: false })));
vi.mock("@/lib/jobs", () => ({ runDurable }));

import { db } from "@/db";
import {
  auditLogs,
  opportunities,
  opportunityActivities,
  proposalPdfRenders,
  proposalReviewAssignments,
  proposalReviewChecklistItems,
  proposalReviews,
  proposalSubmissions,
  proposals,
} from "@/db/schema";
import { SIGNOFF_COLORS } from "@/lib/deliver-logic";
import { listSubmissions, loadDeliver, recordSubmission, signoffFor, type DeliverUser, type RecordSubmissionInput } from "@/lib/deliver-store";
import { getStorageProvider } from "@/lib/storage";
import { createTwoTenants, type TenantFixture, type TwoTenantFixture } from "../helpers/fixtures";

const NOW = new Date("2026-11-17T12:00:00.000Z");
const SENT = "2026-11-17T09:30:00.000Z";
const BYTES = new TextEncoder().encode("%PDF-1.7 tenant A final proposal");

async function addRender(t: TenantFixture, bytes: Uint8Array): Promise<string> {
  const [row] = await db
    .insert(proposalPdfRenders)
    .values({ proposalId: t.proposalId, organizationId: t.organizationId, storagePath: "pending", contentType: "pdf", byteSize: bytes.byteLength, provider: "browserless" })
    .returning({ id: proposalPdfRenders.id });
  const storagePath = `org/${t.organizationId}/proposal/${t.proposalId}/render/${row!.id}.pdf`;
  await getStorageProvider().put({ key: storagePath, bytes, contentType: "application/pdf" });
  await db.update(proposalPdfRenders).set({ storagePath }).where(eq(proposalPdfRenders.id, row!.id));
  return row!.id;
}

/** Five colours, each closed as a pass with its one reviewer signed, and the submission pack ticked. */
async function signOffAll(t: TenantFixture) {
  for (const color of SIGNOFF_COLORS) {
    const [r] = await db.insert(proposalReviews).values({ proposalId: t.proposalId, color, status: "complete", verdict: "pass" }).returning({ id: proposalReviews.id });
    await db.insert(proposalReviewAssignments).values({ reviewId: r!.id, userId: t.userId, verdict: "pass", submittedAt: NOW });
    if (color === "white_gloves") await db.insert(proposalReviewChecklistItems).values({ reviewId: r!.id, userId: t.userId, itemKey: "submission_pack", checked: true });
  }
}

describe("BL-NAV-LIFECYCLE 6a — Deliver", () => {
  let fx: TwoTenantFixture;
  let renderA = "";
  let renderB = "";

  beforeEach(async () => {
    runDurable.mockClear();
    fx = await createTwoTenants("deliver");
    renderA = await addRender(fx.orgA, BYTES);
    renderB = await addRender(fx.orgB, new TextEncoder().encode("%PDF-1.7 tenant B"));
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  const admin = (t: TenantFixture): DeliverUser => ({ id: t.userId, email: "lead@test", role: "admin", isSuperadmin: false });
  const member = (t: TenantFixture): DeliverUser => ({ id: t.userId, email: "member@test", role: "member", isSuperadmin: false });
  const input = (t: TenantFixture, over: Partial<RecordSubmissionInput> = {}): RecordSubmissionInput => ({
    organizationId: t.organizationId,
    opportunityId: t.opportunityId,
    user: admin(t),
    method: "own_email",
    sentAt: SENT,
    recipients: "co@agency.gov",
    note: "Confirmation 4411",
    renderId: t === fx.orgA ? renderA : renderB,
    now: NOW,
    ...over,
  });

  it("keeps tenant A's Deliver tab, renders and submissions from tenant B", async () => {
    const A = fx.orgA;
    const B = fx.orgB;
    expect(await loadDeliver({ organizationId: B.organizationId, opportunityId: A.opportunityId, user: admin(B) })).toBeNull();

    const cross = await recordSubmission(input(A, { organizationId: B.organizationId, user: admin(B), overrideReason: "Deadline today, override." }));
    expect(cross).toEqual({ ok: false, error: "Opportunity not found." });
    const foreignRender = await recordSubmission(input(B, { renderId: renderA, overrideReason: "Deadline today, override." }));
    expect(foreignRender).toEqual({ ok: false, error: "Choose the file that was submitted." });
    expect(await db.select().from(proposalSubmissions)).toHaveLength(0);

    const ok = await recordSubmission(input(A, { overrideReason: "Deadline today, override." }));
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(await listSubmissions(B.organizationId, A.opportunityId)).toEqual([]);
    expect((await loadDeliver({ organizationId: B.organizationId, opportunityId: B.opportunityId, user: admin(B) }))?.submissions).toEqual([]);
    const [oppB] = await db.select({ stage: opportunities.stage }).from(opportunities).where(eq(opportunities.id, B.opportunityId));
    expect(oppB!.stage).not.toBe("submitted");
  });

  it("blocks until sign-off, lets an admin override with a reason, and records everything once", async () => {
    const A = fx.orgA;
    const blocked = await recordSubmission(input(A));
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toContain("Sign-off is not complete. Pink has not been run.");
    const short = await recordSubmission(input(A, { overrideReason: "too short" }));
    expect(short.ok).toBe(false);
    expect(await db.select().from(proposalSubmissions)).toHaveLength(0);

    const res = await recordSubmission(input(A, { overrideReason: "Customer moved the deadline to today." }));
    expect(res).toMatchObject({ ok: true, overridden: true });
    if (!res.ok) return;

    const [row] = await db.select().from(proposalSubmissions).where(eq(proposalSubmissions.id, res.submissionId));
    expect(row).toMatchObject({
      organizationId: A.organizationId,
      opportunityId: A.opportunityId,
      proposalId: A.proposalId,
      method: "own_email",
      status: "recorded",
      recipientsTo: ["co@agency.gov"],
      note: "Confirmation 4411",
      overrideReason: "Customer moved the deadline to today.",
      sentByUserId: A.userId,
    });
    expect(row!.sentAt?.toISOString()).toBe(SENT);
    expect((row!.signoff as { clear: boolean }).clear).toBe(false);
    const file = row!.files[0]!;
    expect(file).toMatchObject({ renderId: renderA, byteSize: BYTES.byteLength, sha256: createHash("sha256").update(BYTES).digest("hex") });
    expect(file.storagePath).toBe(`org/${A.organizationId}/submission/${res.submissionId}/${file.fileName}`);
    expect((await getStorageProvider().get(file.storagePath))?.bytes.byteLength).toBe(BYTES.byteLength);

    const [p] = await db.select({ stage: proposals.stage, submittedAt: proposals.submittedAt }).from(proposals).where(eq(proposals.id, A.proposalId));
    expect(p!.stage).toBe("submitted");
    expect(p!.submittedAt?.toISOString()).toBe(SENT);
    const [opp] = await db.select({ stage: opportunities.stage }).from(opportunities).where(eq(opportunities.id, A.opportunityId));
    expect(opp!.stage).toBe("submitted");

    const activity = await db.select().from(opportunityActivities).where(and(eq(opportunityActivities.opportunityId, A.opportunityId), eq(opportunityActivities.kind, "submission")));
    expect(activity).toHaveLength(1);
    expect(activity[0]!.metadata).toMatchObject({ submissionId: res.submissionId, method: "own_email", overridden: true });

    const audits = await db.select({ action: auditLogs.action, metadata: auditLogs.metadata }).from(auditLogs).where(eq(auditLogs.organizationId, A.organizationId));
    const actions = audits.map((a) => a.action);
    expect(actions).toContain("proposal.submission.recorded");
    expect(actions).toContain("proposal.submission.gate_override");
    expect(audits.find((a) => a.action === "proposal.submission.gate_override")!.metadata).toMatchObject({ reason: "Customer moved the deadline to today." });
    expect((await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgB.organizationId), eq(auditLogs.action, "proposal.submission.recorded")))).length).toBe(0);

    expect(runDurable).toHaveBeenCalledTimes(1);
    expect(runDurable.mock.calls[0]![1]).toMatchObject({ organizationId: A.organizationId, kind: "proposal_harvest", resourceId: A.proposalId });

    // A resubmission is a second row, and the harvest does not start again.
    const again = await recordSubmission(input(A, { method: "government_portal", recipients: "", overrideReason: "Resubmitted after amendment 2." }));
    expect(again.ok).toBe(true);
    expect(await listSubmissions(A.organizationId, A.opportunityId)).toHaveLength(2);
    expect(runDurable).toHaveBeenCalledTimes(1);
  });

  it("submits with no override once five colours are signed off and the pack is ticked", async () => {
    const A = fx.orgA;
    expect((await signoffFor(A.organizationId, A.proposalId)).clear).toBe(false);
    await signOffAll(A);
    const gate = await signoffFor(A.organizationId, A.proposalId);
    expect(gate).toMatchObject({ clear: true, signedOff: 5, submissionPack: true, exportClean: true });
    // Tenant B reads nothing of A's rounds through A's proposal id.
    expect((await signoffFor(fx.orgB.organizationId, A.proposalId)).signedOff).toBe(0);

    const view = await loadDeliver({ organizationId: A.organizationId, opportunityId: A.opportunityId, user: admin(A) });
    expect(view).toMatchObject({ canSubmit: true, canOverride: true });
    expect(view!.renders.map((r) => r.id)).toEqual([renderA]);

    const res = await recordSubmission(input(A));
    expect(res).toMatchObject({ ok: true, overridden: false });
    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.organizationId, A.organizationId));
    expect(audits.map((a) => a.action)).not.toContain("proposal.submission.gate_override");
  });

  it("limits who submits and who overrides, and refuses bad input", async () => {
    const A = fx.orgA;
    const notLead = await recordSubmission(input(A, { user: member(A), overrideReason: "Deadline today, override." }));
    expect(notLead).toEqual({ ok: false, error: "Only an org admin, the proposal manager or the capture manager can record a submission." });

    await db.update(proposals).set({ captureManagerUserId: A.userId, proposalManagerUserId: null }).where(eq(proposals.id, A.proposalId));
    const capture = await recordSubmission(input(A, { user: member(A), overrideReason: "Deadline today, override." }));
    expect(capture).toEqual({ ok: false, error: "Only an org admin or the proposal manager can submit before every colour team has signed off." });

    await db.update(proposals).set({ proposalManagerUserId: A.userId }).where(eq(proposals.id, A.proposalId));
    expect((await recordSubmission(input(A, { user: member(A), method: "fax", overrideReason: "Deadline today, override." }))).ok).toBe(false);
    expect((await recordSubmission(input(A, { user: member(A), sentAt: "2026-12-25T00:00:00Z", overrideReason: "Deadline today, override." }))).ok).toBe(false);
    expect((await recordSubmission(input(A, { user: member(A), recipients: "", overrideReason: "Deadline today, override." }))).ok).toBe(false);
    expect((await recordSubmission(input(A, { user: member(A), recipients: "not an address", overrideReason: "Deadline today, override." }))).ok).toBe(false);
    expect(await db.select().from(proposalSubmissions)).toHaveLength(0);
    expect((await recordSubmission(input(A, { user: member(A), overrideReason: "Deadline today, override." }))).ok).toBe(true);
  });
});
