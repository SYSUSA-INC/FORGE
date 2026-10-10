/**
 * BL-STAB-10 — Import from SAM.gov and the scout against Postgres, with
 * SAM.gov stubbed (two tenants). SAM.gov ignores a keyword, so FORGE
 * checks it: only notices that really mention it come back as matches,
 * award notices stay out by default, each solicitation is one row and
 * "already imported" counts only this organization's opportunities. The
 * description check takes validated notice ids only; an import keeps
 * the notice's description; a scout keyword find is one FORGE confirmed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, opportunities, scoutCandidates } from "@/db/schema";
import { runScoutForOrganization, saveScoutProfile } from "@/lib/scout";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const sessionUserStub = {
  id: "PLACEHOLDER",
  email: "capture@import.test",
  name: "Capture Lead",
  image: null as null,
  isSuperadmin: false as const,
  organizationId: "PLACEHOLDER",
  role: "admin" as const,
};
vi.mock("@/lib/auth-helpers", () => ({
  requireAuth: async () => sessionUserStub,
  requireCurrentOrg: async () => ({ user: sessionUserStub, organizationId: sessionUserStub.organizationId, isImpersonating: false }),
  requireOrgAdmin: async () => sessionUserStub,
  getSessionUser: async () => sessionUserStub,
}));

import { importSamGovOpportunitiesAction, loadSamGovOpportunitiesAction, readSamDescriptionsAction } from "@/app/(app)/opportunities/import/actions";

const id = (n: number) => n.toString(16).padStart(32, "0");
const link = (n: number) => `https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=${id(n)}`;
const notice = (n: number, o: Record<string, unknown>) => ({
  noticeId: id(n),
  title: `Notice ${n}`,
  solicitationNumber: `SOL-${n}`,
  active: "Yes",
  type: "Solicitation",
  postedDate: `2026-10-0${n % 9 || 1}`,
  description: link(n),
  department: "VETERANS AFFAIRS, DEPARTMENT OF",
  ...o,
});
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function stubSam(rows: unknown[], descriptions: Record<string, string>): URL[] {
  const calls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.pathname.endsWith("/search")) return json({ totalRecords: rows.length, opportunitiesData: rows });
      const text = descriptions[url.searchParams.get("noticeid") ?? ""];
      return text === undefined ? new Response("Description Not Found", { status: 404 }) : json({ description: text });
    }),
  );
  return calls;
}

describe("BL-STAB-10 — Import from SAM.gov checks the keyword itself", () => {
  let fx: TwoTenantFixture;

  beforeEach(async () => {
    fx = await createTwoTenants("samgov-import");
    sessionUserStub.id = fx.orgA.userId;
    sessionUserStub.organizationId = fx.orgA.organizationId;
    vi.stubEnv("SAMGOV_API_KEY", "SHAREDKEY0123456789abcdef");
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await fx.cleanup();
  });

  // What SAM.gov returns for NAICS 541519 whatever the keyword (the owner's report).
  const returned = [
    notice(1, { title: "ServiceNow ITSM renewal" }),
    notice(2, { title: "ERP discovery session", type: "Sources Sought" }),
    notice(3, { title: "Multiple Award Schedule", type: "Award Notice", solicitationNumber: "47QSMD20R0001" }),
    notice(4, { title: "LoadRunner maintenance" }),
    notice(5, { title: "Help desk", solicitationNumber: "SOL-6", postedDate: "2026-09-01" }),
    notice(6, { title: "Help desk (amended)", postedDate: "2026-10-05" }),
  ];
  const descriptions = { [id(2)]: "The current ITSM tool is ServiceNow.", [id(4)]: "Performance testing licenses.", [id(6)]: "Tier 1 support." };

  it("returns only notices that mention the keyword, open types only, one row per solicitation", async () => {
    const calls = stubSam(returned, descriptions);
    const res = await loadSamGovOpportunitiesAction({ naicsCodes: ["541519"], keyword: "ServiceNow" });
    if (!res.ok) throw new Error(res.error);
    expect(res.opportunities.map((o) => [o.title, o.match?.status === "match" ? o.match.where : null])).toEqual([
      ["ServiceNow ITSM renewal", "title"],
      ["ERP discovery session", "description"],
    ]);
    expect(res.unchecked).toEqual([]);
    expect(res.counts).toMatchObject({ samTotal: 6, otherTypes: 1, folded: 1, matched: 2, notMentioned: 2 });
    const search = calls.filter((u) => u.pathname.endsWith("/search"));
    expect(search).toHaveLength(1);
    expect(search[0]!.searchParams.has("q")).toBe(false);
    // The title match needed no description read; the award was never read.
    expect(calls.map((u) => u.searchParams.get("noticeid")).filter(Boolean).sort()).toEqual([id(2), id(4), id(6)]);
  });

  it("'already imported' counts only this organization's opportunities, across a solicitation's notices", async () => {
    await db.insert(opportunities).values([
      { organizationId: fx.orgB.organizationId, title: "B's copy", noticeId: id(1) },
      { organizationId: fx.orgA.organizationId, title: "A's earlier notice", noticeId: id(5) },
    ]);
    stubSam(returned, descriptions);
    const res = await loadSamGovOpportunitiesAction({ naicsCodes: ["541519"], noticeTypes: ["o", "r"] });
    if (!res.ok) throw new Error(res.error);
    const byTitle = Object.fromEntries(res.opportunities.map((o) => [o.title, [o.alreadyImported, o.earlierNoticeIds]]));
    expect(byTitle["ServiceNow ITSM renewal"]).toEqual([false, []]);
    expect(byTitle["Help desk (amended)"]).toEqual([true, [id(5)]]);
  });

  it("checks descriptions only for well-formed notice ids, and an import keeps the description, in A only", async () => {
    const calls = stubSam([], { [id(7)]: "Seven" });
    expect(await readSamDescriptionsAction(["https://evil.example/x", "../x", "N1"])).toEqual({ ok: false, error: "Nothing to check." });
    expect(calls).toHaveLength(0);
    expect(await readSamDescriptionsAction([id(7), id(8)])).toEqual({ ok: true, descriptions: { [id(7)]: { text: "Seven" }, [id(8)]: { none: true } } });
    expect(calls.map((u) => `${u.hostname}${u.pathname}`)).toEqual(Array(2).fill("api.sam.gov/prod/opportunities/v1/noticedesc"));

    const imported = await importSamGovOpportunitiesAction([{ ...notice(7, {}), description: "" }]);
    expect(imported).toEqual({ ok: true, imported: 1, skipped: 0 });
    const [row] = await db.select({ description: opportunities.description, agency: opportunities.agency }).from(opportunities).where(and(eq(opportunities.organizationId, fx.orgA.organizationId), eq(opportunities.noticeId, id(7))));
    expect(row).toEqual({ description: "Seven", agency: "VETERANS AFFAIRS, DEPARTMENT OF" });
    expect(await db.select().from(opportunities).where(and(eq(opportunities.organizationId, fx.orgB.organizationId), eq(opportunities.noticeId, id(7))))).toEqual([]);
    const audits = await db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "opportunity.import")));
    expect(audits).toHaveLength(1);
  });

  it("a scout keyword find is one FORGE confirmed in the title", async () => {
    await saveScoutProfile({ organizationId: fx.orgA.organizationId, patch: { keywords: ["ServiceNow"] }, actor: { userId: fx.orgA.userId } });
    const calls = stubSam([notice(1, { title: "ServiceNow ITSM renewal" }), notice(4, { title: "LoadRunner maintenance" })], {});
    await runScoutForOrganization({ organizationId: fx.orgA.organizationId, trigger: "manual" });
    const search = calls.find((u) => u.pathname.endsWith("/search"))!;
    expect([search.searchParams.get("title"), search.searchParams.has("q")]).toEqual(["servicenow", false]);
    const rows = await db.select({ noticeId: scoutCandidates.noticeId, source: scoutCandidates.source }).from(scoutCandidates).where(eq(scoutCandidates.organizationId, fx.orgA.organizationId));
    expect(rows).toEqual([{ noticeId: id(1), source: "keyword" }]);
  });
});
