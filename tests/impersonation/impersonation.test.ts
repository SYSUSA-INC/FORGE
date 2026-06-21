/**
 * BL-15 Phase B-3b — runtime tests for super-admin assume-identity.
 *
 * Security-critical surface — a regression here either lets a super-
 * admin take over a tenant without leaving an audit trail, or lets
 * a forged cookie bypass the user-id check. These tests prove the
 * documented contract end-to-end against a real Postgres.
 *
 * Mocking strategy:
 *   - `next/headers` cookies() is backed by an in-memory Map so
 *     setImpersonationCookie / clearImpersonationCookie behave
 *     transparently.
 *   - `next/cache` revalidatePath is a no-op (we test DB state, not
 *     Next's caching).
 *   - `requireSuperadmin` returns a controlled SessionUser pointing
 *     at the test super-admin's row.
 *   - `recordAudit` is left UN-mocked so we can assert audit rows
 *     land in the right tenant's log.
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
  superadminImpersonationSessions,
  users,
} from "@/db/schema";
import {
  createTwoTenants,
  type TwoTenantFixture,
} from "../helpers/fixtures";

// ── In-memory cookie jar that mimics next/headers cookies() ──────────────

class TestCookieJar {
  private store = new Map<string, string>();
  get(name: string) {
    const v = this.store.get(name);
    return v === undefined ? undefined : { name, value: v };
  }
  set(name: string, value: string) {
    this.store.set(name, value);
  }
  delete(name: string) {
    this.store.delete(name);
  }
  reset() {
    this.store.clear();
  }
}

const cookieJar = new TestCookieJar();

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string, _opts?: unknown) => {
      // Match the signature recorded by setImpersonationCookie:
      // `jar.set("...", "<id>", { maxAge: 0 })` clears via maxAge=0.
      const options = _opts as { maxAge?: number } | undefined;
      if (options?.maxAge === 0 || value === "") {
        cookieJar.delete(name);
      } else {
        cookieJar.set(name, value);
      }
    },
    delete: (name: string) => cookieJar.delete(name),
  }),
  headers: () => ({
    get: () => null,
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// requireSuperadmin returns this object; we mutate it per test.
const sessionUserStub: {
  id: string;
  email: string;
  name: string | null;
  image: null;
  isSuperadmin: true;
  organizationId: null;
  role: null;
} = {
  id: "PLACEHOLDER",
  email: "super@bl15.example",
  name: "Super",
  image: null,
  isSuperadmin: true,
  organizationId: null,
  role: null,
};

vi.mock("@/lib/auth-helpers", async () => {
  // Re-export real helpers but override require* with mocks. The
  // impersonation library imports getActiveImpersonationSession only,
  // so mocking the require* surface is enough for the start/end
  // server actions we exercise.
  return {
    requireAuth: async () => sessionUserStub,
    requireSuperadmin: async () => sessionUserStub,
    requireCurrentOrg: async () => ({
      user: sessionUserStub,
      organizationId: "n/a",
      isImpersonating: false,
    }),
    getSessionUser: async () => sessionUserStub,
  };
});

// Imports under test — happen AFTER the mocks above are declared.
import {
  getActiveImpersonationSession,
  IMPERSONATION_COOKIE_NAME,
  setImpersonationCookie,
  clearImpersonationCookie,
} from "@/lib/impersonation";
import {
  startImpersonationAction,
  endImpersonationAction,
} from "@/app/(app)/admin/orgs/[id]/impersonation-actions";

describe("BL-15 Phase B-3b — assume-identity (runtime)", () => {
  let fx: TwoTenantFixture;
  let superadminUserId: string;

  beforeEach(async () => {
    fx = await createTwoTenants("imp");
    // Provision a separate super-admin user (not a member of either
    // test tenant — mirrors production where super-admins typically
    // have no membership).
    superadminUserId = `imp-super-${Date.now().toString(36)}-${Math.random()
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
    cookieJar.reset();
  });

  afterEach(async () => {
    // Close any active sessions for this super-admin first (FK cascade
    // catches the rest, but explicit close keeps the audit clean).
    await db
      .delete(superadminImpersonationSessions)
      .where(
        eq(
          superadminImpersonationSessions.superadminUserId,
          superadminUserId,
        ),
      );
    await db.delete(users).where(eq(users.id, superadminUserId));
    await fx.cleanup();
    cookieJar.reset();
  });

  // ── start ──────────────────────────────────────────────────────────

  describe("startImpersonationAction", () => {
    it("creates a session row + sets the cookie + audits", async () => {
      const result = await startImpersonationAction({
        organizationId: fx.orgA.organizationId,
        reason: "SUP-1234 — investigating user report",
      });
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) throw new Error("expected ok");

      // DB row exists with correct shape.
      const [row] = await db
        .select()
        .from(superadminImpersonationSessions)
        .where(eq(superadminImpersonationSessions.id, result.sessionId))
        .limit(1);
      expect(row).toBeTruthy();
      expect(row!.superadminUserId).toBe(superadminUserId);
      expect(row!.targetOrganizationId).toBe(fx.orgA.organizationId);
      expect(row!.reason).toBe("SUP-1234 — investigating user report");
      expect(row!.endedAt).toBeNull();
      expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Cookie set.
      const cookie = cookieJar.get(IMPERSONATION_COOKIE_NAME);
      expect(cookie?.value).toBe(result.sessionId);

      // Audit row landed in the TARGET tenant's log, with viaSuperadmin true.
      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, fx.orgA.organizationId),
            eq(auditLogs.action, "superadmin.assume_start"),
          ),
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);
      expect(audit).toBeTruthy();
      expect(audit!.actorUserId).toBe(superadminUserId);
      expect(audit!.resourceId).toBe(result.sessionId);
      expect(audit!.metadata).toMatchObject({
        reason: "SUP-1234 — investigating user report",
        viaSuperadmin: true,
      });
    });

    it("rejects an empty / too-short reason (< 8 chars)", async () => {
      const r1 = await startImpersonationAction({
        organizationId: fx.orgA.organizationId,
        reason: "",
      });
      expect(r1.ok).toBe(false);
      const r2 = await startImpersonationAction({
        organizationId: fx.orgA.organizationId,
        reason: "too sht",
      });
      expect(r2.ok).toBe(false);
    });

    it("rejects starting a second session while one is active", async () => {
      const first = await startImpersonationAction({
        organizationId: fx.orgA.organizationId,
        reason: "SUP-1 first session",
      });
      expect(first.ok).toBe(true);
      const second = await startImpersonationAction({
        organizationId: fx.orgB.organizationId,
        reason: "SUP-2 second session — should be refused",
      });
      expect(second.ok).toBe(false);
      if (second.ok) throw new Error("expected refusal");
      expect(second.error).toMatch(/end your current/i);
    });

    it("rejects when the target organization does not exist", async () => {
      const r = await startImpersonationAction({
        organizationId: "00000000-0000-0000-0000-000000000000",
        reason: "SUP-99 — fake target",
      });
      expect(r.ok).toBe(false);
    });
  });

  // ── end ────────────────────────────────────────────────────────────

  describe("endImpersonationAction", () => {
    it("marks ended_at, clears the cookie, audits with durationMs", async () => {
      const start = await startImpersonationAction({
        organizationId: fx.orgA.organizationId,
        reason: "SUP-7 — opening then closing",
      });
      expect(start.ok).toBe(true);
      if (!start.ok) throw new Error();

      const end = await endImpersonationAction();
      expect(end).toEqual({ ok: true });

      const [row] = await db
        .select()
        .from(superadminImpersonationSessions)
        .where(eq(superadminImpersonationSessions.id, start.sessionId))
        .limit(1);
      expect(row!.endedAt).not.toBeNull();

      // Cookie cleared.
      expect(cookieJar.get(IMPERSONATION_COOKIE_NAME)).toBeUndefined();

      // Audit row landed.
      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, fx.orgA.organizationId),
            eq(auditLogs.action, "superadmin.assume_end"),
          ),
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);
      expect(audit).toBeTruthy();
      expect(audit!.metadata).toMatchObject({ viaSuperadmin: true });
      expect(
        (audit!.metadata as { durationMs: number }).durationMs,
      ).toBeGreaterThanOrEqual(0);
    });

    it("is idempotent — calling end with no active session still succeeds", async () => {
      const r = await endImpersonationAction();
      expect(r).toEqual({ ok: true });
    });
  });

  // ── getActiveImpersonationSession ──────────────────────────────────

  describe("getActiveImpersonationSession", () => {
    it("returns null when no cookie is set", async () => {
      const s = await getActiveImpersonationSession(superadminUserId);
      expect(s).toBeNull();
    });

    it("returns the active session when cookie + DB row match", async () => {
      const start = await startImpersonationAction({
        organizationId: fx.orgA.organizationId,
        reason: "SUP-11 — getActive happy path",
      });
      if (!start.ok) throw new Error();
      const s = await getActiveImpersonationSession(superadminUserId);
      expect(s).toBeTruthy();
      expect(s!.id).toBe(start.sessionId);
      expect(s!.targetOrganizationId).toBe(fx.orgA.organizationId);
    });

    it("returns null when cookie session belongs to a different user", async () => {
      // Provision a SECOND super-admin and start a session as them.
      const otherAdmin = `imp-other-${Date.now().toString(36)}`;
      await db.insert(users).values({
        id: otherAdmin,
        name: "Other Super",
        email: `${otherAdmin}@bl15.example`,
        emailVerified: new Date(),
        isSuperadmin: true,
      });
      try {
        // Manually insert a session row for the OTHER admin, then put
        // that session id in our cookie. Our caller's user id is
        // superadminUserId, so the lookup must reject as mismatched.
        const [row] = await db
          .insert(superadminImpersonationSessions)
          .values({
            superadminUserId: otherAdmin,
            targetOrganizationId: fx.orgA.organizationId,
            reason: "SUP-cross — should not be visible",
            expiresAt: new Date(Date.now() + 60 * 60_000),
          })
          .returning({ id: superadminImpersonationSessions.id });
        setImpersonationCookie(row!.id);

        const s = await getActiveImpersonationSession(superadminUserId);
        expect(s).toBeNull();
      } finally {
        await db
          .delete(superadminImpersonationSessions)
          .where(
            eq(superadminImpersonationSessions.superadminUserId, otherAdmin),
          );
        await db.delete(users).where(eq(users.id, otherAdmin));
      }
    });

    it("returns null when the session has been ended", async () => {
      const start = await startImpersonationAction({
        organizationId: fx.orgA.organizationId,
        reason: "SUP-12 — end-then-get",
      });
      if (!start.ok) throw new Error();
      await endImpersonationAction();
      // The cookie is also cleared by end, so reset it manually to
      // prove the DB-side filter (endedAt IS NULL) catches a stale cookie.
      setImpersonationCookie(start.sessionId);
      const s = await getActiveImpersonationSession(superadminUserId);
      expect(s).toBeNull();
    });

    it("returns null when the session has expired", async () => {
      // Insert directly with expiresAt in the past.
      const [row] = await db
        .insert(superadminImpersonationSessions)
        .values({
          superadminUserId,
          targetOrganizationId: fx.orgA.organizationId,
          reason: "SUP-13 — expired",
          expiresAt: new Date(Date.now() - 1_000),
        })
        .returning({ id: superadminImpersonationSessions.id });
      setImpersonationCookie(row!.id);
      const s = await getActiveImpersonationSession(superadminUserId);
      expect(s).toBeNull();
    });

    it("returns null when the cookie's session id is bogus", async () => {
      setImpersonationCookie("00000000-0000-0000-0000-000000000000");
      const s = await getActiveImpersonationSession(superadminUserId);
      expect(s).toBeNull();
    });
  });

  // ── cookie helpers ──────────────────────────────────────────────────

  describe("cookie helpers", () => {
    it("clearImpersonationCookie removes the cookie", () => {
      setImpersonationCookie("some-id");
      expect(cookieJar.get(IMPERSONATION_COOKIE_NAME)?.value).toBe("some-id");
      clearImpersonationCookie();
      expect(cookieJar.get(IMPERSONATION_COOKIE_NAME)).toBeUndefined();
    });
  });

  // ── exhausted: only active sessions are walked ──────────────────────

  it("getActiveImpersonationSession ignores rows for other users only via DB filter (defence in depth)", async () => {
    // Two active rows in the table, one for our admin, one for another.
    // We never set our cookie; the function returns null for "no cookie",
    // proving cookie absence wins regardless of DB state.
    const otherAdmin = `imp-defence-${Date.now().toString(36)}`;
    await db.insert(users).values({
      id: otherAdmin,
      name: "Other",
      email: `${otherAdmin}@bl15.example`,
      emailVerified: new Date(),
      isSuperadmin: true,
    });
    try {
      await db.insert(superadminImpersonationSessions).values({
        superadminUserId: otherAdmin,
        targetOrganizationId: fx.orgB.organizationId,
        reason: "SUP-defence — should not be visible without our cookie",
        expiresAt: new Date(Date.now() + 60 * 60_000),
      });
      const s = await getActiveImpersonationSession(superadminUserId);
      expect(s).toBeNull();
    } finally {
      await db
        .delete(superadminImpersonationSessions)
        .where(
          eq(superadminImpersonationSessions.superadminUserId, otherAdmin),
        );
      await db.delete(users).where(eq(users.id, otherAdmin));
    }
  });
});
