/**
 * BL-AIX Phase 1c — a golden-eval case is held out of the drafter's
 * context, against Postgres. Proposal P is the case; proposal Q is
 * another one of the same tenant. Asserts: without the holdout the
 * drafter reads P's review comment, P's debrief and P's tracked-change
 * decisions; with it, it reads none of them, still reads Q's, and drops
 * Q's snippet that copies P's winning text.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  proposalDebriefs,
  proposalReviewComments,
  proposalReviews,
  proposalSections,
  proposals,
  sectionChangeDecisions,
} from "@/db/schema";
import { prepareSectionDraft } from "@/lib/section-draft";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const GOLDEN =
  "Our three-wave migration moves forty applications to the FedRAMP High enclave without downtime. " +
  "Each wave ends with a rollback rehearsal signed off by the agency change board before cutover.";
const P_COMMENT = "Pink team: keep the rollback rehearsal paragraph exactly as written.";
const P_DEBRIEF = "Evaluators wanted the enclave hardening plan earlier in the volume.";
const P_PHRASE = "proposal p kept phrase number";
const Q_PHRASE = "proposal q kept phrase number";
const Q_COPY = "rollback rehearsal signed off by the agency change board";

describe("BL-AIX Phase 1c — golden-eval holdout (runtime)", () => {
  let fx: TwoTenantFixture;
  let sectionP = "";

  beforeEach(async () => {
    fx = await createTwoTenants("golden-holdout");
    const org = fx.orgA.organizationId;
    const [q] = await db
      .insert(proposals)
      .values({ organizationId: org, opportunityId: fx.orgA.opportunityId, title: "Other proposal" })
      .returning({ id: proposals.id });
    const proposalQ = q!.id;
    const [sp, sq] = await db
      .insert(proposalSections)
      .values([
        { proposalId: fx.orgA.proposalId, kind: "technical", title: "Technical approach", content: GOLDEN, wordCount: 32 },
        { proposalId: proposalQ, kind: "technical", title: "Technical approach", content: "Other text.", wordCount: 2 },
      ])
      .returning({ id: proposalSections.id });
    sectionP = sp!.id;

    const [review] = await db.insert(proposalReviews).values({ proposalId: fx.orgA.proposalId, color: "pink" }).returning({ id: proposalReviews.id });
    await db.insert(proposalReviewComments).values({ reviewId: review!.id, sectionId: sectionP, userId: fx.orgA.userId, body: P_COMMENT });
    await db.insert(proposalDebriefs).values([
      { organizationId: org, proposalId: fx.orgA.proposalId, weaknesses: P_DEBRIEF },
      { organizationId: org, proposalId: proposalQ, weaknesses: "Price was eight percent above the awardee." },
    ]);

    const decision = (proposalId: string, sectionId: string, i: number, text: string) => ({
      organizationId: org,
      proposalId,
      sectionId,
      sectionKind: "technical",
      changeId: `${proposalId}-${i}`,
      changeType: "insert",
      decision: "accept",
      authorUserId: fx.orgA.userId,
      authorNameSnapshot: "Author",
      decidedByUserId: fx.orgA.userId,
      changeText: text,
      wordCount: text.split(" ").length,
    });
    await db.insert(sectionChangeDecisions).values([
      ...[1, 2, 3, 4, 5].map((i) => decision(proposalQ, sq!.id, i, `${Q_PHRASE} ${i}`)),
      decision(proposalQ, sq!.id, 6, Q_COPY),
    ]);
    // P's decisions are the newest, so they lead the phrase lists when not held out.
    await db.insert(sectionChangeDecisions).values([1, 2, 3, 4, 5].map((i) => decision(fx.orgA.proposalId, sectionP, i, `${P_PHRASE} ${i}`)));
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  const promptText = (p: Awaited<ReturnType<typeof prepareSectionDraft>>) => {
    if (!p.ok) throw new Error(p.error);
    return [p.prompt.system, ...p.prompt.messages.map((m) => m.content)].join("\n");
  };

  it("reads the case's own proposal without the holdout", async () => {
    const text = promptText(
      await prepareSectionDraft({ organizationId: fx.orgA.organizationId, sectionId: sectionP, mode: "draft", currentBodyPlain: "" }),
    );
    expect(text).toContain(P_COMMENT);
    expect(text).toContain(P_DEBRIEF);
    expect(text).toContain(P_PHRASE);
  });

  it("holds the case's proposal out and drops other snippets that copy the winner", async () => {
    const prepared = await prepareSectionDraft({
      organizationId: fx.orgA.organizationId,
      sectionId: sectionP,
      mode: "draft",
      currentBodyPlain: "",
      holdout: { proposalId: fx.orgA.proposalId, goldenText: GOLDEN },
    });
    const text = promptText(prepared);
    expect(text).not.toContain(P_COMMENT);
    expect(text).not.toContain(P_DEBRIEF);
    expect(text).not.toContain(P_PHRASE);
    expect(text).toContain(Q_PHRASE);
    expect(text).not.toContain(Q_COPY);
    expect(prepared.ok && prepared.holdoutDropped).toBe(1);
  });

  it("never reads another tenant's proposal as the case", async () => {
    const foreign = await prepareSectionDraft({
      organizationId: fx.orgB.organizationId,
      sectionId: sectionP,
      mode: "draft",
      currentBodyPlain: "",
      holdout: { proposalId: fx.orgA.proposalId, goldenText: GOLDEN },
    });
    expect(foreign).toEqual({ ok: false, error: "Section not found." });
  });
});
