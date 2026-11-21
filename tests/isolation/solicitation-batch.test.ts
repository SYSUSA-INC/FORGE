/**
 * BL-STAB-3 — New Solicitation takes several files: each stored upload is
 * labelled without being claimed, and a confirmed batch is filed as one
 * base solicitation, its amendments as children in number order, and the
 * rest as typed companion documents. Pricing sheets and forms are kept
 * without a requirement sweep; a Q&A file's answers land in the Q&A panel
 * and go with the file. Another organization's uploads are refused.
 * Postgres; memory storage stands in for R2; background work is run by
 * hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, backgroundJobs, fileUploads, solicitationDocuments, solicitationQa, solicitations } from "@/db/schema";
import { executeJob } from "@/lib/jobs";
import { rematchSolicitationQa } from "@/lib/solicitation-qa";
import { getStorageProvider } from "@/lib/storage";
import { completeUpload, createUploadIntent } from "@/lib/uploads";
import { createTwoTenants, type TwoTenantFixture, withUploadPlans } from "../helpers/fixtures";

const sessionUserStub = {
  id: "PLACEHOLDER",
  email: "capture@batch.test",
  name: "Capture Lead",
  image: null as null,
  isSuperadmin: false as const,
  organizationId: "PLACEHOLDER",
  role: "admin" as const,
};

vi.mock("@/lib/auth-helpers", () => ({
  requireAuth: async () => sessionUserStub,
  requireCurrentOrg: async () => ({ user: sessionUserStub, organizationId: sessionUserStub.organizationId, isImpersonating: false }),
  requireOrgAdmin: async () => sessionUserStub,
  getSessionUser: async () => sessionUserStub,
}));
vi.mock("@/lib/background", () => ({ runInBackground: () => undefined, backgroundIsDurable: () => false }));

import { classifyUploadedFileAction, fileSolicitationBatchAction } from "@/app/(app)/solicitations/batch-actions";
import { deleteSolicitationDocumentAction } from "@/app/(app)/solicitations/[id]/document-actions";

const enc = (lines: string[]) => new TextEncoder().encode(lines.join("\n"));
const RFP = enc([
  "SOLICITATION/CONTRACT/ORDER FOR COMMERCIAL PRODUCTS AND COMMERCIAL SERVICES",
  "Request for Proposal 70B01C25R00000012 — Help Desk Support",
  "C.3.1 The contractor shall staff the help desk from 7 a.m. to 7 p.m. Eastern on business days.",
  "SECTION L - INSTRUCTIONS, CONDITIONS, AND NOTICES TO OFFERORS",
  "SECTION M - EVALUATION FACTORS FOR AWARD",
]);
const SF30 = (n: string) => enc(["AMENDMENT OF SOLICITATION/MODIFICATION OF CONTRACT", `2. AMENDMENT/MODIFICATION NO. ${n}`, "The above numbered solicitation is amended as set forth in Item 14."]);
const QA = enc(["Questions and Answers", "Q1: Must the help desk be staffed on federal holidays?", "A1: No. The help desk is staffed on business days only.", "Q2: Will the due date move?", "A2: No, the date stands."]);
const PRICING = enc(["CLIN\tDescription\tQuantity\tUnit Price\tExtended Price", "0001\tHelp desk support\t12\t\t", "The contractor shall complete every row."]);

describe("BL-STAB-3 — several files into New Solicitation (runtime)", () => {
  let fx: TwoTenantFixture;
  let plans: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    fx = await createTwoTenants("sol-batch");
    plans = await withUploadPlans(fx);
    sessionUserStub.id = fx.orgA.userId;
    sessionUserStub.organizationId = fx.orgA.organizationId;
  });
  afterEach(async () => {
    await plans?.();
    await fx.cleanup();
  });

  async function storedUpload(name: string, bytes: Uint8Array, org = fx.orgA) {
    const actor = { userId: org.userId, email: null };
    const intent = await createUploadIntent({ organizationId: org.organizationId, actor, purpose: "document", fileName: name, size: bytes.byteLength, origin: "" });
    if (!intent.ok) throw new Error(intent.error);
    const [row] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, org.organizationId), eq(fileUploads.id, intent.uploadId)));
    await getStorageProvider().put({ key: row!.storageKey, bytes, contentType: row!.contentType });
    const done = await completeUpload({ organizationId: org.organizationId, actor, uploadId: intent.uploadId });
    if (!done.ok) throw new Error(done.error);
    return intent.uploadId;
  }
  async function runJobFor(resourceId: string) {
    const [job] = await db.select().from(backgroundJobs).where(and(eq(backgroundJobs.organizationId, fx.orgA.organizationId), eq(backgroundJobs.resourceId, resourceId)));
    await executeJob(job!.id, fx.orgA.organizationId, { viaCron: true }).catch(() => undefined);
  }
  const docs = (solicitationId: string) =>
    db.select().from(solicitationDocuments).where(and(eq(solicitationDocuments.organizationId, fx.orgA.organizationId), eq(solicitationDocuments.solicitationId, solicitationId)));

  it("labels a stored upload from its text without claiming it, and never returns its storage key", async () => {
    const uploadId = await storedUpload("scan_0001.txt", SF30("0002"));
    const res = await classifyUploadedFileAction({ uploadId });
    if (!res.ok) throw new Error(res.error);
    expect(res.file).toMatchObject({ uploadId, fileName: "scan_0001.txt", label: "amendment", amendmentNumber: "0002", basis: "rules", note: "" });
    expect(res.file.evidence[0]!.quote).toContain("AMENDMENT OF SOLICITATION");
    expect(JSON.stringify(res.file)).not.toContain("storageKey");
    const [row] = await db.select().from(fileUploads).where(and(eq(fileUploads.organizationId, fx.orgA.organizationId), eq(fileUploads.id, uploadId)));
    expect(row!.status).toBe("stored");
    expect(JSON.stringify(res.file)).not.toContain(row!.storageKey);
  });

  it("files the base, the amendments under it in number order, and the rest as typed companions", async () => {
    const base = await storedUpload("RFP.txt", RFP);
    const amd2 = await storedUpload("Amendment 0002.txt", SF30("0002"));
    const amd1 = await storedUpload("Amendment 0001.txt", SF30("0001"));
    const qa = await storedUpload("Questions and Answers.txt", QA);
    const pricing = await storedUpload("Pricing.txt", PRICING);
    const batch = {
      files: [
        { uploadId: amd2, label: "amendment", amendmentNumber: "0002" },
        { uploadId: base, label: "base" },
        { uploadId: qa, label: "qa" },
        { uploadId: amd1, label: "amendment", amendmentNumber: "0001" },
        { uploadId: pricing, label: "pricing" },
      ],
    };
    const res = await fileSolicitationBatchAction(batch);
    if (!res.ok) throw new Error(res.error);
    expect(res.failed).toEqual([]);
    expect(res.filed.map((f) => f.label)).toEqual(["base", "amendment", "amendment", "qa", "pricing"]);
    // Sending the same batch again (a lost answer) files nothing twice.
    const again = await fileSolicitationBatchAction(batch);
    expect(again).toMatchObject({ ok: true, solicitationId: res.solicitationId, failed: [] });

    const rows = await db.select().from(solicitations).where(eq(solicitations.organizationId, fx.orgA.organizationId)).orderBy(asc(solicitations.createdAt));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ id: res.solicitationId, parentSolicitationId: null, fileName: "RFP.txt" });
    expect(rows.slice(1).map((r) => [r.parentSolicitationId, r.amendmentNumber])).toEqual([
      [res.solicitationId, "0001"],
      [res.solicitationId, "0002"],
    ]);
    expect((await docs(res.solicitationId)).map((d) => d.documentType).sort()).toEqual(["pricing", "qa"]);

    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "solicitation.batch.upload")));
    expect(audits).toHaveLength(2);
    expect(audits[0]!.metadata).toMatchObject({ files: 5, filed: 5, failed: 0, amendments: 2, companions: 2 });

    // The pricing sheet is kept and readable, with no requirements swept from it.
    const pricingId = res.filed.find((f) => f.label === "pricing")!.id;
    await runJobFor(pricingId);
    const [sheet] = await db.select().from(solicitationDocuments).where(and(eq(solicitationDocuments.organizationId, fx.orgA.organizationId), eq(solicitationDocuments.id, pricingId)));
    expect(sheet).toMatchObject({ parseStatus: "parsed", extractedRequirements: [] });
    expect(sheet!.rawText).toContain("Unit Price");

    // The Q&A file's answers land in the Q&A panel, tied to the file.
    const qaId = res.filed.find((f) => f.label === "qa")!.id;
    await runJobFor(qaId);
    const pairs = () => db.select().from(solicitationQa).where(and(eq(solicitationQa.organizationId, fx.orgA.organizationId), eq(solicitationQa.solicitationId, res.solicitationId)));
    const stored = await pairs();
    expect(stored).toHaveLength(2);
    expect(stored.every((p) => p.sourceDocumentId === qaId && p.source === "attachment" && p.sourceRef === "Questions and Answers.txt")).toBe(true);

    // Read before the solicitation had requirements: matched once it does.
    expect(stored.every((p) => p.affectedRefs.length === 0)).toBe(true);
    await db
      .update(solicitations)
      .set({ extractedRequirements: [{ kind: "shall", ref: "C.3.1", text: "The contractor shall staff the help desk from 7 a.m. to 7 p.m. Eastern on business days." }] })
      .where(and(eq(solicitations.organizationId, fx.orgA.organizationId), eq(solicitations.id, res.solicitationId)));
    expect(await rematchSolicitationQa({ organizationId: fx.orgA.organizationId, solicitationId: res.solicitationId })).toBe(1);
    expect((await pairs()).filter((p) => p.affectedRefs.length > 0)).toHaveLength(1);
    // Another organization cannot re-match this solicitation's answers.
    expect(await rematchSolicitationQa({ organizationId: fx.orgB.organizationId, solicitationId: res.solicitationId })).toBe(0);

    // Removing the Q&A file removes its answers.
    expect(await deleteSolicitationDocumentAction(qaId)).toMatchObject({ ok: true });
    expect(await pairs()).toHaveLength(0);
  });

  it("a Q&A file with no answered questions fails with the reason and keeps its text", async () => {
    const base = await storedUpload("RFP.txt", RFP);
    const notQa = await storedUpload("notes.txt", enc(["General notes from industry day.", "Nothing here is a question."]));
    const res = await fileSolicitationBatchAction({ files: [{ uploadId: base, label: "base" }, { uploadId: notQa, label: "qa" }] });
    if (!res.ok) throw new Error(res.error);
    const id = res.filed.find((f) => f.label === "qa")!.id;
    await runJobFor(id);
    const [doc] = await db.select().from(solicitationDocuments).where(and(eq(solicitationDocuments.organizationId, fx.orgA.organizationId), eq(solicitationDocuments.id, id)));
    expect(doc!.parseStatus).toBe("failed");
    expect(doc!.parseError).toMatch(/No question\/answer pairs/);
    expect(doc!.rawText).toContain("industry day");
  });

  it("refuses a batch without exactly one base, an unknown label, and files nothing", async () => {
    const a = await storedUpload("Amendment 0001.txt", SF30("0001"));
    const b = await storedUpload("RFP.txt", RFP);
    expect(await fileSolicitationBatchAction({ files: [{ uploadId: a, label: "amendment" }] })).toMatchObject({ ok: false, error: expect.stringMatching(/Mark one file as the base/) });
    expect(await fileSolicitationBatchAction({ files: [{ uploadId: a, label: "base" }, { uploadId: b, label: "base" }] })).toMatchObject({ ok: false, error: expect.stringMatching(/Only one file/) });
    expect(await fileSolicitationBatchAction({ files: [{ uploadId: b, label: "base" }, { uploadId: a, label: "contract" }] })).toMatchObject({ ok: false });
    expect(await db.select().from(solicitations).where(eq(solicitations.organizationId, fx.orgA.organizationId))).toHaveLength(0);
  });

  it("refuses another organization's uploads: not labelled, not filed, and still theirs to file", async () => {
    const theirs = await storedUpload("RFP.txt", RFP, fx.orgB);
    const theirAmendment = await storedUpload("Amendment 0001.txt", SF30("0001"), fx.orgB);
    expect(await classifyUploadedFileAction({ uploadId: theirs })).toEqual({ ok: false, error: "Upload not found." });
    expect(await fileSolicitationBatchAction({ files: [{ uploadId: theirs, label: "base" }] })).toMatchObject({ ok: false });

    // Organization A's own base with B's amendment: the base is filed, the foreign file is reported and left alone.
    const mine = await storedUpload("RFP.txt", RFP);
    const res = await fileSolicitationBatchAction({ files: [{ uploadId: mine, label: "base" }, { uploadId: theirAmendment, label: "amendment", amendmentNumber: "0001" }] });
    if (!res.ok) throw new Error(res.error);
    expect(res.filed).toHaveLength(1);
    expect(res.failed).toEqual([{ uploadId: theirAmendment, error: expect.any(String) }]);
    expect(await db.select().from(solicitations).where(eq(solicitations.organizationId, fx.orgB.organizationId))).toHaveLength(0);
    const untouched = await db.select().from(fileUploads).where(eq(fileUploads.organizationId, fx.orgB.organizationId));
    expect(untouched.every((u) => u.status === "stored")).toBe(true);
  });
});
