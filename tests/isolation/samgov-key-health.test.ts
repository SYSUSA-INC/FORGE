/**
 * BL-STAB-7d — company keys in the background jobs, against Postgres with
 * fetch stubbed (two tenants): a company whose key SAM.gov rejects costs
 * one call and never holds up another company's Q&A check; a dead shared
 * key leaves companies with their own key polled; three SAM.gov failures
 * in a row end the run and the failed notices rotate to the back; no
 * download starts past the budget; SAM.gov's answers update the stored
 * key's status only for the key that was used, audited in its company;
 * the scout stops using the shared key once it fails.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, organizationSamgovKeys, organizations, scoutRuns, solicitations } from "@/db/schema";
import { fetchSamNotice } from "@/lib/samgov";
import { resolveSamCredential, setCompanySamKey } from "@/lib/samgov-key";
import { samKeyNotice } from "@/lib/samgov-key-logic";
import { runScoutForOrganization } from "@/lib/scout";
import { dispatchSolicitationQaPolls, pollSolicitationQa } from "@/lib/solicitation-qa";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const KEY_A = "CompanyAkey0123456789abcdefghijklmnopAAAA";
const KEY_A2 = "CompanyAkey0123456789abcdefghijklmnopA222";
const SHARED = "SharedKey0123456789abcdefghijklmnopqSHRD";
const RING = `k1:${randomBytes(32).toString("base64")}`;
const INVALID = () => new Response("<html><body><h1>API_KEY_INVALID</h1></body></html>", { status: 401 });
const notice = (noticeId: string, resourceLinks: string[] = []) =>
  new Response(JSON.stringify({ opportunitiesData: [{ noticeId, title: "RFP", postedDate: "2026-10-01", description: "", resourceLinks }] }), { status: 200 });

function stubFetch(answer: (url: URL, key: string | null) => Response): URL[] {
  const calls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      calls.push(url);
      return answer(url, url.searchParams.get("api_key"));
    }),
  );
  return calls;
}
const keysOf = (calls: URL[]) => calls.map((u) => u.searchParams.get("api_key"));

describe("BL-STAB-7d — company keys in the background jobs", () => {
  let fx: TwoTenantFixture;

  beforeEach(async () => {
    fx = await createTwoTenants("samgov-7d");
    vi.stubEnv("FORGE_SECRET_KEYS", RING);
    vi.stubEnv("SAMGOV_API_KEY", SHARED);
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await fx.cleanup();
  });

  async function saveKeyA(key = KEY_A) {
    stubFetch(() => new Response(JSON.stringify({ totalRecords: 0, opportunitiesData: [] }), { status: 200 }));
    const res = await setCompanySamKey({ organizationId: fx.orgA.organizationId, rawKey: key, actor: { userId: fx.orgA.userId } });
    expect(res.ok).toBe(true);
  }
  async function solicitationsFor(organizationId: string, noticeIds: string[], qaCheckedAt: Date | null = null) {
    const rows = await db
      .insert(solicitations)
      .values(noticeIds.map((noticeId) => ({ organizationId, title: `RFP ${noticeId}`, parseStatus: "parsed" as const, noticeId, qaCheckedAt })))
      .returning({ id: solicitations.id });
    return rows.map((r) => r.id);
  }
  const qaRows = (organizationId: string) =>
    db
      .select({ noticeId: solicitations.noticeId, qaCheckedAt: solicitations.qaCheckedAt, qaAttemptedAt: solicitations.qaAttemptedAt, qaSeenLinks: solicitations.qaSeenLinks })
      .from(solicitations)
      .where(eq(solicitations.organizationId, organizationId));
  const keyRow = async () => (await db.select().from(organizationSamgovKeys).where(eq(organizationSamgovKeys.organizationId, fx.orgA.organizationId)))[0]!;
  const keyAudits = (organizationId: string) =>
    db
      .select({ action: auditLogs.action, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), inArray(auditLogs.action, ["settings.samgov_key.rejected", "settings.samgov_key.accepted"])));

  it("a company whose key SAM.gov rejects costs one call; another company's notice is still checked", async () => {
    await saveKeyA();
    await solicitationsFor(fx.orgA.organizationId, Array.from({ length: 30 }, (_, i) => `NA-${i}`));
    const [b] = await solicitationsFor(fx.orgB.organizationId, ["NB-1"]);
    const calls = stubFetch((url, key) => (key === KEY_A ? INVALID() : notice(url.searchParams.get("noticeid") ?? "")));

    const run = await dispatchSolicitationQaPolls();
    expect(run).toMatchObject({ solicitationsPolled: 2, blockedOrganizations: 1, stoppedByKey: false, samOutage: false, errors: 1 });
    expect(keysOf(calls).filter((k) => k === KEY_A)).toHaveLength(1);
    expect(keysOf(calls)).toContain(SHARED);
    expect((await qaRows(fx.orgB.organizationId))[0]!.qaCheckedAt).not.toBeNull();
    const aRows = await qaRows(fx.orgA.organizationId);
    expect(aRows.filter((r) => r.qaAttemptedAt !== null)).toHaveLength(1);
    expect(aRows.every((r) => r.qaCheckedAt === null)).toBe(true);
    expect(b).toBeDefined();

    // Recorded on A's key, audited in A only, with the last four only.
    expect(await keyRow()).toMatchObject({ status: "invalid" });
    const audits = await keyAudits(fx.orgA.organizationId);
    expect(audits).toEqual([{ action: "settings.samgov_key.rejected", metadata: { last4: "AAAA", status: "invalid", endpoint: "notice" } }]);
    expect(JSON.stringify(audits)).not.toContain(KEY_A);
    expect(await keyAudits(fx.orgB.organizationId)).toHaveLength(0);

    // Next run: A is left out until its key is replaced, so its dead key isn't called again.
    const next = stubFetch(() => INVALID());
    expect(await dispatchSolicitationQaPolls()).toMatchObject({ solicitationsPolled: 0, blockedOrganizations: 0 });
    expect(next).toHaveLength(0);
    const status = { inUse: "company" as const, company: { status: "invalid", statusAt: new Date(), readable: true } };
    expect(samKeyNotice(status)?.text).toMatch(/daily Q&A check is paused until a company admin replaces it under Settings → Integrations\.$/);

    // A working answer for the same key (a person's Check now) brings it back, audited.
    stubFetch((url) => notice(url.searchParams.get("noticeid") ?? ""));
    const [first] = await db.select({ id: solicitations.id }).from(solicitations).where(eq(solicitations.organizationId, fx.orgA.organizationId)).limit(1);
    expect((await pollSolicitationQa({ organizationId: fx.orgA.organizationId, solicitationId: first!.id })).ok).toBe(true);
    expect(await keyRow()).toMatchObject({ status: "ok" });
    expect((await keyAudits(fx.orgA.organizationId)).map((a) => a.action)).toEqual(["settings.samgov_key.rejected", "settings.samgov_key.accepted"]);
  });

  it("when the shared key fails, companies with their own key are still polled in the same run", async () => {
    await saveKeyA();
    await solicitationsFor(fx.orgB.organizationId, ["NB-1", "NB-2"]);
    // Checked two days ago, so B's never-checked notice comes first.
    await solicitationsFor(fx.orgA.organizationId, ["NA-1"], new Date(Date.now() - 2 * 86_400_000));
    const calls = stubFetch((url, key) => (key === SHARED ? INVALID() : notice(url.searchParams.get("noticeid") ?? "")));

    const run = await dispatchSolicitationQaPolls();
    expect(run).toMatchObject({ stoppedByKey: true, blockedOrganizations: 0, solicitationsPolled: 2, errors: 1 });
    expect(keysOf(calls)).toEqual([SHARED, KEY_A]);
    const [a] = await qaRows(fx.orgA.organizationId);
    expect(a!.qaCheckedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect((await qaRows(fx.orgB.organizationId)).filter((r) => r.qaAttemptedAt !== null)).toHaveLength(1);

    // Without any key at all, nothing is polled.
    vi.stubEnv("SAMGOV_API_KEY", "");
    await db.delete(organizationSamgovKeys).where(eq(organizationSamgovKeys.organizationId, fx.orgA.organizationId));
    const none = stubFetch(() => INVALID());
    expect(await dispatchSolicitationQaPolls()).toMatchObject({ skippedNoKey: true, solicitationsPolled: 0 });
    expect(none).toHaveLength(0);
  });

  it("three SAM.gov failures in a row end the run; those notices go to the back of the queue", async () => {
    await solicitationsFor(fx.orgA.organizationId, ["NA-1", "NA-2", "NA-3"]);
    await solicitationsFor(fx.orgB.organizationId, ["NB-1", "NB-2"]);
    const down = stubFetch(() => new Response("", { status: 503 }));
    expect(await dispatchSolicitationQaPolls()).toMatchObject({ samOutage: true, solicitationsPolled: 3, errors: 3, deferred: 2 });
    expect(down).toHaveLength(3);
    const tried = new Set(down.map((u) => u.searchParams.get("noticeid")));

    const up = stubFetch((url) => notice(url.searchParams.get("noticeid") ?? ""));
    expect(await dispatchSolicitationQaPolls()).toMatchObject({ samOutage: false, solicitationsPolled: 2, deferred: 0 });
    expect(up.map((u) => u.searchParams.get("noticeid")).filter((id) => tried.has(id))).toEqual([]);
  });

  it("no download starts that could run past the cron's budget; those links wait unseen", async () => {
    const [a] = await solicitationsFor(fx.orgA.organizationId, ["NA-1"]);
    const links = [1, 2].map((i) => `https://sam.gov/files/f${i}/download?api_key=null&token=`);
    const calls = stubFetch(() => notice("NA-1", links));
    const res = await pollSolicitationQa({ organizationId: fx.orgA.organizationId, solicitationId: a!, downloadsUntil: Date.now() + 30_000 });
    expect(res).toMatchObject({ ok: true, newDocuments: 0, retrying: 2 });
    expect(calls).toHaveLength(1);
    const [row] = await qaRows(fx.orgA.organizationId);
    expect(row).toMatchObject({ qaSeenLinks: [] });
    expect(row!.qaCheckedAt).not.toBeNull();
  });

  it("an answer for a replaced key never marks the new one; a request limit is status only", async () => {
    await saveKeyA();
    const old = await resolveSamCredential(fx.orgA.organizationId);
    await saveKeyA(KEY_A2);
    stubFetch(() => INVALID());
    if (!old.ok) throw new Error("expected a credential");
    expect((await fetchSamNotice(old.cred, "NA-1")).ok).toBe(false);
    expect(await keyRow()).toMatchObject({ last4: "A222", status: "ok" });

    stubFetch(() => new Response("<h1>OVER_RATE_LIMIT</h1>", { status: 429 }));
    const now = await resolveSamCredential(fx.orgA.organizationId);
    if (!now.ok) throw new Error("expected a credential");
    await fetchSamNotice(now.cred, "NA-1");
    await fetchSamNotice(now.cred, "NA-2");
    expect(await keyRow()).toMatchObject({ last4: "A222", status: "rate_limited" });

    stubFetch((url) => notice(url.searchParams.get("noticeid") ?? ""));
    const later = await resolveSamCredential(fx.orgA.organizationId);
    if (!later.ok) throw new Error("expected a credential");
    expect((await fetchSamNotice(later.cred, "NA-1")).ok).toBe(true);
    expect(await keyRow()).toMatchObject({ status: "ok" });
    expect(await keyAudits(fx.orgA.organizationId)).toHaveLength(0);
  });

  it("the scout stops using the shared key once it fails, and says so for the next company", async () => {
    await db.update(organizations).set({ primaryNaics: "541512" }).where(inArray(organizations.id, [fx.orgA.organizationId, fx.orgB.organizationId]));
    const calls = stubFetch(() => INVALID());
    const sharedKey = { failed: null as string | null };
    await runScoutForOrganization({ organizationId: fx.orgA.organizationId, trigger: "cron", sharedKey });
    expect(calls).toHaveLength(1);
    expect(sharedKey.failed).toMatch(/^SAM\.gov rejected FORGE's shared SAM\.gov key\./);

    const b = await runScoutForOrganization({ organizationId: fx.orgB.organizationId, trigger: "cron", sharedKey });
    expect(calls).toHaveLength(1);
    expect(b.note).toContain(`SAM.gov was not searched: ${sharedKey.failed}`);
    const [run] = await db.select({ note: scoutRuns.note }).from(scoutRuns).where(eq(scoutRuns.organizationId, fx.orgB.organizationId));
    expect(run!.note).toContain("SAM.gov was not searched");
  });
});
