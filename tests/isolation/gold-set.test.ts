/**
 * BL-AIX Phase 1e — the extraction gold set against Postgres: a document
 * from pasted text, reviewer annotations, the approval gate, reopening
 * on any change, notice uniqueness, search and deletion.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { extractionGoldDocs, extractionGoldItems } from "@/db/schema";
import {
  addGoldItem,
  appendGoldDocText,
  createGoldDocFromText,
  decideGoldItem,
  deleteGoldDoc,
  getGoldDoc,
  searchGoldDocText,
  setGoldDocApproved,
} from "@/lib/gold-set";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const RFP = [
  "SECTION C — STATEMENT OF WORK",
  "C.1 The contractor shall migrate 40 legacy applications to a FedRAMP High cloud.",
  "SECTION L — INSTRUCTIONS",
  "L.5.2 Volume I Technical shall not exceed 25 pages, 12-point font.",
  "SECTION M — EVALUATION",
  "M.2 Technical approach is more important than past performance.",
].join("\n");

describe("BL-AIX Phase 1e — extraction gold set (runtime)", () => {
  // The gold set has no tenant; the fixture only supplies a real platform user.
  let fx: TwoTenantFixture;
  let userId = "";
  const created: string[] = [];
  const make = async (noticeId?: string) => {
    const res = await createGoldDocFromText({ title: "Cloud migration RFP", text: RFP, noticeId, userId });
    if (!res.ok) throw new Error(res.error);
    created.push(res.id);
    return res.id;
  };

  beforeEach(async () => {
    fx = await createTwoTenants("gold-set");
    userId = fx.orgA.userId;
  });

  afterEach(async () => {
    if (created.length) await db.delete(extractionGoldDocs).where(inArray(extractionGoldDocs.id, created.splice(0)));
    await fx.cleanup();
  });

  it("stores pasted text as a draft that moves to review with its first annotation", async () => {
    const id = await make();
    expect((await getGoldDoc(id))?.doc).toMatchObject({ status: "draft", files: [{ name: "Pasted text" }] });
    const added = await addGoldItem({ docId: id, item: { kind: "requirement", ref: "C.1", text: "Migrate 40 legacy applications." }, userId });
    expect(added.ok).toBe(true);
    const got = await getGoldDoc(id);
    expect(got?.doc.status).toBe("in_review");
    expect(got?.items[0]).toMatchObject({ origin: "expert", status: "approved", ref: "C.1" });
  });

  it("approves only when every annotation is decided, and reopens on any change", async () => {
    const id = await make();
    await addGoldItem({ docId: id, item: { kind: "requirement", text: "Migrate 40 legacy applications." }, userId });
    const [proposed] = await db
      .insert(extractionGoldItems)
      .values({ docId: id, kind: "page_limit", text: "Volume I shall not exceed 25 pages.", value: "25 pages", origin: "ai", status: "proposed" })
      .returning({ id: extractionGoldItems.id });

    expect(await setGoldDocApproved({ docId: id, approved: true, userId })).toEqual({
      ok: false,
      error: "1 annotation is still waiting for review.",
    });
    await decideGoldItem({ itemId: proposed!.id, status: "approved", userId });
    expect((await setGoldDocApproved({ docId: id, approved: true, userId })).ok).toBe(true);
    expect((await getGoldDoc(id))?.doc).toMatchObject({ status: "approved" });

    await decideGoldItem({ itemId: proposed!.id, status: "rejected", userId });
    expect((await getGoldDoc(id))?.doc).toMatchObject({ status: "in_review", approvedAt: null });

    await setGoldDocApproved({ docId: id, approved: true, userId });
    const appended = await appendGoldDocText({ docId: id, name: "Attachment 3 (scan)", text: "Q&A: offerors shall submit resumes for key personnel only." });
    expect(appended.ok).toBe(true);
    const after = await getGoldDoc(id);
    expect(after?.doc.status).toBe("in_review");
    expect(after?.doc.rawText).toContain("===== Attachment 3 (scan) =====");
  });

  it("keeps one document per notice and searches its text", async () => {
    const id = await make("gold-test-notice-1");
    const again = await createGoldDocFromText({ title: "Dup", text: RFP, noticeId: "gold-test-notice-1", userId });
    expect(again).toEqual({ ok: false, error: "That notice is already in the gold set." });
    const hits = await searchGoldDocText(id, "shall not exceed");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.snippet).toContain("25 pages");
  });

  it("deletes a document with its annotations", async () => {
    const id = await make();
    await addGoldItem({ docId: id, item: { kind: "eval_factor", text: "Technical approach", position: 1 }, userId });
    expect(await deleteGoldDoc(id)).toEqual({ ok: true, title: "Cloud migration RFP" });
    expect(await db.select().from(extractionGoldItems).where(eq(extractionGoldItems.docId, id))).toEqual([]);
    expect(await deleteGoldDoc(id)).toEqual({ ok: false, error: "Document not found." });
  });
});
