/**
 * BL-NAV-LIFECYCLE 5d-2 — the weekly style note.
 * Asserts: a note is built from its own tenant's decisions and AI drafts
 * only, and tenant B never reads tenant A's; fewer than five decisions
 * build nothing; a note whose decisions have aged out is removed; the
 * weekly run rebuilds each tenant under its own id and writes an audit
 * row; the drafter's edit feedback carries the tenant's own note and none
 * for a golden-eval case; the cron route refuses a call without the secret.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { auditLogs, proposalSections, sectionChangeDecisions, sectionStyleNotes } from "@/db/schema";
import { GET as styleNotesCron } from "@/app/api/cron/style-notes/route";
import { recordAiDraftSnapshot } from "@/lib/draft-learning";
import { gatherEditFeedbackForSection } from "@/lib/edit-feedback";
import { getStyleNoteView, listStyleNotes, rebuildStyleNotesForOrg, runStyleNoteCron } from "@/lib/style-note";
import { fromPlainText } from "@/lib/tiptap-doc";
import { createTwoTenants, type TwoTenantFixture, type TenantFixture } from "../helpers/fixtures";

const A_KEPT = ["a single accountable lead for delivery", "our single accountable lead owns the outcome", "one single accountable lead per task order"];
const A_CUT = ["world-class synergy across the whole enterprise", "a world-class team of seasoned experts", "world-class support around the clock"];
const B_KEPT = ["mission assurance through layered redundancy", "layered redundancy for mission assurance always", "mission assurance backed by layered redundancy"];
const B_CUT = ["cutting-edge paradigms for the modern age", "our cutting-edge platform is second to none", "cutting-edge thinking in every deliverable"];

describe("BL-NAV-LIFECYCLE 5d-2 — style notes", () => {
  let fx: TwoTenantFixture;
  let sectionA: string;
  let sectionB: string;
  const savedSecret = process.env.CRON_SECRET;

  const addSection = async (proposalId: string, text: string) => {
    const [row] = await db
      .insert(proposalSections)
      .values({ proposalId, kind: "technical", title: "Technical", bodyDoc: fromPlainText(text), content: text })
      .returning({ id: proposalSections.id });
    return row!.id;
  };
  const decide = async (t: TenantFixture, sectionId: string, kept: string[], cut: string[], reviewColor: string | null = null) => {
    const base = { organizationId: t.organizationId, proposalId: t.proposalId, sectionId, sectionKind: "technical", decidedByUserId: t.userId, authorUserId: "a-teammate" };
    await db.insert(sectionChangeDecisions).values([
      ...kept.map((text, i) => ({ ...base, changeId: `k${i}`, changeType: "insert", decision: "accept", changeText: text, reviewColor })),
      ...cut.map((text, i) => ({ ...base, changeId: `c${i}`, changeType: "delete", decision: "accept", changeText: text })),
    ]);
  };

  beforeEach(async () => {
    fx = await createTwoTenants("style");
    sectionA = await addSection(fx.orgA.proposalId, "A person rewrote this section completely and kept none of it.");
    sectionB = await addSection(fx.orgB.proposalId, "Tenant B's own text.");
    await decide(fx.orgA, sectionA, A_KEPT, A_CUT, "pink");
    await decide(fx.orgB, sectionB, B_KEPT, B_CUT);
    await recordAiDraftSnapshot({
      organizationId: fx.orgA.organizationId,
      proposalId: fx.orgA.proposalId,
      sectionId: sectionA,
      draftText: "We deliver best-in-class value to every stakeholder we serve.",
      requestedByUserId: null,
    });
  });

  afterEach(async () => {
    if (savedSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = savedSecret;
    await fx.cleanup();
  });

  it("builds a tenant's note from its own edits and never shows it to another tenant", async () => {
    const orgA = fx.orgA.organizationId;
    const orgB = fx.orgB.organizationId;
    expect(await rebuildStyleNotesForOrg({ organizationId: orgA })).toEqual({ built: 1, cleared: 0 });

    const [note] = await listStyleNotes({ organizationId: orgA, sectionKinds: ["technical", "pricing", "not-a-kind"] });
    expect(note!.sectionKind).toBe("technical");
    expect(note!.body).toMatchObject({ sampleSize: 6, reviewerDecisions: 3, aiDraftSections: 1, aiDraftKeptShare: 0 });
    expect(note!.body.preferredWording).toContain("single accountable");
    expect(note!.body.avoidedWording).toEqual(["world-class"]);
    expect(note!.body.droppedFromAiDrafts).toEqual(["We deliver best-in-class value to every stakeholder we serve."]);
    // Nothing of B's is in A's note.
    expect(JSON.stringify(note)).not.toMatch(/mission assurance|cutting-edge/);

    // B has not been rebuilt: it reads nothing, and certainly not A's note.
    expect(await listStyleNotes({ organizationId: orgB, sectionKinds: ["technical"] })).toEqual([]);
    expect(await getStyleNoteView({ organizationId: orgB, sectionKind: "technical" })).toBeNull();

    // B's own rebuild writes B's row and leaves A's untouched.
    await rebuildStyleNotesForOrg({ organizationId: orgB });
    const viewB = await getStyleNoteView({ organizationId: orgB, sectionKind: "technical" });
    expect(viewB!.avoidedWording).toEqual(["cutting-edge"]);
    expect(JSON.stringify(viewB)).not.toMatch(/accountable|world-class|best-in-class/);
    const [again] = await listStyleNotes({ organizationId: orgA, sectionKinds: ["technical"] });
    expect(again!.body).toEqual(note!.body);

    const audits = await db.select({ metadata: auditLogs.metadata }).from(auditLogs).where(and(eq(auditLogs.organizationId, orgA), eq(auditLogs.action, "style_note.rebuild")));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({ built: 1, cleared: 0 });
  });

  it("builds nothing below five decisions and removes a note whose decisions aged out", async () => {
    const orgA = fx.orgA.organizationId;
    await db.delete(sectionChangeDecisions).where(and(eq(sectionChangeDecisions.organizationId, orgA), eq(sectionChangeDecisions.changeType, "delete")));
    // Three decisions left.
    expect(await rebuildStyleNotesForOrg({ organizationId: orgA })).toEqual({ built: 0, cleared: 0 });
    expect(await listStyleNotes({ organizationId: orgA, sectionKinds: ["technical"] })).toEqual([]);

    await decide(fx.orgA, sectionA, [], A_CUT);
    expect((await rebuildStyleNotesForOrg({ organizationId: orgA })).built).toBe(1);
    // A year on, the window holds none of them: the note goes.
    const nextYear = new Date(Date.now() + 365 * 86_400_000);
    expect(await rebuildStyleNotesForOrg({ organizationId: orgA, now: nextYear })).toEqual({ built: 0, cleared: 1 });
    expect(await db.select({ k: sectionStyleNotes.sectionKind }).from(sectionStyleNotes).where(eq(sectionStyleNotes.organizationId, orgA))).toEqual([]);
  });

  it("rebuilds every tenant with decisions in the weekly run, each under its own id", async () => {
    const summary = await runStyleNoteCron({ maxOrgs: 10_000 });
    expect(summary.errors).toBe(0);
    expect(summary.organizations).toBeGreaterThanOrEqual(2);
    const viewA = await getStyleNoteView({ organizationId: fx.orgA.organizationId, sectionKind: "technical" });
    const viewB = await getStyleNoteView({ organizationId: fx.orgB.organizationId, sectionKind: "technical" });
    expect(viewA!.avoidedWording).toEqual(["world-class"]);
    expect(viewB!.avoidedWording).toEqual(["cutting-edge"]);
  });

  it("hands the drafter its own tenant's note, and none for a golden-eval case", async () => {
    const orgA = fx.orgA.organizationId;
    // Before the weekly run there is feedback but no note.
    expect((await gatherEditFeedbackForSection({ organizationId: orgA, sectionKind: "technical" }))!.styleNote).toBeUndefined();
    await rebuildStyleNotesForOrg({ organizationId: orgA });

    const feedback = await gatherEditFeedbackForSection({ organizationId: orgA, sectionKind: "technical" });
    expect(feedback!.styleNote).toMatchObject({ sectionKind: "technical", avoidedWording: ["world-class"] });
    // Another kind has no note of its own (the decisions fall back across kinds; the note does not).
    expect((await gatherEditFeedbackForSection({ organizationId: orgA, sectionKind: "pricing" }))!.styleNote).toBeUndefined();
    // B's drafter never sees A's note.
    expect((await gatherEditFeedbackForSection({ organizationId: fx.orgB.organizationId, sectionKind: "technical" }))!.styleNote).toBeUndefined();
    // A golden-eval case leaves its own proposal out; the stored note cannot, so it is withheld.
    await decide(fx.orgB, sectionB, B_KEPT, []);
    await rebuildStyleNotesForOrg({ organizationId: fx.orgB.organizationId });
    const golden = await gatherEditFeedbackForSection({ organizationId: orgA, sectionKind: "technical", excludeProposalId: "00000000-0000-0000-0000-000000000000" });
    expect(golden).not.toBeNull();
    expect(golden!.styleNote).toBeUndefined();
  });

  it("refuses the cron route without the secret", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    const denied = await styleNotesCron(new NextRequest("http://localhost/api/cron/style-notes"));
    expect(denied.status).toBe(401);
    const wrong = await styleNotesCron(new NextRequest("http://localhost/api/cron/style-notes", { headers: { authorization: "Bearer nope" } }));
    expect(wrong.status).toBe(401);
    delete process.env.CRON_SECRET;
    const unset = await styleNotesCron(new NextRequest("http://localhost/api/cron/style-notes"));
    expect(unset.status).toBe(500);
  });
});
