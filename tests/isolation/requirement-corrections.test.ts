/**
 * BL-AIX Phase 2c — verify and correct, against Postgres: verdicts change
 * the solicitation's list, rejected clauses reach no reader, verdicts
 * survive a re-parse and can be undone, and another organization can
 * neither change nor see them.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { requirementCorrections, solicitationDocuments, solicitations } from "@/db/schema";
import { __setCompleteImplForTest } from "@/lib/ai";
import { parseSolicitationFromBytes } from "@/lib/solicitation-parse";
import {
  addRequirement,
  clearRequirementReview,
  confirmVerbatimRequirements,
  reviewRequirement,
} from "@/lib/requirement-corrections";
import type { ReviewedRequirement } from "@/lib/requirement-review";
import { requirementKey } from "@/lib/requirements-text";
import { loadOpportunityRequirements, mergeSolicitationRequirements } from "@/lib/solicitation-requirements";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const extracted: ReviewedRequirement[] = [
  { kind: "shall", text: "The contractor shall complete transition within 30 days of award.", ref: "C.3", source: { quote: "exact", at: 10, page: 2, section: "C" } },
  { kind: "shall", text: "Volume I shall not exceed 25 pages.", ref: "L.5", source: { quote: "partial", at: 400, page: 4, section: "L" } },
  { kind: "should", text: "The contractor should delight every single user.", ref: "", source: { quote: "none" } },
];
const key = (i: number) => requirementKey(extracted[i]!.text);

describe("BL-AIX Phase 2c — verify and correct (runtime)", () => {
  let fx: TwoTenantFixture;
  let solicitationId: string;

  beforeEach(async () => {
    fx = await createTwoTenants("requirement-corrections");
    const [row] = await db
      .insert(solicitations)
      .values({
        organizationId: fx.orgA.organizationId,
        opportunityId: fx.orgA.opportunityId,
        title: "Help desk RFP",
        parseStatus: "parsed",
        extractedRequirements: extracted,
      })
      .returning({ id: solicitations.id });
    solicitationId = row!.id;
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  const actorA = () => ({ userId: fx.orgA.userId });
  const stored = async () => {
    const [row] = await db.select({ list: solicitations.extractedRequirements }).from(solicitations).where(eq(solicitations.id, solicitationId));
    return row!.list as ReviewedRequirement[];
  };

  it("edits, rejects, confirms and adds; a rejected clause leaves the opportunity's requirements", async () => {
    const org = { organizationId: fx.orgA.organizationId, solicitationId, actor: actorA() };
    expect(await reviewRequirement({ ...org, docKey: "", originalKey: key(0), action: "confirmed" })).toEqual({ ok: true });
    expect(
      await reviewRequirement({ ...org, docKey: "", originalKey: key(1), action: "edited", corrected: { kind: "shall", text: "Volume I shall not exceed 30 pages.", ref: "L.5.1" } }),
    ).toEqual({ ok: true });
    expect(await reviewRequirement({ ...org, docKey: "", originalKey: key(2), action: "rejected" })).toEqual({ ok: true });
    expect(await addRequirement({ ...org, clause: { kind: "may", text: "Offerors may include a cover letter.", ref: "L.2" } })).toEqual({ ok: true });

    const list = await stored();
    expect(list.map((r) => [r.text, r.review?.status])).toEqual([
      [extracted[0]!.text, "confirmed"],
      ["Volume I shall not exceed 30 pages.", "edited"],
      [extracted[2]!.text, "rejected"],
      ["Offerors may include a cover letter.", "added"],
    ]);
    expect(list[1]!.source).toMatchObject({ page: 4 });

    const loaded = await loadOpportunityRequirements({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId });
    expect(loaded.requirements.map((r) => r.text)).toEqual([extracted[0]!.text, "Volume I shall not exceed 30 pages.", "Offerors may include a cover letter."]);

    expect(await reviewRequirement({ ...org, docKey: "", originalKey: key(1), action: "edited", corrected: { text: "  " } })).toEqual({
      ok: false,
      error: "The requirement text can't be empty.",
    });
  });

  it("re-applies verdicts after a re-parse, and undo restores the extracted wording", async () => {
    const org = { organizationId: fx.orgA.organizationId, solicitationId, actor: actorA() };
    await reviewRequirement({ ...org, docKey: "", originalKey: key(1), action: "edited", corrected: { text: "Volume I shall not exceed 30 pages." } });
    await reviewRequirement({ ...org, docKey: "", originalKey: key(2), action: "rejected" });

    // A re-parse writes the extracted list afresh, then merges.
    await db.update(solicitations).set({ extractedRequirements: extracted }).where(eq(solicitations.id, solicitationId));
    await mergeSolicitationRequirements(solicitationId, fx.orgA.organizationId);
    expect((await stored()).map((r) => r.review?.status ?? null)).toEqual([null, "edited", "rejected"]);

    expect(await clearRequirementReview({ ...org, docKey: "", originalKey: key(1) })).toEqual({ ok: true });
    const after = await stored();
    expect(after[1]).toMatchObject({ text: extracted[1]!.text, ref: "L.5" });
    expect(after[1]!.review).toBeUndefined();
    expect(await clearRequirementReview({ ...org, docKey: "", originalKey: key(1) })).toEqual({ ok: false, error: "Nothing to undo." });
  });

  it("confirms every unreviewed clause found word for word in one go", async () => {
    const res = await confirmVerbatimRequirements({ organizationId: fx.orgA.organizationId, solicitationId, actor: actorA() });
    expect(res).toEqual({ ok: true, confirmed: 1 });
    expect((await stored()).map((r) => r.review?.status ?? null)).toEqual(["confirmed", null, null]);
  });

  it("keeps another organization out", async () => {
    const asB = { organizationId: fx.orgB.organizationId, solicitationId, actor: { userId: fx.orgB.userId } };
    const notFound = { ok: false, error: "Solicitation not found." };
    expect(await reviewRequirement({ ...asB, docKey: "", originalKey: key(2), action: "rejected" })).toEqual(notFound);
    expect(await addRequirement({ ...asB, clause: { text: "Planted clause." } })).toEqual(notFound);
    expect(await clearRequirementReview({ ...asB, docKey: "", originalKey: key(2) })).toEqual(notFound);
    expect(await confirmVerbatimRequirements(asB)).toEqual(notFound);
    expect(
      await db.select().from(requirementCorrections).where(and(eq(requirementCorrections.solicitationId, solicitationId))),
    ).toEqual([]);
    expect((await stored()).every((r) => !r.review)).toBe(true);
  });

  // ── BL-AIX Phase 2c-1 review fixes ───────────────────────────────────

  it("keeps verdicts when an image solicitation is re-parsed through vision", async () => {
    const org = { organizationId: fx.orgA.organizationId, solicitationId, actor: actorA() };
    await db.update(solicitations).set({ fileName: "scan.png", contentType: "image/png" }).where(eq(solicitations.id, solicitationId));
    await reviewRequirement({ ...org, docKey: "", originalKey: key(2), action: "rejected" });

    const prevKey = process.env.ANTHROPIC_API_KEY;
    const prevProvider = process.env.AI_PROVIDER;
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.AI_PROVIDER = "anthropic";
    __setCompleteImplForTest(async () => ({
      text: "",
      provider: "anthropic" as const,
      model: "test-mock",
      inputTokens: 5,
      outputTokens: 5,
      stubbed: false,
      structured: {
        title: "Help desk RFP",
        agency: "",
        office: "",
        solicitationNumber: "",
        type: "rfp",
        naicsCode: "",
        setAside: "",
        responseDueDate: null,
        sectionLSummary: "",
        sectionMSummary: "",
        // The vision read finds one clause the earlier parse did not, so the write is visible.
        requirements: [...extracted.map(({ kind, text, ref }) => ({ kind, text, ref })), { kind: "shall", text: "The contractor shall keep a visitor log.", ref: "C.9" }],
      },
    }));
    try {
      await parseSolicitationFromBytes(solicitationId, fx.orgA.organizationId, new Uint8Array([137, 80, 78, 71]));
    } finally {
      __setCompleteImplForTest(null);
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevKey;
      if (prevProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = prevProvider;
    }
    const [row] = await db
      .select({ parseStatus: solicitations.parseStatus, sectionLSummary: solicitations.sectionLSummary })
      .from(solicitations)
      .where(eq(solicitations.id, solicitationId));
    expect(row!.parseStatus).toBe("parsed");
    expect(row!.sectionLSummary).toContain("vision OCR");
    const list = await stored();
    expect(list.map((r) => [r.text, r.review?.status ?? null])).toEqual([
      [extracted[0]!.text, null],
      [extracted[1]!.text, null],
      [extracted[2]!.text, "rejected"],
      ["The contractor shall keep a visitor log.", null],
    ]);
  });

  it("does not bring back a companion document's copy of a clause the team edited", async () => {
    await db.insert(solicitationDocuments).values({
      organizationId: fx.orgA.organizationId,
      solicitationId,
      fileName: "pws.pdf",
      parseStatus: "parsed",
      extractedRequirements: [{ kind: "shall", text: extracted[1]!.text, ref: "" }],
    });
    await mergeSolicitationRequirements(solicitationId, fx.orgA.organizationId);
    const org = { organizationId: fx.orgA.organizationId, solicitationId, actor: actorA() };
    await reviewRequirement({ ...org, docKey: "", originalKey: key(1), action: "edited", corrected: { kind: "shall", text: "Volume I shall not exceed 30 pages.", ref: "L.5" } });
    // Any later merge (another verdict, a re-parse) must not resurrect the old wording.
    await reviewRequirement({ ...org, docKey: "", originalKey: key(0), action: "confirmed" });
    const texts = (await stored()).map((r) => r.text);
    expect(texts).toContain("Volume I shall not exceed 30 pages.");
    expect(texts).not.toContain(extracted[1]!.text);
  });

  it("keeps a rejected clause out when an amendment on the same opportunity repeats it", async () => {
    await db.insert(solicitations).values({
      organizationId: fx.orgA.organizationId,
      opportunityId: fx.orgA.opportunityId,
      title: "Amendment 0001",
      parseStatus: "parsed",
      extractedRequirements: [{ kind: "should", text: extracted[2]!.text, ref: "" }],
    });
    await reviewRequirement({ organizationId: fx.orgA.organizationId, solicitationId, actor: actorA(), docKey: "", originalKey: key(2), action: "rejected" });
    const loaded = await loadOpportunityRequirements({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId });
    expect(loaded.requirements.map((r) => r.text)).not.toContain(extracted[2]!.text);
  });

  it("does not let an amendment's bulk confirm undo a rejection made on its base", async () => {
    const amendmentList: ReviewedRequirement[] = [{ ...extracted[2]!, source: { quote: "exact", at: 3 } }];
    const [amendment] = await db
      .insert(solicitations)
      .values({
        organizationId: fx.orgA.organizationId,
        opportunityId: fx.orgA.opportunityId,
        title: "Amendment 0001",
        parseStatus: "parsed",
        extractedRequirements: amendmentList,
      })
      .returning({ id: solicitations.id });
    await reviewRequirement({ organizationId: fx.orgA.organizationId, solicitationId, actor: actorA(), docKey: "", originalKey: key(2), action: "rejected" });
    const res = await confirmVerbatimRequirements({ organizationId: fx.orgA.organizationId, solicitationId: amendment!.id, actor: actorA() });
    expect(res).toEqual({ ok: true, confirmed: 0 });
    const loaded = await loadOpportunityRequirements({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId });
    expect(loaded.requirements.map((r) => r.text)).not.toContain(extracted[2]!.text);
  });
});
