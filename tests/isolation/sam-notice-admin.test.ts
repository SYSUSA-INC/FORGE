/**
 * BL-STAB-10b — the admin page for FORGE's copy of SAM.gov's notice
 * descriptions (Postgres, SAM.gov stubbed): the switches are stored and
 * audited in the admin's organization, the spot-check compares stored
 * rows with SAM.gov's live text (counts only, three a day), and the
 * overview counts what the copy holds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, platformSettings, rateLimitCounters, samNoticeLoadRuns, samNotices } from "@/db/schema";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const admin = { id: "PLACEHOLDER", email: "ops@forge.test", name: "Ops", image: null as null, isSuperadmin: true as const, organizationId: "PLACEHOLDER", role: "admin" as const };
vi.mock("@/lib/auth-helpers", () => ({
  requireAuth: async () => admin,
  requireSuperadmin: async () => admin,
  requireCurrentOrg: async () => ({ user: admin, organizationId: admin.organizationId, isImpersonating: false }),
  getSessionUser: async () => admin,
}));

import { setSamNoticeSwitchAction, spotCheckSamNoticesAction } from "@/app/(app)/admin/sam-notices/actions";
import { samNoticeOverview } from "@/lib/sam-notice-admin";

const id = (n: number) => n.toString(16).padStart(32, "0");

describe("BL-STAB-10b — the SAM.gov notice copy admin page", () => {
  let fx: TwoTenantFixture;
  const clear = async () => {
    await db.delete(samNotices);
    await db.delete(samNoticeLoadRuns);
    await db.delete(platformSettings).where(like(platformSettings.key, "sam_notice.%"));
    await db.delete(rateLimitCounters).where(eq(rateLimitCounters.key, "samgov:spot-check"));
  };
  beforeEach(async () => {
    fx = await createTwoTenants("sam-notice-admin");
    admin.id = fx.orgA.userId;
    admin.organizationId = fx.orgA.organizationId;
    vi.stubEnv("SAMGOV_API_KEY", "SharedKey0123456789abcdefghijklmnopqSHRD");
    await clear();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await clear();
    await fx.cleanup();
  });

  it("stores the switches and audits them in the admin's organization", async () => {
    expect(await setSamNoticeSwitchAction({ name: "reads", on: false })).toEqual({ ok: true });
    expect(await setSamNoticeSwitchAction({ name: "nope" as "load", on: false })).toEqual({ ok: false, error: "Unknown switch." });
    expect((await samNoticeOverview()).switches).toEqual({ load: true, reads: false });
    const audits = await db
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "admin.sam_notice.switch")));
    expect(audits).toEqual([{ metadata: { name: "reads", on: false } }]);
  });

  it("spot-checks stored rows against SAM.gov (counts only, three a day) and counts what the copy holds", async () => {
    // Nothing to compare: no request to SAM.gov, and no check used up.
    for (let i = 0; i < 4; i++) expect(await spotCheckSamNoticesAction()).toMatchObject({ ok: false, error: expect.stringMatching(/^The copy has no notices/) });
    const posted = new Date(Date.now() - 2 * 86_400_000);
    await db.insert(samNotices).values([
      { noticeId: id(1), state: "text", description: "ServiceNow ITSM support.", postedAt: posted, digest: "a" },
      { noticeId: id(2), state: "text", description: "Help desk", postedAt: posted, digest: "b" },
      { noticeId: id(3), state: "none", description: null, postedAt: posted, digest: "c" },
      // Gone from SAM.gov's file: counted apart, never sampled.
      { noticeId: id(4), state: "text", description: "Old", postedAt: posted, digest: "d", goneOn: "2026-10-01" },
    ]);
    const live: Record<string, string> = { [id(1)]: "<p>ServiceNow ITSM\nsupport.</p>", [id(2)]: "Something else", [id(3)]: "SAM.gov has text" };
    const calls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        calls.push(url);
        return new Response(JSON.stringify({ description: live[url.searchParams.get("noticeid") ?? ""] }), { status: 200 });
      }),
    );
    const r = await spotCheckSamNoticesAction();
    expect(r).toEqual({ ok: true, sampled: 3, counts: { same: 1, different: 1, missing_in_file: 1, not_at_sam: 0, unread: 0 } });
    expect(calls.every((u) => u.hostname === "api.sam.gov" && u.pathname === "/prod/opportunities/v1/noticedesc")).toBe(true);
    await spotCheckSamNoticesAction();
    await spotCheckSamNoticesAction();
    expect(await spotCheckSamNoticesAction()).toMatchObject({ ok: false, error: expect.stringMatching(/^Three spot-checks a day/) });

    const o = await samNoticeOverview();
    expect([o.byState, o.gone, o.newestPostedAt?.getTime()]).toEqual([{ text: 2, none: 1 }, 1, posted.getTime()]);
  });

  it("dates the file from the last good run, however many failed runs followed it", async () => {
    const fileOf = new Date("2026-10-08T03:30:00Z");
    await db.insert(samNoticeLoadRuns).values({ status: "ok", sourceModifiedAt: fileOf, startedAt: new Date(Date.now() - 20 * 3_600_000) });
    await db.insert(samNoticeLoadRuns).values(
      Array.from({ length: 15 }, (_, i) => ({ status: "failed", startedAt: new Date(Date.now() - i * 60_000), error: "HTTP 503" })),
    );
    const o = await samNoticeOverview();
    expect(o.runs).toHaveLength(14);
    expect(o.runs.every((r) => r.status === "failed")).toBe(true);
    expect(o.fileUpdatedAt?.getTime()).toBe(fileOf.getTime());
  });
});
