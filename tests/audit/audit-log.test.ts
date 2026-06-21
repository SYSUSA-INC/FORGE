/**
 * BL-12 / BL-20 — runtime tests for the audit log helpers.
 *
 * Every mutating server action and every sensitive read in FORGE
 * funnels through `recordAudit` / `recordRead` / `recordAuthDenied`.
 * If these helpers silently drop rows (or worse, throw and crash the
 * action that called them), our forensic record is incomplete.
 *
 * Tests cover:
 *   - recordAudit: row shape, field caps, error-swallowing
 *   - recordRead: category="read" injection + preserves user metadata
 *   - recordAuthDenied: skips anonymous, writes auth_denied otherwise
 *   - pruneAuditLogsAcrossTenants: honors per-tenant retention window
 *
 * All assertions run against a real Postgres + two real tenants.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, organizations } from "@/db/schema";
import {
  pruneAuditLogsAcrossTenants,
  recordAudit,
  recordAuthDenied,
  recordRead,
} from "@/lib/audit-log";
import {
  createTwoTenants,
  type TwoTenantFixture,
} from "../helpers/fixtures";

describe("BL-12 — audit log helpers (runtime)", () => {
  let fx: TwoTenantFixture;

  beforeEach(async () => {
    fx = await createTwoTenants("audit");
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  // ── recordAudit ─────────────────────────────────────────────────────

  describe("recordAudit", () => {
    it("writes a row with every field populated", async () => {
      await recordAudit({
        organizationId: fx.orgA.organizationId,
        actor: { userId: fx.orgA.userId, email: "test@bl12.example" },
        action: "opportunity.create",
        resourceType: "opportunity",
        resourceId: fx.orgA.opportunityId,
        metadata: { title: "fixture-opportunity" },
      });
      const [row] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, fx.orgA.organizationId),
            eq(auditLogs.action, "opportunity.create"),
          ),
        )
        .limit(1);
      expect(row).toBeTruthy();
      expect(row!.actorUserId).toBe(fx.orgA.userId);
      expect(row!.actorEmailSnapshot).toBe("test@bl12.example");
      expect(row!.resourceType).toBe("opportunity");
      expect(row!.resourceId).toBe(fx.orgA.opportunityId);
      expect(row!.metadata).toEqual({ title: "fixture-opportunity" });
    });

    it("defaults optional fields to empty strings", async () => {
      await recordAudit({
        organizationId: fx.orgA.organizationId,
        actor: { userId: null },
        action: "system.heartbeat",
      });
      const [row] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, fx.orgA.organizationId),
            eq(auditLogs.action, "system.heartbeat"),
          ),
        )
        .limit(1);
      expect(row).toBeTruthy();
      expect(row!.actorUserId).toBeNull();
      expect(row!.actorEmailSnapshot).toBe("");
      expect(row!.resourceType).toBe("");
      expect(row!.resourceId).toBe("");
      expect(row!.metadata).toEqual({});
    });

    it("caps long values at the documented limits", async () => {
      // The helper slices: action @ 128, resourceType @ 64,
      // resourceId @ 128, email @ 256. We pass strings longer than
      // each and check the persisted row was trimmed.
      const longAction = "a".repeat(200);
      const longType = "b".repeat(100);
      const longId = "c".repeat(200);
      const longEmail = "d".repeat(300) + "@x.example";
      await recordAudit({
        organizationId: fx.orgA.organizationId,
        actor: { userId: fx.orgA.userId, email: longEmail },
        action: longAction,
        resourceType: longType,
        resourceId: longId,
      });
      const [row] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.organizationId, fx.orgA.organizationId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);
      expect(row!.action.length).toBe(128);
      expect(row!.resourceType.length).toBe(64);
      expect(row!.resourceId.length).toBe(128);
      expect(row!.actorEmailSnapshot.length).toBe(256);
    });

    it("does not throw when the underlying insert fails", async () => {
      // Bogus org id — FK constraint will reject the insert. The
      // helper must swallow the failure so the calling action's
      // user-visible work isn't blocked.
      const bogusOrgId = "00000000-0000-0000-0000-000000000000";
      await expect(
        recordAudit({
          organizationId: bogusOrgId,
          actor: { userId: fx.orgA.userId },
          action: "test.error_swallow",
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ── recordRead ──────────────────────────────────────────────────────

  describe("recordRead", () => {
    it("adds category='read' to metadata", async () => {
      await recordRead({
        organizationId: fx.orgA.organizationId,
        actor: { userId: fx.orgA.userId },
        action: "proposal.export",
        resourceType: "proposal",
        resourceId: fx.orgA.proposalId,
      });
      const [row] = await db
        .select({ metadata: auditLogs.metadata })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, fx.orgA.organizationId),
            eq(auditLogs.action, "proposal.export"),
          ),
        )
        .limit(1);
      expect(row!.metadata).toMatchObject({ category: "read" });
    });

    it("preserves user-supplied metadata while injecting category", async () => {
      await recordRead({
        organizationId: fx.orgA.organizationId,
        actor: { userId: fx.orgA.userId },
        action: "share_link.view",
        metadata: { token: "abc123", visitor: "anon" },
      });
      const [row] = await db
        .select({ metadata: auditLogs.metadata })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, fx.orgA.organizationId),
            eq(auditLogs.action, "share_link.view"),
          ),
        )
        .limit(1);
      expect(row!.metadata).toEqual({
        token: "abc123",
        visitor: "anon",
        category: "read",
      });
    });
  });

  // ── recordAuthDenied ────────────────────────────────────────────────

  describe("recordAuthDenied", () => {
    it("writes auth_denied with the reason in metadata + resourceId", async () => {
      await recordAuthDenied({
        user: { id: fx.orgA.userId, email: "u@bl20.example" },
        organizationId: fx.orgA.organizationId,
        reason: "not_org_admin",
        attemptedOrgId: fx.orgB.organizationId,
        metadata: { role: "editor" },
      });
      const [row] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, fx.orgA.organizationId),
            eq(auditLogs.action, "auth_denied"),
          ),
        )
        .limit(1);
      expect(row).toBeTruthy();
      expect(row!.resourceType).toBe("auth");
      expect(row!.resourceId).toBe("not_org_admin");
      expect(row!.metadata).toEqual({
        reason: "not_org_admin",
        attemptedOrgId: fx.orgB.organizationId,
        role: "editor",
      });
    });

    it("skips silently when organizationId is null (anonymous denial)", async () => {
      await recordAuthDenied({
        user: { id: fx.orgA.userId },
        organizationId: null,
        reason: "not_member",
      });
      // No row should be written anywhere referring to fx.orgA's user.
      const rows = await db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.actorUserId, fx.orgA.userId),
            eq(auditLogs.action, "auth_denied"),
          ),
        );
      expect(rows).toHaveLength(0);
    });
  });

  // ── tenant isolation of audit rows ──────────────────────────────────

  it("audit rows are scoped per organization — no cross-tenant bleed", async () => {
    await recordAudit({
      organizationId: fx.orgA.organizationId,
      actor: { userId: fx.orgA.userId },
      action: "test.iso.a",
    });
    await recordAudit({
      organizationId: fx.orgB.organizationId,
      actor: { userId: fx.orgB.userId },
      action: "test.iso.b",
    });

    const aRows = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    const bRows = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, fx.orgB.organizationId));

    expect(aRows.map((r) => r.action)).toContain("test.iso.a");
    expect(aRows.map((r) => r.action)).not.toContain("test.iso.b");
    expect(bRows.map((r) => r.action)).toContain("test.iso.b");
    expect(bRows.map((r) => r.action)).not.toContain("test.iso.a");
  });

  // ── pruneAuditLogsAcrossTenants ─────────────────────────────────────

  describe("pruneAuditLogsAcrossTenants", () => {
    it("deletes rows older than the per-tenant retention window", async () => {
      // Shrink orgA's retention to 7 days.
      await db
        .update(organizations)
        .set({ auditRetentionDays: 7 })
        .where(eq(organizations.id, fx.orgA.organizationId));

      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60_000);
      const yesterday = new Date(Date.now() - 24 * 60 * 60_000);

      // Insert two rows directly with explicit createdAt so we can
      // control what's "old" vs "fresh".
      await db.insert(auditLogs).values([
        {
          organizationId: fx.orgA.organizationId,
          actorUserId: fx.orgA.userId,
          action: "prune.old",
          createdAt: eightDaysAgo,
        },
        {
          organizationId: fx.orgA.organizationId,
          actorUserId: fx.orgA.userId,
          action: "prune.fresh",
          createdAt: yesterday,
        },
      ]);

      const result = await pruneAuditLogsAcrossTenants();
      // Sanity: at least the old row we inserted got pruned.
      expect(result.rowsDeleted).toBeGreaterThanOrEqual(1);

      // Old row gone, fresh row stays.
      const remaining = await db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.organizationId, fx.orgA.organizationId));
      const actions = remaining.map((r) => r.action);
      expect(actions).not.toContain("prune.old");
      expect(actions).toContain("prune.fresh");
    });

    it("respects per-tenant retention — orgB's longer window protects its old rows", async () => {
      // orgA: 7 days. orgB: 365 days (default-ish).
      await db
        .update(organizations)
        .set({ auditRetentionDays: 7 })
        .where(eq(organizations.id, fx.orgA.organizationId));
      await db
        .update(organizations)
        .set({ auditRetentionDays: 365 })
        .where(eq(organizations.id, fx.orgB.organizationId));

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000);

      await db.insert(auditLogs).values([
        {
          organizationId: fx.orgA.organizationId,
          actorUserId: fx.orgA.userId,
          action: "prune.a-old",
          createdAt: thirtyDaysAgo,
        },
        {
          organizationId: fx.orgB.organizationId,
          actorUserId: fx.orgB.userId,
          action: "prune.b-old",
          createdAt: thirtyDaysAgo,
        },
      ]);

      await pruneAuditLogsAcrossTenants();

      const aSurvived = await db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, fx.orgA.organizationId),
            eq(auditLogs.action, "prune.a-old"),
          ),
        );
      const bSurvived = await db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, fx.orgB.organizationId),
            eq(auditLogs.action, "prune.b-old"),
          ),
        );
      // orgA's old row got pruned (7-day window); orgB's stayed
      // (365-day window covers 30 days ago).
      expect(aSurvived).toHaveLength(0);
      expect(bSurvived).toHaveLength(1);
    });
  });
});
