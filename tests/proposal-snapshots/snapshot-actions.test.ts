/**
 * BL-9 Slice 5b + 5c — runtime tests for proposal-section version snapshots.
 *
 * Covers the four snapshot server actions:
 *   - createSectionSnapshotAction  (manual + auto kinds)
 *   - listSectionSnapshotsAction
 *   - restoreSectionSnapshotAction (incl. the "before restore" auto-snapshot)
 *   - deleteSectionSnapshotAction
 *   - getSectionSnapshotBodyAction (5c)
 *
 * Plus integration coverage of the auto-snapshot-on-status-transition
 * path that `saveSectionAction` hooks into.
 *
 * Approach:
 *   - Stub `requireAuth` / `requireCurrentOrg` so the snapshot actions
 *     run as our test user against the test tenant.
 *   - Leave the DB, `recordAudit`, and the projection helper UN-mocked
 *     so the assertions cover real row shapes + audit rows.
 *
 * Local section + sample-body helpers are inlined here (rather than
 * added to `tests/helpers/fixtures.ts`) so this PR has no merge-time
 * coupling with sibling test PRs. Once both ship the helpers can be
 * promoted into a shared fixture in a tidy-up PR.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  proposalSectionSnapshots,
  proposalSections,
  type TipTapDoc,
} from "@/db/schema";
import {
  createTwoTenants,
  type TwoTenantFixture,
} from "../helpers/fixtures";

// ── Stub auth-helpers so the actions resolve identity to our user ────────
//
// sessionUserStub is mutated in beforeEach to point at the freshly
// provisioned test user. `requireCurrentOrg` returns the same tenant's
// organizationId. Snapshot actions don't depend on the superadmin flag,
// so the default is `false`.

const sessionUserStub = {
  id: "PLACEHOLDER",
  email: "test@bl9.example",
  name: "Test User",
  image: null as null,
  isSuperadmin: false as const,
  organizationId: "PLACEHOLDER",
  role: "admin" as const,
};

vi.mock("@/lib/auth-helpers", () => ({
  requireAuth: async () => sessionUserStub,
  requireCurrentOrg: async () => ({
    user: sessionUserStub,
    organizationId: sessionUserStub.organizationId,
    isImpersonating: false,
  }),
  requireSuperadmin: async () => sessionUserStub,
  getSessionUser: async () => sessionUserStub,
}));

// Imports under test — happen AFTER the mock declaration.
import {
  createSectionSnapshotAction,
  deleteSectionSnapshotAction,
  getSectionSnapshotBodyAction,
  listSectionSnapshotsAction,
  restoreSectionSnapshotAction,
} from "@/app/(app)/proposals/[id]/sections/snapshot-actions";
import { saveSectionAction } from "@/app/(app)/proposals/actions";

// ── Section seeder ──────────────────────────────────────────────────────

async function seedSection(opts: {
  proposalId: string;
  bodyDoc?: TipTapDoc;
  status?: "not_started" | "in_progress" | "draft_complete";
}): Promise<string> {
  const body: TipTapDoc = opts.bodyDoc ?? {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "seed body" }],
      },
    ],
  };
  const [row] = await db
    .insert(proposalSections)
    .values({
      proposalId: opts.proposalId,
      kind: "technical",
      title: `Section ${Math.random().toString(36).slice(2, 8)}`,
      ordering: 0,
      content: "seed body",
      bodyDoc: body,
      status: opts.status ?? "not_started",
      wordCount: 2,
    })
    .returning({ id: proposalSections.id });
  if (!row) throw new Error("seedSection: insert returned no row");
  return row.id;
}

function makeBody(text: string): TipTapDoc {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}

describe("BL-9 Slice 5b/5c — proposal section snapshots (runtime)", () => {
  let fx: TwoTenantFixture;
  let sectionA: string;
  let sectionB: string;

  beforeEach(async () => {
    fx = await createTwoTenants("snapshots");
    sectionA = await seedSection({
      proposalId: fx.orgA.proposalId,
      bodyDoc: makeBody("orgA section seed text"),
    });
    sectionB = await seedSection({
      proposalId: fx.orgB.proposalId,
      bodyDoc: makeBody("orgB section seed text"),
    });
    sessionUserStub.id = fx.orgA.userId;
    sessionUserStub.organizationId = fx.orgA.organizationId;
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  // ── createSectionSnapshotAction ───────────────────────────────────

  describe("createSectionSnapshotAction", () => {
    it("writes a row with every field populated", async () => {
      const res = await createSectionSnapshotAction({
        proposalId: fx.orgA.proposalId,
        sectionId: sectionA,
        label: "before rewrite",
      });
      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error();

      const [row] = await db
        .select()
        .from(proposalSectionSnapshots)
        .where(eq(proposalSectionSnapshots.id, res.snapshotId))
        .limit(1);
      expect(row).toBeTruthy();
      expect(row!.organizationId).toBe(fx.orgA.organizationId);
      expect(row!.proposalSectionId).toBe(sectionA);
      expect(row!.proposalId).toBe(fx.orgA.proposalId);
      expect(row!.kind).toBe("manual");
      expect(row!.label).toBe("before rewrite");
      expect(row!.createdByUserId).toBe(fx.orgA.userId);
      expect(row!.bodyDoc).toEqual(makeBody("orgA section seed text"));
    });

    it("defaults kind to 'manual' and label to ''", async () => {
      const res = await createSectionSnapshotAction({
        proposalId: fx.orgA.proposalId,
        sectionId: sectionA,
      });
      if (!res.ok) throw new Error();
      const [row] = await db
        .select()
        .from(proposalSectionSnapshots)
        .where(eq(proposalSectionSnapshots.id, res.snapshotId))
        .limit(1);
      expect(row!.kind).toBe("manual");
      expect(row!.label).toBe("");
    });

    it("respects an explicit kind: 'auto'", async () => {
      const res = await createSectionSnapshotAction({
        proposalId: fx.orgA.proposalId,
        sectionId: sectionA,
        kind: "auto",
        label: "checkpoint",
      });
      if (!res.ok) throw new Error();
      const [row] = await db
        .select({ kind: proposalSectionSnapshots.kind })
        .from(proposalSectionSnapshots)
        .where(eq(proposalSectionSnapshots.id, res.snapshotId))
        .limit(1);
      expect(row!.kind).toBe("auto");
    });

    it("trims + truncates labels to 120 chars", async () => {
      const longLabel = "x".repeat(200);
      const res = await createSectionSnapshotAction({
        proposalId: fx.orgA.proposalId,
        sectionId: sectionA,
        label: `   ${longLabel}   `,
      });
      if (!res.ok) throw new Error();
      const [row] = await db
        .select({ label: proposalSectionSnapshots.label })
        .from(proposalSectionSnapshots)
        .where(eq(proposalSectionSnapshots.id, res.snapshotId))
        .limit(1);
      expect(row!.label.length).toBe(120);
      expect(row!.label.startsWith("x")).toBe(true);
    });

    it("refuses to snapshot a section in another tenant", async () => {
      // orgA's user attempts to snapshot orgB's section.
      const res = await createSectionSnapshotAction({
        proposalId: fx.orgB.proposalId,
        sectionId: sectionB,
      });
      expect(res.ok).toBe(false);
      // And the DB has no orgA-scoped row pointing at orgB's section.
      const rows = await db
        .select({ id: proposalSectionSnapshots.id })
        .from(proposalSectionSnapshots)
        .where(eq(proposalSectionSnapshots.proposalSectionId, sectionB));
      expect(rows).toHaveLength(0);
    });

    it("audits the create with the snapshot id + kind + word count", async () => {
      const res = await createSectionSnapshotAction({
        proposalId: fx.orgA.proposalId,
        sectionId: sectionA,
        label: "audit-check",
      });
      if (!res.ok) throw new Error();
      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, fx.orgA.organizationId),
            eq(auditLogs.action, "proposal_section.snapshot_create"),
          ),
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);
      expect(audit).toBeTruthy();
      expect(audit!.resourceId).toBe(sectionA);
      expect(audit!.metadata).toMatchObject({
        snapshotId: res.snapshotId,
        kind: "manual",
        label: "audit-check",
      });
    });
  });

  // ── listSectionSnapshotsAction ────────────────────────────────────

  describe("listSectionSnapshotsAction", () => {
    it("returns snapshots newest-first and drops bodyDoc from the payload", async () => {
      const first = await createSectionSnapshotAction({
        proposalId: fx.orgA.proposalId,
        sectionId: sectionA,
        label: "first",
      });
      if (!first.ok) throw new Error();
      // Small gap so timestamps differ.
      await new Promise((r) => setTimeout(r, 5));
      const second = await createSectionSnapshotAction({
        proposalId: fx.orgA.proposalId,
        sectionId: sectionA,
        label: "second",
      });
      if (!second.ok) throw new Error();

      const res = await listSectionSnapshotsAction({
        proposalId: fx.orgA.proposalId,
        sectionId: sectionA,
      });
      if (!res.ok) throw new Error();
      expect(res.snapshots.length).toBe(2);
      expect(res.snapshots[0]!.label).toBe("second");
      expect(res.snapshots[1]!.label).toBe("first");
      // Summary type should never carry bodyDoc.
      expect("bodyDoc" in (res.snapshots[0] as object)).toBe(false);
    });

    it("refuses to list snapshots in another tenant", async () => {
      // Seed a snapshot in orgB by running as orgB temporarily.
      sessionUserStub.id = fx.orgB.userId;
      sessionUserStub.organizationId = fx.orgB.organizationId;
      const seed = await createSectionSnapshotAction({
        proposalId: fx.orgB.proposalId,
        sectionId: sectionB,
        label: "orgB only",
      });
      if (!seed.ok) throw new Error();
      // Switch back to orgA and try to list orgB's section.
      sessionUserStub.id = fx.orgA.userId;
      sessionUserStub.organizationId = fx.orgA.organizationId;
      const res = await listSectionSnapshotsAction({
        proposalId: fx.orgB.proposalId,
        sectionId: sectionB,
      });
      expect(res.ok).toBe(false);
    });
  });

  // ── restoreSectionSnapshotAction ──────────────────────────────────

  describe("restoreSectionSnapshotAction", () => {
    it("overwrites the section's body_doc + writes a 'before restore' auto-snapshot", async () => {
      // Capture the seed text as the snapshot to restore to.
      const snap = await createSectionSnapshotAction({
        proposalId: fx.orgA.proposalId,
        sectionId: sectionA,
        label: "snap-of-seed",
      });
      if (!snap.ok) throw new Error();

      // Mutate the section so the restore has something to roll back.
      await db
        .update(proposalSections)
        .set({ bodyDoc: makeBody("LIVE EDIT"), content: "LIVE EDIT" })
        .where(eq(proposalSections.id, sectionA));

      const res = await restoreSectionSnapshotAction({
        proposalId: fx.orgA.proposalId,
        sectionId: sectionA,
        snapshotId: snap.snapshotId,
      });
      expect(res.ok).toBe(true);

      // Section body matches the snapshot's body again.
      const [section] = await db
        .select({ bodyDoc: proposalSections.bodyDoc })
        .from(proposalSections)
        .where(eq(proposalSections.id, sectionA))
        .limit(1);
      expect(section!.bodyDoc).toEqual(makeBody("orgA section seed text"));

      // A new "before restore" auto-snapshot captures the LIVE EDIT.
      const all = await db
        .select()
        .from(proposalSectionSnapshots)
        .where(eq(proposalSectionSnapshots.proposalSectionId, sectionA))
        .orderBy(desc(proposalSectionSnapshots.createdAt));
      expect(all.length).toBeGreaterThanOrEqual(2);
      const beforeRestore = all.find(
        (s) => s.label === "before restore" && s.kind === "auto",
      );
      expect(beforeRestore).toBeTruthy();
      expect(beforeRestore!.bodyDoc).toEqual(makeBody("LIVE EDIT"));
    });

    it("audits both the snapshot id + the pre-restore snapshot id", async () => {
      const snap = await createSectionSnapshotAction({
        proposalId: fx.orgA.proposalId,
        sectionId: sectionA,
      });
      if (!snap.ok) throw new Error();
      await restoreSectionSnapshotAction({
        proposalId: fx.orgA.proposalId,
        sectionId: sectionA,
        snapshotId: snap.snapshotId,
      });
      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, fx.orgA.organizationId),
            eq(auditLogs.action, "proposal_section.snapshot_restore"),
          ),
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);
      expect(audit).toBeTruthy();
      const meta = audit!.metadata as {
        snapshotId: string;
        preRestoreSnapshotId: string | null;
      };
      expect(meta.snapshotId).toBe(snap.snapshotId);
      expect(meta.preRestoreSnapshotId).toBeTruthy();
    });

    it("refuses cross-tenant restore", async () => {
      // Seed a snapshot in orgB.
      sessionUserStub.id = fx.orgB.userId;
      sessionUserStub.organizationId = fx.orgB.organizationId;
      const snap = await createSectionSnapshotAction({
        proposalId: fx.orgB.proposalId,
        sectionId: sectionB,
      });
      if (!snap.ok) throw new Error();
      // Switch to orgA, try to restore orgB's snapshot onto orgB's section.
      sessionUserStub.id = fx.orgA.userId;
      sessionUserStub.organizationId = fx.orgA.organizationId;
      const res = await restoreSectionSnapshotAction({
        proposalId: fx.orgB.proposalId,
        sectionId: sectionB,
        snapshotId: snap.snapshotId,
      });
      expect(res.ok).toBe(false);
    });

    it("returns a not-found error for an unknown snapshot id", async () => {
      const res = await restoreSectionSnapshotAction({
        proposalId: fx.orgA.proposalId,
        sectionId: sectionA,
        snapshotId: "00000000-0000-0000-0000-000000000000",
      });
      expect(res.ok).toBe(false);
    });
  });

  // ── deleteSectionSnapshotAction ───────────────────────────────────

  describe("deleteSectionSnapshotAction", () => {
    it("removes the row", async () => {
      const snap = await createSectionSnapshotAction({
        proposalId: fx.orgA.proposalId,
        sectionId: sectionA,
      });
      if (!snap.ok) throw new Error();
      const res = await deleteSectionSnapshotAction({
        proposalId: fx.orgA.proposalId,
        sectionId: sectionA,
        snapshotId: snap.snapshotId,
      });
      expect(res.ok).toBe(true);
      const surviving = await db
        .select({ id: proposalSectionSnapshots.id })
        .from(proposalSectionSnapshots)
        .where(eq(proposalSectionSnapshots.id, snap.snapshotId));
      expect(surviving).toHaveLength(0);
    });

    it("refuses cross-tenant delete", async () => {
      sessionUserStub.id = fx.orgB.userId;
      sessionUserStub.organizationId = fx.orgB.organizationId;
      const snap = await createSectionSnapshotAction({
        proposalId: fx.orgB.proposalId,
        sectionId: sectionB,
      });
      if (!snap.ok) throw new Error();
      sessionUserStub.id = fx.orgA.userId;
      sessionUserStub.organizationId = fx.orgA.organizationId;
      const res = await deleteSectionSnapshotAction({
        proposalId: fx.orgB.proposalId,
        sectionId: sectionB,
        snapshotId: snap.snapshotId,
      });
      expect(res.ok).toBe(false);
      // orgB's snapshot still exists.
      const surviving = await db
        .select({ id: proposalSectionSnapshots.id })
        .from(proposalSectionSnapshots)
        .where(eq(proposalSectionSnapshots.id, snap.snapshotId));
      expect(surviving).toHaveLength(1);
    });
  });

  // ── getSectionSnapshotBodyAction (5c) ─────────────────────────────

  describe("getSectionSnapshotBodyAction", () => {
    it("returns full body + meta for an owned snapshot", async () => {
      const snap = await createSectionSnapshotAction({
        proposalId: fx.orgA.proposalId,
        sectionId: sectionA,
        label: "diff-target",
      });
      if (!snap.ok) throw new Error();
      const res = await getSectionSnapshotBodyAction({
        proposalId: fx.orgA.proposalId,
        sectionId: sectionA,
        snapshotId: snap.snapshotId,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error();
      expect(res.bodyDoc).toEqual(makeBody("orgA section seed text"));
      expect(res.meta.label).toBe("diff-target");
    });

    it("refuses cross-tenant body fetch", async () => {
      sessionUserStub.id = fx.orgB.userId;
      sessionUserStub.organizationId = fx.orgB.organizationId;
      const snap = await createSectionSnapshotAction({
        proposalId: fx.orgB.proposalId,
        sectionId: sectionB,
      });
      if (!snap.ok) throw new Error();
      sessionUserStub.id = fx.orgA.userId;
      sessionUserStub.organizationId = fx.orgA.organizationId;
      const res = await getSectionSnapshotBodyAction({
        proposalId: fx.orgB.proposalId,
        sectionId: sectionB,
        snapshotId: snap.snapshotId,
      });
      expect(res.ok).toBe(false);
    });
  });

  // ── saveSectionAction — auto-snapshot on status transition ────────

  describe("saveSectionAction auto-snapshot on stage transition", () => {
    it("creates an 'auto' snapshot when status crosses a boundary", async () => {
      // Seed at "not_started", then transition to "in_progress".
      const res = await saveSectionAction({
        proposalId: fx.orgA.proposalId,
        sectionId: sectionA,
        status: "in_progress",
      });
      expect(res.ok).toBe(true);

      const snaps = await db
        .select()
        .from(proposalSectionSnapshots)
        .where(eq(proposalSectionSnapshots.proposalSectionId, sectionA))
        .orderBy(desc(proposalSectionSnapshots.createdAt));
      expect(snaps.length).toBe(1);
      expect(snaps[0]!.kind).toBe("auto");
      expect(snaps[0]!.label).toContain("not_started");
      expect(snaps[0]!.label).toContain("in_progress");
      // The snapshot captures the PRIOR body (before the save), not the new one.
      expect(snaps[0]!.bodyDoc).toEqual(makeBody("orgA section seed text"));
    });

    it("does NOT snapshot when status is unchanged", async () => {
      // Title-only update — same status — no snapshot should fire.
      const res = await saveSectionAction({
        proposalId: fx.orgA.proposalId,
        sectionId: sectionA,
        title: "fresh title",
      });
      expect(res.ok).toBe(true);
      const snaps = await db
        .select({ id: proposalSectionSnapshots.id })
        .from(proposalSectionSnapshots)
        .where(eq(proposalSectionSnapshots.proposalSectionId, sectionA));
      expect(snaps.length).toBe(0);
    });
  });
});
