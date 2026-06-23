/**
 * BL-15 Phase B-3c — runtime tests for the isolation status check.
 *
 * The runner probes a security invariant: tenant data cannot leak
 * across organizations at the SQL layer. The probe shape is:
 *
 *   1. Pick another tenant as the phantom attacker
 *   2. Sample up to 10 row ids from each probe table belonging to the
 *      attacker
 *   3. SELECT those ids scoped to the target tenant — must return 0
 *
 * Because each row's `organization_id` is a single-FK column and `id`
 * is a unique PK, step 3 returns 0 in any healthy schema — the probe
 * fundamentally cannot produce a false alarm against well-formed data.
 * A non-zero return means real data corruption, which the harness
 * can't fabricate without violating PK uniqueness, so these tests
 * verify the PASS path + the operational shape (audit, list, limit,
 * single-tenant SKIP).
 *
 * Mocking surface:
 *   - `requireSuperadmin` returns our test super-admin.
 *   - DB, `recordAudit`, and the probe queries themselves are
 *     UN-mocked so the assertions cover real SQL behaviour.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  isolationCheckResults,
  users,
} from "@/db/schema";
import {
  createTwoTenants,
  type TwoTenantFixture,
} from "../helpers/fixtures";

const sessionUserStub = {
  id: "PLACEHOLDER",
  email: "super@bl15.example",
  name: "Super",
  image: null as null,
  isSuperadmin: true as const,
  organizationId: null as null,
  role: null as null,
};

vi.mock("@/lib/auth-helpers", () => ({
  requireAuth: async () => sessionUserStub,
  requireSuperadmin: async () => sessionUserStub,
  requireCurrentOrg: async () => ({
    user: sessionUserStub,
    organizationId: "n/a",
    isImpersonating: false,
  }),
  getSessionUser: async () => sessionUserStub,
}));

import {
  listIsolationCheckResultsAction,
  runIsolationCheckAction,
} from "@/app/(app)/admin/orgs/[id]/isolation-check-actions";

describe("BL-15 Phase B-3c — isolation status check (runtime)", () => {
  let fx: TwoTenantFixture;
  let superadminUserId: string;

  beforeEach(async () => {
    fx = await createTwoTenants("iso-check");
    superadminUserId = `iso-super-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    await db.insert(users).values({
      id: superadminUserId,
      name: "Super",
      email: `${superadminUserId}@bl15.example`,
      emailVerified: new Date(),
      isSuperadmin: true,
    });
    sessionUserStub.id = superadminUserId;
  });

  afterEach(async () => {
    await db.delete(users).where(eq(users.id, superadminUserId));
    await fx.cleanup();
  });

  // ── happy path ─────────────────────────────────────────────────────

  it("PASSes on a properly isolated tenant + writes one result row", async () => {
    const res = await runIsolationCheckAction({
      organizationId: fx.orgA.organizationId,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error();
    expect(res.result.failedChecks).toBe(0);
    // The fixture seeds opportunity + proposal + knowledge_artifact
    // in each tenant, so the attacker (orgB) has rows for every
    // probe table and none get skipped.
    expect(res.result.totalChecks).toBe(3);
    expect(res.result.passedChecks).toBe(3);
    expect(res.result.skippedChecks).toBe(0);

    const [row] = await db
      .select()
      .from(isolationCheckResults)
      .where(eq(isolationCheckResults.id, res.result.id))
      .limit(1);
    expect(row).toBeTruthy();
    expect(row!.organizationId).toBe(fx.orgA.organizationId);
    expect(row!.triggeredByUserId).toBe(superadminUserId);
    expect(row!.failedChecks).toBe(0);
  });

  it("never produces a FAIL on a sane schema (no fabricable leaks)", async () => {
    // The probe's leak shape is "an id present in BOTH the attacker
    // tenant and the target tenant". The schema's PK uniqueness on
    // `id` plus the single-FK `organization_id` column makes that
    // structurally impossible. Run the probe many times; every
    // PASS is itself an assertion that the invariant holds.
    for (let i = 0; i < 3; i += 1) {
      const res = await runIsolationCheckAction({
        organizationId: fx.orgA.organizationId,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error();
      expect(res.result.failedChecks).toBe(0);
    }
  });

  // ── target not found ───────────────────────────────────────────────

  it("returns an error for an unknown target organization", async () => {
    const res = await runIsolationCheckAction({
      organizationId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.ok).toBe(false);
  });

  // ── audit row lands ────────────────────────────────────────────────

  it("audits the run to the TARGET tenant's log with passed_checks / failed_checks", async () => {
    const res = await runIsolationCheckAction({
      organizationId: fx.orgA.organizationId,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error();

    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, fx.orgA.organizationId),
          inArray(auditLogs.action, [
            "superadmin.isolation_check_passed",
            "superadmin.isolation_check_failed",
          ]),
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);
    expect(audit).toBeTruthy();
    // Healthy fixture → expect the PASSED action.
    expect(audit!.action).toBe("superadmin.isolation_check_passed");
    expect(audit!.actorUserId).toBe(superadminUserId);
    expect(audit!.metadata).toMatchObject({
      viaSuperadmin: true,
      resultId: res.result.id,
      failedChecks: 0,
    });
  });

  // ── details array shape ────────────────────────────────────────────

  it("details array carries one entry per probe table with status + counts", async () => {
    const res = await runIsolationCheckAction({
      organizationId: fx.orgA.organizationId,
    });
    if (!res.ok) throw new Error();
    expect(res.result.details).toHaveLength(3);
    const tableNames = res.result.details.map((d) => d.table);
    expect(tableNames).toEqual(
      expect.arrayContaining([
        "opportunities",
        "proposals",
        "knowledge_artifacts",
      ]),
    );
    for (const detail of res.result.details) {
      expect(["pass", "fail", "skipped"]).toContain(detail.status);
      if (detail.status === "pass") {
        expect(detail.rowsLeaked).toBe(0);
        expect(detail.attackerRowIdsSampled).toBeGreaterThan(0);
        expect(detail.attackerOrganizationId).toBeTruthy();
      }
    }
  });

  // ── listIsolationCheckResultsAction ────────────────────────────────

  describe("listIsolationCheckResultsAction", () => {
    it("returns results newest-first scoped to the target tenant", async () => {
      const a = await runIsolationCheckAction({
        organizationId: fx.orgA.organizationId,
      });
      if (!a.ok) throw new Error();
      await new Promise((r) => setTimeout(r, 5));
      const b = await runIsolationCheckAction({
        organizationId: fx.orgA.organizationId,
      });
      if (!b.ok) throw new Error();

      const res = await listIsolationCheckResultsAction({
        organizationId: fx.orgA.organizationId,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error();
      expect(res.results.length).toBeGreaterThanOrEqual(2);
      expect(res.results[0]!.id).toBe(b.result.id);
      expect(res.results[1]!.id).toBe(a.result.id);
    });

    it("does NOT return rows from other tenants", async () => {
      await runIsolationCheckAction({ organizationId: fx.orgA.organizationId });
      await runIsolationCheckAction({ organizationId: fx.orgB.organizationId });

      const res = await listIsolationCheckResultsAction({
        organizationId: fx.orgA.organizationId,
      });
      if (!res.ok) throw new Error();
      // Verify against DB that every returned id belongs to orgA.
      for (const summary of res.results) {
        const [row] = await db
          .select({ organizationId: isolationCheckResults.organizationId })
          .from(isolationCheckResults)
          .where(eq(isolationCheckResults.id, summary.id))
          .limit(1);
        expect(row!.organizationId).toBe(fx.orgA.organizationId);
      }
    });

    it("respects the limit param", async () => {
      for (let i = 0; i < 3; i += 1) {
        await runIsolationCheckAction({
          organizationId: fx.orgA.organizationId,
        });
      }
      const res = await listIsolationCheckResultsAction({
        organizationId: fx.orgA.organizationId,
        limit: 2,
      });
      if (!res.ok) throw new Error();
      expect(res.results.length).toBe(2);
    });
  });
});
