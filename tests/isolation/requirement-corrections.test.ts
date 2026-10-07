/**
 * BL-AIX Phase 2c — verify and correct, against Postgres: verdicts change
 * the solicitation's list, rejected clauses reach no reader, verdicts
 * survive a re-parse and can be undone, and another organization can
 * neither change nor see them.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { requirementCorrections, solicitations } from "@/db/schema";
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
});
