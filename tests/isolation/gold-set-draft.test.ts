/**
 * BL-AIX Phase 1e-2 — AI-drafted gold annotations against Postgres, with
 * the model mocked. Asserts: every window is read and its findings become
 * proposed AI annotations; progress is saved per window and a budgeted run
 * resumes where it stopped; a re-read proposes nothing already present;
 * the calls are metered to the acting admin's organisation; approved
 * documents and stub mode are refused.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { aiCallLogs, extractionGoldDocs, extractionGoldItems } from "@/db/schema";
import { __setCompleteImplForTest } from "@/lib/ai";
import { createGoldDocFromText, setGoldDocApproved } from "@/lib/gold-set";
import { draftGoldAnnotations, resetGoldDraft } from "@/lib/gold-set-draft";
import { goldWindows } from "@/lib/gold-set-logic";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const para = (i: number) => `C.${i} The contractor shall perform task number ${i} in full.\n\n`;
const TEXT = Array.from({ length: 1_600 }, (_, i) => para(i)).join("");

describe("BL-AIX Phase 1e-2 — AI-drafted gold annotations (runtime)", () => {
  let fx: TwoTenantFixture;
  let docId = "";
  let calls = 0;
  let stubbed = false;

  beforeEach(async () => {
    fx = await createTwoTenants("gold-draft");
    const res = await createGoldDocFromText({ title: "Draft test RFP", text: TEXT, userId: fx.orgA.userId });
    if (!res.ok) throw new Error(res.error);
    docId = res.id;
    calls = 0;
    stubbed = false;
    // Each window "finds" one requirement named after the window, plus a shared factor.
    __setCompleteImplForTest(async (opts) => {
      calls += 1;
      const window = String(opts.messages[0]?.content ?? "").match(/Window (\d+) of/)?.[1] ?? "?";
      return {
        text: "",
        provider: "stub" as const,
        model: "test-mock",
        inputTokens: 10,
        outputTokens: 10,
        stubbed,
        structured: {
          requirements: [{ ref: `W${window}`, text: `Requirement found in window ${window}.` }],
          pageLimits: [],
          evalFactors: [{ ref: "M.1", name: "Technical approach", importance: "most important", order: 1 }],
        },
      };
    });
  });

  afterEach(async () => {
    __setCompleteImplForTest(null);
    await db.delete(extractionGoldDocs).where(eq(extractionGoldDocs.id, docId));
    await fx.cleanup();
  });

  const items = () => db.select().from(extractionGoldItems).where(eq(extractionGoldItems.docId, docId));

  it("reads every window, proposes AI annotations once each, and meters the admin's organisation", async () => {
    // The stored text carries a "Pasted text" header, so windows come from what was stored.
    const [stored] = await db.select({ rawText: extractionGoldDocs.rawText }).from(extractionGoldDocs).where(eq(extractionGoldDocs.id, docId));
    const windows = goldWindows(stored!.rawText).length;
    expect(windows).toBeGreaterThan(1);
    const res = await draftGoldAnnotations({ docId, organizationId: fx.orgA.organizationId, budgetMs: 600_000 });
    expect(res).toMatchObject({ ok: true, done: true, windowsThisRun: windows });
    expect(calls).toBe(windows);

    const rows = await items();
    expect(rows.filter((r) => r.kind === "requirement")).toHaveLength(windows);
    expect(rows.filter((r) => r.kind === "eval_factor")).toHaveLength(1);
    expect(rows.every((r) => r.origin === "ai" && r.status === "proposed")).toBe(true);

    const [doc] = await db.select().from(extractionGoldDocs).where(eq(extractionGoldDocs.id, docId));
    expect(doc!.status).toBe("in_review");
    expect(doc!.aiDraft).toMatchObject({ doneChars: stored!.rawText.length, windowsDone: windows, proposed: windows + 1, duplicates: windows - 1, model: "test-mock" });

    const logged = await db
      .select({ id: aiCallLogs.id })
      .from(aiCallLogs)
      .where(and(eq(aiCallLogs.organizationId, fx.orgA.organizationId), eq(aiCallLogs.feature, "gold_annotate")));
    expect(logged).toHaveLength(windows);
  });

  it("stops at the budget after one window and resumes; a re-read proposes nothing new", async () => {
    let t = 0;
    const first = await draftGoldAnnotations({ docId, organizationId: fx.orgA.organizationId, budgetMs: 10, now: () => (t += 100) });
    expect(first).toMatchObject({ ok: true, done: false, windowsThisRun: 1 });
    const rest = await draftGoldAnnotations({ docId, organizationId: fx.orgA.organizationId, budgetMs: 600_000 });
    expect(rest).toMatchObject({ ok: true, done: true });
    const before = (await items()).length;

    await resetGoldDraft(docId);
    const again = await draftGoldAnnotations({ docId, organizationId: fx.orgA.organizationId, budgetMs: 600_000 });
    expect(again.ok && again.state.proposed).toBe(0);
    expect((await items()).length).toBe(before);
  });

  it("refuses an approved document and stub mode, writing nothing", async () => {
    await db.insert(extractionGoldItems).values({ docId, kind: "requirement", text: "Expert requirement.", origin: "expert", status: "approved" });
    await setGoldDocApproved({ docId, approved: true, userId: fx.orgA.userId });
    expect(await draftGoldAnnotations({ docId, organizationId: fx.orgA.organizationId })).toEqual({
      ok: false,
      error: "Reopen the document before drafting more annotations.",
    });
    await setGoldDocApproved({ docId, approved: false, userId: fx.orgA.userId });

    stubbed = true;
    const res = await draftGoldAnnotations({ docId, organizationId: fx.orgA.organizationId });
    expect(res).toEqual({ ok: false, error: "AI is in stub mode, so nothing was drafted. Configure a provider first." });
    expect(await db.select().from(extractionGoldItems).where(and(eq(extractionGoldItems.docId, docId), inArray(extractionGoldItems.origin, ["ai"])))).toEqual([]);
  });
});
