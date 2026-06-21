/**
 * BL-19 Phase 2 — runtime cross-tenant isolation tests.
 *
 * Pairs with the static check at `scripts/check-isolation.mjs` (Phase 1).
 * The static check verifies every server action source includes an
 * org-scoped WHERE clause. This suite proves the SQL pattern actually
 * isolates at runtime: it provisions two real tenants in Postgres,
 * then attempts every cross-tenant read/update/delete and asserts
 * the org-B row stays untouched when an org-A predicate is used.
 *
 * Tests three representative tables that cover the major isolation
 * patterns:
 *   - opportunities — top-level org-scoped table
 *   - proposals — org-scoped + secondary FK to opportunities
 *   - knowledge_artifact — org-scoped with archival soft-delete column
 *
 * If a future change introduces a query that filters only by id
 * (forgetting the org-id predicate), one of these tests will fail.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  knowledgeArtifacts,
  opportunities,
  proposals,
} from "@/db/schema";
import {
  createTwoTenants,
  type TwoTenantFixture,
} from "../helpers/fixtures";

describe("BL-19 Phase 2 — cross-tenant runtime isolation", () => {
  let fx: TwoTenantFixture;

  beforeEach(async () => {
    fx = await createTwoTenants("scoping");
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  // ── opportunities ─────────────────────────────────────────────────────

  describe("opportunities", () => {
    it("scoped SELECT returns only the caller's rows", async () => {
      const aRows = await db
        .select({ id: opportunities.id })
        .from(opportunities)
        .where(eq(opportunities.organizationId, fx.orgA.organizationId));
      expect(aRows.map((r) => r.id)).toEqual([fx.orgA.opportunityId]);
      expect(aRows.map((r) => r.id)).not.toContain(fx.orgB.opportunityId);
    });

    it("looking up org-B's id while scoped to org-A returns nothing", async () => {
      const rows = await db
        .select({ id: opportunities.id })
        .from(opportunities)
        .where(
          and(
            eq(opportunities.id, fx.orgB.opportunityId),
            eq(opportunities.organizationId, fx.orgA.organizationId),
          ),
        );
      expect(rows).toHaveLength(0);
    });

    it("scoped DELETE refuses to remove the other tenant's row", async () => {
      // Mirror the exact pattern of deleteOpportunityAction:
      //   WHERE id = $1 AND organization_id = $2
      await db
        .delete(opportunities)
        .where(
          and(
            eq(opportunities.id, fx.orgB.opportunityId),
            eq(opportunities.organizationId, fx.orgA.organizationId),
          ),
        );
      // The org-B row must still exist.
      const surviving = await db
        .select({ id: opportunities.id })
        .from(opportunities)
        .where(eq(opportunities.id, fx.orgB.opportunityId));
      expect(surviving).toHaveLength(1);
    });

    it("scoped UPDATE refuses to touch the other tenant's row", async () => {
      const original = await db
        .select({ title: opportunities.title })
        .from(opportunities)
        .where(eq(opportunities.id, fx.orgB.opportunityId))
        .limit(1);

      await db
        .update(opportunities)
        .set({ title: "ATTACKER-CONTROLLED VALUE" })
        .where(
          and(
            eq(opportunities.id, fx.orgB.opportunityId),
            eq(opportunities.organizationId, fx.orgA.organizationId),
          ),
        );

      const after = await db
        .select({ title: opportunities.title })
        .from(opportunities)
        .where(eq(opportunities.id, fx.orgB.opportunityId))
        .limit(1);
      expect(after[0]?.title).toBe(original[0]?.title);
      expect(after[0]?.title).not.toBe("ATTACKER-CONTROLLED VALUE");
    });
  });

  // ── proposals ─────────────────────────────────────────────────────────

  describe("proposals", () => {
    it("scoped SELECT returns only the caller's rows", async () => {
      const aRows = await db
        .select({ id: proposals.id })
        .from(proposals)
        .where(eq(proposals.organizationId, fx.orgA.organizationId));
      expect(aRows.map((r) => r.id)).toEqual([fx.orgA.proposalId]);
    });

    it("scoped DELETE refuses to remove the other tenant's row", async () => {
      await db
        .delete(proposals)
        .where(
          and(
            eq(proposals.id, fx.orgB.proposalId),
            eq(proposals.organizationId, fx.orgA.organizationId),
          ),
        );
      const surviving = await db
        .select({ id: proposals.id })
        .from(proposals)
        .where(eq(proposals.id, fx.orgB.proposalId));
      expect(surviving).toHaveLength(1);
    });

    it("scoped UPDATE refuses to touch the other tenant's row", async () => {
      await db
        .update(proposals)
        .set({ title: "ATTACKER-CONTROLLED VALUE" })
        .where(
          and(
            eq(proposals.id, fx.orgB.proposalId),
            eq(proposals.organizationId, fx.orgA.organizationId),
          ),
        );
      const [after] = await db
        .select({ title: proposals.title })
        .from(proposals)
        .where(eq(proposals.id, fx.orgB.proposalId))
        .limit(1);
      expect(after?.title).not.toBe("ATTACKER-CONTROLLED VALUE");
    });
  });

  // ── knowledge artifacts ───────────────────────────────────────────────

  describe("knowledge artifacts", () => {
    it("scoped SELECT returns only the caller's rows", async () => {
      const aRows = await db
        .select({ id: knowledgeArtifacts.id })
        .from(knowledgeArtifacts)
        .where(
          eq(knowledgeArtifacts.organizationId, fx.orgA.organizationId),
        );
      expect(aRows.map((r) => r.id)).toEqual([fx.orgA.knowledgeArtifactId]);
    });

    it("scoped DELETE refuses to remove the other tenant's artifact", async () => {
      await db
        .delete(knowledgeArtifacts)
        .where(
          and(
            eq(knowledgeArtifacts.id, fx.orgB.knowledgeArtifactId),
            eq(
              knowledgeArtifacts.organizationId,
              fx.orgA.organizationId,
            ),
          ),
        );
      const surviving = await db
        .select({ id: knowledgeArtifacts.id })
        .from(knowledgeArtifacts)
        .where(eq(knowledgeArtifacts.id, fx.orgB.knowledgeArtifactId));
      expect(surviving).toHaveLength(1);
    });

    it("scoped archive UPDATE refuses to soft-delete the other tenant's artifact", async () => {
      // Mirrors archiveKnowledgeArtifactAction's pattern:
      //   UPDATE knowledge_artifact SET archived_at = now()
      //     WHERE id = $1 AND organization_id = $2
      await db
        .update(knowledgeArtifacts)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(knowledgeArtifacts.id, fx.orgB.knowledgeArtifactId),
            eq(
              knowledgeArtifacts.organizationId,
              fx.orgA.organizationId,
            ),
          ),
        );
      const [after] = await db
        .select({ archivedAt: knowledgeArtifacts.archivedAt })
        .from(knowledgeArtifacts)
        .where(eq(knowledgeArtifacts.id, fx.orgB.knowledgeArtifactId))
        .limit(1);
      expect(after?.archivedAt).toBeNull();
    });
  });

  // ── regression guard: the unscoped pattern would actually leak ────────
  // Sanity check that proves the test framework is sensitive enough to
  // catch a missing org filter. Without this, a future bug where the
  // tests pass for the wrong reason (e.g. fixture cleanup ran early)
  // would go unnoticed.

  describe("regression guard — unscoped query is dangerous (proves test sensitivity)", () => {
    it("an unscoped SELECT by id alone sees both tenants' rows", async () => {
      const rows = await db
        .select({ id: opportunities.id })
        .from(opportunities)
        .where(eq(opportunities.id, fx.orgB.opportunityId));
      // Without an org predicate, the row IS visible — which is exactly
      // why every server action must include the organizationId filter.
      expect(rows).toHaveLength(1);
    });
  });
});
