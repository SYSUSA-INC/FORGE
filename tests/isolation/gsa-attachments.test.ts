/**
 * BL-STAB-2d — a GSA email's attachments are uploaded straight to storage
 * and the create action gets only their ids (Postgres; memory storage
 * stands in for R2): every id is checked before anything is created, one
 * that can't be filed is named while the opportunity is still created,
 * each file becomes a solicitation on it, and their parses run one after
 * another in a single background run.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, backgroundJobs, fileUploads, opportunities, solicitations } from "@/db/schema";
import { runDurableBatch } from "@/lib/jobs";
import { getStorageProvider } from "@/lib/storage";
import { claimUpload, completeUpload, createUploadIntent, releaseClaim } from "@/lib/uploads";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const sessionUserStub = {
  id: "PLACEHOLDER",
  email: "capture@gsa.test",
  name: "Capture Lead",
  image: null as null,
  isSuperadmin: false as const,
  organizationId: "PLACEHOLDER",
  role: "admin" as const,
};

vi.mock("@/lib/auth-helpers", () => ({
  requireAuth: async () => sessionUserStub,
  requireCurrentOrg: async () => ({ user: sessionUserStub, organizationId: sessionUserStub.organizationId, isImpersonating: false }),
  getSessionUser: async () => sessionUserStub,
}));
// Background runs are kept and run by hand.
const bg = vi.hoisted(() => ({ runs: [] as (() => Promise<unknown>)[] }));
vi.mock("@/lib/background", () => ({
  runInBackground: (_label: string, work: () => Promise<unknown>) => void bg.runs.push(work),
  backgroundIsDurable: () => false,
}));

import { createOpportunityFromGsaAction, type GsaCreateInput } from "@/app/(app)/opportunities/import/gsa/actions";
import { createSolicitationFromUploadAction } from "@/app/(app)/solicitations/actions";

const enc = (s: string) => new TextEncoder().encode(s);
const rfpText = (heading: string) =>
  [
    heading,
    "Section C. The contractor shall staff the help desk from 7 a.m. to 7 p.m. Eastern on business days.",
    "Section L. Volume I (Technical) shall not exceed 25 pages in 12-point Times New Roman.",
    "Section M. Technical approach is more important than past performance.",
    "Quotes are due 2 November 2026 at 2 p.m. Eastern.",
  ].join("\n");
const FIELDS: Omit<GsaCreateInput, "uploadIds"> = {
  text: "From: eBuy\nRFQ1234567 — Help desk support for the VA.",
  title: "VA help desk support",
  noticeType: "rfq",
  solicitationNumber: "RFQ1234567",
  buyingAgency: "Department of Veterans Affairs",
  office: "",
  vehicle: "MAS",
  naicsCode: "541512",
  setAside: "",
  responseDueDate: "2026-11-02",
  placeOfPerformance: "",
  scopeSummary: "Help desk support.",
  notes: "",
};

describe("BL-STAB-2d — GSA attachments from direct uploads (runtime)", () => {
  let fx: TwoTenantFixture;

  beforeEach(async () => {
    fx = await createTwoTenants("gsa-attachments");
    sessionUserStub.id = fx.orgA.userId;
    sessionUserStub.organizationId = fx.orgA.organizationId;
    bg.runs.length = 0;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fx.cleanup();
  });

  /** An upload checked in storage; `asUser` uploads to that organization as another user (one person can belong to both). */
  async function stored(fileName: string, text: string, which: "A" | "B" = "A", asUser?: string) {
    const organizationId = (which === "A" ? fx.orgA : fx.orgB).organizationId;
    const userId = asUser ?? (which === "A" ? fx.orgA : fx.orgB).userId;
    const bytes = enc(text);
    const intent = await createUploadIntent({ organizationId, actor: { userId, email: null }, purpose: "document", fileName, size: bytes.byteLength, origin: "" });
    if (!intent.ok) throw new Error(intent.error);
    const [row] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, organizationId), eq(fileUploads.id, intent.uploadId)));
    await getStorageProvider().put({ key: row!.storageKey, bytes, contentType: row!.contentType });
    const done = await completeUpload({ organizationId, actor: { userId, email: null }, uploadId: intent.uploadId });
    if (!done.ok) throw new Error(done.error);
    return { uploadId: intent.uploadId, key: row!.storageKey };
  }

  it("files every checked attachment on the new opportunity, names one it can't, and parses them in order", async () => {
    const rfq = await stored("RFQ.txt", rfpText("REQUEST FOR QUOTE RFQ1234567 — Help desk support"));
    const pws = await stored("PWS.txt", rfpText("PERFORMANCE WORK STATEMENT — Help desk support"));
    // The same person's upload in another organization: not found here, and left as it was.
    const foreign = await stored("Theirs.txt", "Org B's file.", "B", fx.orgA.userId);

    const res = await createOpportunityFromGsaAction({ ...FIELDS, uploadIds: [rfq.uploadId, foreign.uploadId, pws.uploadId] });
    if (!res.ok) throw new Error(res.error);
    expect(res.attachmentsSkipped).toEqual([{ uploadId: foreign.uploadId, name: "An attachment", reason: "Upload not found." }]);
    expect(res.solicitationIds).toHaveLength(2);

    const [opp] = await db.select().from(opportunities).where(and(eq(opportunities.organizationId, fx.orgA.organizationId), eq(opportunities.id, res.opportunityId)));
    expect(opp).toMatchObject({ title: "VA help desk support", agency: "GSA MAS · Department of Veterans Affairs", solicitationNumber: "RFQ1234567" });
    const sols = await db.select().from(solicitations).where(and(eq(solicitations.organizationId, fx.orgA.organizationId), inArray(solicitations.id, res.solicitationIds)));
    expect(sols.map((s) => [s.fileName, s.storagePath, s.opportunityId, s.source, s.type]).sort()).toEqual([
      ["PWS.txt", pws.key, res.opportunityId, "gsa-paste", "rfq"],
      ["RFQ.txt", rfq.key, res.opportunityId, "gsa-paste", "rfq"],
    ]);
    const ledger = await db.select().from(fileUploads).where(inArray(fileUploads.id, [rfq.uploadId, pws.uploadId, foreign.uploadId]));
    expect(Object.fromEntries(ledger.map((r) => [r.id, [r.status, r.purgeAfter]]))).toEqual({
      [rfq.uploadId]: ["claimed", null],
      [pws.uploadId]: ["claimed", null],
      [foreign.uploadId]: ["stored", expect.any(Date)],
    });

    // One background run parses both, one after the other, in the order given.
    expect(bg.runs).toHaveLength(1);
    await bg.runs[0]!();
    const jobs = await db
      .select()
      .from(backgroundJobs)
      .where(and(eq(backgroundJobs.organizationId, fx.orgA.organizationId), inArray(backgroundJobs.resourceId, res.solicitationIds)))
      .orderBy(asc(backgroundJobs.startedAt));
    expect(jobs.map((j) => [j.resourceId, j.status])).toEqual([
      [sols.find((s) => s.fileName === "RFQ.txt")!.id, "done"],
      [sols.find((s) => s.fileName === "PWS.txt")!.id, "done"],
    ]);
    expect(jobs[0]!.finishedAt!.getTime()).toBeLessThanOrEqual(jobs[1]!.startedAt!.getTime());
    const parsed = await db.select({ parseStatus: solicitations.parseStatus }).from(solicitations).where(and(eq(solicitations.organizationId, fx.orgA.organizationId), inArray(solicitations.id, res.solicitationIds)));
    expect(parsed.map((p) => p.parseStatus)).toEqual(["parsed", "parsed"]);

    const [audit] = await db
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "opportunity.create_from_gsa"), eq(auditLogs.resourceId, res.opportunityId)));
    expect(audit?.metadata).toMatchObject({ attachments: 2, attachmentsSkipped: 1, uploadIds: [rfq.uploadId, foreign.uploadId, pws.uploadId] });
  });

  it("names an attachment already filed instead of filing it twice, and creates nothing past 20", async () => {
    const rfq = await stored("RFQ.txt", "REQUEST FOR QUOTE — Help desk support.");
    const filed = await createSolicitationFromUploadAction({ uploadId: rfq.uploadId });
    if (!filed.ok) throw new Error(filed.error);
    bg.runs.length = 0;

    const res = await createOpportunityFromGsaAction({ ...FIELDS, uploadIds: [rfq.uploadId] });
    if (!res.ok) throw new Error(res.error);
    expect(res).toMatchObject({ solicitationIds: [], attachmentsSkipped: [{ uploadId: rfq.uploadId, name: "RFQ.txt", reason: "This file was already saved." }] });
    expect(bg.runs).toHaveLength(0);
    const [sol] = await db.select().from(solicitations).where(and(eq(solicitations.organizationId, fx.orgA.organizationId), eq(solicitations.id, filed.id)));
    expect(sol!.opportunityId).toBeNull();

    const tooMany = await createOpportunityFromGsaAction({ ...FIELDS, title: "Too many attachments", uploadIds: Array.from({ length: 21 }, () => randomUUID()) });
    expect(tooMany).toMatchObject({ ok: false, error: expect.stringMatching(/^At most 20 attachments/) });
    expect(await db.select().from(opportunities).where(and(eq(opportunities.organizationId, fx.orgA.organizationId), eq(opportunities.title, "Too many attachments")))).toEqual([]);
  });
  it("names a file an earlier attempt saved on its own opportunity, leaves it there, and makes sure it was parsed", async () => {
    // The earlier attempt's insert landed but reported an error, so its claim was put back.
    const rfq = await stored("RFQ.txt", rfpText("REQUEST FOR QUOTE — Help desk support"));
    const claim = await claimUpload({ organizationId: fx.orgA.organizationId, userId: fx.orgA.userId, uploadId: rfq.uploadId, resourceType: "solicitation" });
    if (!claim.ok || !("claim" in claim)) throw new Error("claim failed");
    const [earlier] = await db.insert(opportunities).values({ organizationId: fx.orgA.organizationId, title: "Earlier attempt" }).returning({ id: opportunities.id });
    await db.insert(solicitations).values({ id: claim.claim.resourceId, organizationId: fx.orgA.organizationId, title: "RFQ", storagePath: rfq.key, parseStatus: "uploaded", opportunityId: earlier!.id });
    await releaseClaim({ organizationId: fx.orgA.organizationId, uploadId: rfq.uploadId, claimedAt: claim.claim.claimedAt });

    const res = await createOpportunityFromGsaAction({ ...FIELDS, uploadIds: [rfq.uploadId] });
    if (!res.ok) throw new Error(res.error);
    expect(res).toMatchObject({ solicitationIds: [], attachmentsSkipped: [{ uploadId: rfq.uploadId, name: "RFQ.txt", reason: "This file was already saved on another record." }] });
    const [sol] = await db.select().from(solicitations).where(and(eq(solicitations.organizationId, fx.orgA.organizationId), eq(solicitations.id, claim.claim.resourceId)));
    expect(sol!.opportunityId).toBe(earlier!.id);
    const [ledger] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, fx.orgA.organizationId), eq(fileUploads.id, rfq.uploadId)));
    expect(ledger).toMatchObject({ status: "claimed", purgeAfter: null });
    const jobs = await db.select({ status: backgroundJobs.status }).from(backgroundJobs).where(and(eq(backgroundJobs.organizationId, fx.orgA.organizationId), eq(backgroundJobs.resourceId, claim.claim.resourceId)));
    expect(jobs).toEqual([{ status: "queued" }]);
  });

  it("files the rest when one file's record can't be saved, puts that upload back, and still audits the opportunity", async () => {
    const one = await stored("One.txt", rfpText("ONE"));
    const two = await stored("Two.txt", rfpText("TWO"));
    const three = await stored("Three.txt", rfpText("THREE"));
    const realInsert = db.insert.bind(db);
    let solicitationInserts = 0;
    vi.spyOn(db, "insert").mockImplementation(((table: Parameters<typeof db.insert>[0]) => {
      if (table === solicitations && ++solicitationInserts === 2) throw new Error("Connection terminated unexpectedly");
      return realInsert(table);
    }) as never);

    const res = await createOpportunityFromGsaAction({ ...FIELDS, uploadIds: [one.uploadId, two.uploadId, three.uploadId] });
    if (!res.ok) throw new Error(res.error);
    expect(res.solicitationIds).toHaveLength(2);
    expect(res.attachmentsSkipped).toEqual([{ uploadId: two.uploadId, name: "Two.txt", reason: "Could not record the solicitation; add the file again." }]);
    const ledger = await db.select().from(fileUploads).where(inArray(fileUploads.id, [one.uploadId, two.uploadId, three.uploadId]));
    expect(Object.fromEntries(ledger.map((r) => [r.id, r.status]))).toEqual({ [one.uploadId]: "claimed", [two.uploadId]: "stored", [three.uploadId]: "claimed" });
    const jobs = await db.select().from(backgroundJobs).where(and(eq(backgroundJobs.organizationId, fx.orgA.organizationId), inArray(backgroundJobs.resourceId, res.solicitationIds)));
    expect(jobs).toHaveLength(2);
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "opportunity.create_from_gsa"), eq(auditLogs.resourceId, res.opportunityId)));
    expect(audits).toHaveLength(1);
  });

  it("a batch starts no job past its budget and leaves the rest queued for the jobs cron", async () => {
    const one = await stored("One.txt", rfpText("ONE"));
    const two = await stored("Two.txt", rfpText("TWO"));
    const res = await createOpportunityFromGsaAction({ ...FIELDS, uploadIds: [one.uploadId, two.uploadId] });
    if (!res.ok) throw new Error(res.error);
    const jobs = await db.select().from(backgroundJobs).where(and(eq(backgroundJobs.organizationId, fx.orgA.organizationId), inArray(backgroundJobs.resourceId, res.solicitationIds)));
    const ordered = res.solicitationIds.map((id) => jobs.find((j) => j.resourceId === id)!);
    bg.runs.length = 0;
    runDurableBatch("test", ordered.map((j) => ({ jobId: j.id, organizationId: j.organizationId })), { budgetMs: 0 });
    await bg.runs[0]!();
    const after = await db.select().from(backgroundJobs).where(inArray(backgroundJobs.id, ordered.map((j) => j.id)));
    expect(ordered.map((j) => after.find((a) => a.id === j.id)!.status)).toEqual(["done", "queued"]);
  });
});
