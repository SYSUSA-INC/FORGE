/**
 * BL-STAB-7a — SAM.gov failures at runtime, against Postgres with fetch
 * stubbed. Two tenants. Asserts: the daily Q&A poll stops at the first
 * rejected-key answer (one call, nothing stamped) and does nothing without
 * a key; a notice SAM.gov says it doesn't have is stamped checked on its
 * owner's row only; attachment links that can never be read are marked
 * seen so they stop blocking a real Q&A attachment; importing a company
 * from SAM.gov is audited in the importer's organization only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, companies, solicitations } from "@/db/schema";
import { dispatchSolicitationQaPolls, pollSolicitationQa } from "@/lib/solicitation-qa";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const sessionUserStub = {
  id: "PLACEHOLDER",
  email: "capture@samgov.test",
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

import { importSamGovCompanyAction } from "@/app/(app)/companies/actions";

const OWNER_BODY = "<html><body><h1>API_KEY_INVALID</h1></body></html>";
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function stubFetch(answer: (url: URL) => Response): URL[] {
  const calls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      calls.push(url);
      return answer(url);
    }),
  );
  return calls;
}

describe("BL-STAB-7a — SAM.gov failures at runtime", () => {
  let fx: TwoTenantFixture;

  beforeEach(async () => {
    fx = await createTwoTenants("samgov-7a");
    sessionUserStub.id = fx.orgA.userId;
    sessionUserStub.organizationId = fx.orgA.organizationId;
    vi.stubEnv("SAMGOV_API_KEY", "SHAREDKEY0123456789");
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await fx.cleanup();
  });

  async function solicitationWithNotice(organizationId: string, noticeId: string) {
    const [row] = await db
      .insert(solicitations)
      .values({ organizationId, title: `RFP ${noticeId}`, parseStatus: "parsed", noticeId })
      .returning({ id: solicitations.id });
    return row!.id;
  }
  async function qaState(organizationId: string, id: string) {
    const [row] = await db
      .select({ qaCheckedAt: solicitations.qaCheckedAt, qaSeenLinks: solicitations.qaSeenLinks })
      .from(solicitations)
      .where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.id, id)));
    return row!;
  }

  it("the daily poll stops at the first rejected key and does nothing without one", async () => {
    const a = await solicitationWithNotice(fx.orgA.organizationId, "NA-1");
    const b = await solicitationWithNotice(fx.orgB.organizationId, "NB-1");
    const calls = stubFetch(() => new Response(OWNER_BODY, { status: 401 }));
    const run = await dispatchSolicitationQaPolls();
    expect(run).toMatchObject({ stoppedByKey: true, skippedNoKey: false, solicitationsPolled: 1, errors: 1 });
    expect(calls).toHaveLength(1);
    expect((await qaState(fx.orgA.organizationId, a)).qaCheckedAt).toBeNull();
    expect((await qaState(fx.orgB.organizationId, b)).qaCheckedAt).toBeNull();

    vi.stubEnv("SAMGOV_API_KEY", "");
    expect(await dispatchSolicitationQaPolls()).toMatchObject({ skippedNoKey: true, solicitationsPolled: 0 });
    expect(calls).toHaveLength(1);
  });

  it("a notice SAM.gov doesn't have is stamped checked, on its owner's row only", async () => {
    const a = await solicitationWithNotice(fx.orgA.organizationId, "GONE-1");
    const b = await solicitationWithNotice(fx.orgB.organizationId, "GONE-1");
    stubFetch(() => json({ totalRecords: 0, opportunitiesData: [] }));
    const poll = await pollSolicitationQa({ organizationId: fx.orgA.organizationId, solicitationId: a });
    expect(poll).toMatchObject({ ok: false, cls: "not_found", error: "SAM.gov has no notice with that ID posted in the last year." });
    expect((await qaState(fx.orgA.organizationId, a)).qaCheckedAt).not.toBeNull();
    expect((await qaState(fx.orgB.organizationId, b)).qaCheckedAt).toBeNull();
  });

  it("links that can never be read are marked seen, so a real Q&A attachment is reached", async () => {
    const a = await solicitationWithNotice(fx.orgA.organizationId, "QA-1");
    const foreign = Array.from({ length: 5 }, (_, i) => `https://files.example/${i}.pdf`);
    const real = "https://sam.gov/api/prod/opps/v3/opportunities/resources/files/qa/download?api_key=null&token=";
    const qaText = "Questions and Answers\nQ1: Is there an incumbent?\nA1: Yes.\nQ2: Is a site visit planned?\nA2: No.";
    const calls = stubFetch((url) =>
      url.pathname.endsWith("/search")
        ? json({ opportunitiesData: [{ noticeId: "QA-1", title: "RFP", postedDate: "2026-10-01", description: "", resourceLinks: [...foreign, real] }] })
        : new Response(qaText, { status: 200, headers: { "content-type": "text/plain", "content-disposition": 'attachment; filename="QA.txt"' } }),
    );

    const first = await pollSolicitationQa({ organizationId: fx.orgA.organizationId, solicitationId: a });
    expect(first).toMatchObject({ ok: true, newDocuments: 5, retrying: 0 });
    if (first.ok) expect(first.skipped[0]).toBe("Skipped an attachment link that isn't on sam.gov.");
    expect((await qaState(fx.orgA.organizationId, a)).qaSeenLinks).toEqual(foreign);
    expect(calls.filter((u) => u.hostname !== "api.sam.gov")).toHaveLength(0);

    const second = await pollSolicitationQa({ organizationId: fx.orgA.organizationId, solicitationId: a });
    expect(second).toMatchObject({ ok: true, newDocuments: 1, added: 2 });
    expect(calls.some((u) => u.pathname.endsWith("/qa/download"))).toBe(true);
  });

  it("importing a company from SAM.gov is audited in the importer's organization", async () => {
    stubFetch(() =>
      json({ totalRecords: 1, entityData: [{ entityRegistration: { legalBusinessName: "Acme Federal LLC", ueiSAM: "ACMEUEI12345" } }] }),
    );
    const res = await importSamGovCompanyAction("ACMEUEI12345", "teaming_partner");
    if (!res.ok) throw new Error(res.error);
    const [row] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.organizationId, fx.orgA.organizationId), eq(companies.id, res.id)));
    expect(row).toBeDefined();
    const auditsA = await db
      .select({ action: auditLogs.action, resourceId: auditLogs.resourceId, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "company.import_samgov")));
    expect(auditsA).toEqual([{ action: "company.import_samgov", resourceId: res.id, metadata: { uei: "ACMEUEI12345", relationship: "teaming_partner" } }]);
    const auditsB = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgB.organizationId), eq(auditLogs.action, "company.import_samgov")));
    expect(auditsB).toHaveLength(0);
  });
});
