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
import { getStorageProvider } from "@/lib/storage";
import { completeUpload, createUploadIntent } from "@/lib/uploads";
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
    await fx.cleanup();
  });

  async function stored(fileName: string, text: string, which: "A" | "B" = "A") {
    const { organizationId, userId } = which === "A" ? fx.orgA : fx.orgB;
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
    // Another organization's upload: not found here, and left as it was.
    const foreign = await stored("Theirs.txt", "Org B's file.", "B");

    const res = await createOpportunityFromGsaAction({ ...FIELDS, uploadIds: [rfq.uploadId, foreign.uploadId, pws.uploadId] });
    if (!res.ok) throw new Error(res.error);
    expect(res.attachmentsSkipped).toEqual([{ name: "An attachment", reason: "Upload not found." }]);
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
    expect(res).toMatchObject({ solicitationIds: [], attachmentsSkipped: [{ name: "RFQ.txt", reason: "This file was already saved." }] });
    expect(bg.runs).toHaveLength(0);
    const [sol] = await db.select().from(solicitations).where(and(eq(solicitations.organizationId, fx.orgA.organizationId), eq(solicitations.id, filed.id)));
    expect(sol!.opportunityId).toBeNull();

    const tooMany = await createOpportunityFromGsaAction({ ...FIELDS, title: "Too many attachments", uploadIds: Array.from({ length: 21 }, () => randomUUID()) });
    expect(tooMany).toMatchObject({ ok: false, error: expect.stringMatching(/^At most 20 attachments/) });
    expect(await db.select().from(opportunities).where(and(eq(opportunities.organizationId, fx.orgA.organizationId), eq(opportunities.title, "Too many attachments")))).toEqual([]);
  });
});
