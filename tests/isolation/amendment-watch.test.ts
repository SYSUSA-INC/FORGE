/**
 * BL-SCOUT-AMEND — the amendment watch against Postgres, SAM.gov stubbed,
 * two tenants. An open opportunity's solicitation has its original notice
 * (two files, posted before the opportunity was added) and Amendment 0001
 * (one file, a new response date, posted since). One check files all
 * three on the opportunity (the amendment under the first solicitation),
 * queues their parse, moves the response date, notes the activity, audits
 * the check, and tells the owner and the proposal manager — not someone of
 * another organization assigned by mistake; the default rule is added for
 * a company that has none. A second check files and tells nothing. A
 * closed pursuit isn't watched; the other tenant's opportunity with the
 * same number is untouched; the daily run picks up a new file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  backgroundJobs,
  memberships,
  notificationRules,
  notifications,
  opportunities,
  opportunityActivities,
  proposals,
  proposalSections,
  solicitations,
  users,
} from "@/db/schema";
import { checkOpportunityNotices, dispatchAmendmentWatch } from "@/lib/amendment-watch";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const SOLNUM = "AW-36C10B26R0042";
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
const link = (name: string) => `https://sam.gov/api/prod/opps/v3/opportunities/resources/files/${name}/download?api_key=null&token=`;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

let extraLinks: string[] = [];
function notices() {
  return [
    { noticeId: "AW-0", title: "Help desk modernization", solicitationNumber: SOLNUM, type: "Solicitation", postedDate: daysAgo(20).toISOString(), responseDeadLine: "2026-12-01T17:00:00Z", resourceLinks: [link("rfp"), link("pws")] },
    { noticeId: "AW-1", title: "Help desk modernization, Amendment 0001", solicitationNumber: SOLNUM, type: "Solicitation", postedDate: daysAgo(2).toISOString(), responseDeadLine: "2026-12-15T17:00:00Z", resourceLinks: [link("sf30"), ...extraLinks] },
    // SAM.gov's number filter is loose: another solicitation is left out.
    { noticeId: "AW-X", title: "Other", solicitationNumber: "AW-36C10B26R9999", type: "Solicitation", postedDate: daysAgo(1).toISOString(), resourceLinks: [link("other")] },
  ];
}
const FILE_NAMES: Record<string, string> = { rfp: "RFP AW-36C10B26R0042.pdf", pws: "PWS.docx", sf30: "SF30 Amendment 0001.pdf", qa: "Questions and Answers.pdf", other: "Other.pdf" };

describe("BL-SCOUT-AMEND — the amendment watch", () => {
  let fx: TwoTenantFixture;
  let tier: { cleanup: () => Promise<void> } | null = null;
  const pm = "aw-pm-user";
  const outsider = "aw-outsider-user";

  beforeEach(async () => {
    fx = await createTwoTenants("amend-watch");
    vi.stubEnv("SAMGOV_API_KEY", "SHAREDKEY0123456789abcdef");
    extraLinks = [];
    tier = await createTierAndSubscribe({ organizationId: fx.orgA.organizationId, slug: `aw-${Date.now()}`, name: "AW" });
    await db.insert(users).values([
      { id: pm, name: "Pat Manager", email: "aw-pm@bl19-isolation.test" },
      { id: outsider, name: "Other Org", email: "aw-outsider@bl19-isolation.test" },
    ]);
    await db.insert(memberships).values([
      { userId: pm, organizationId: fx.orgA.organizationId, role: "proposal", status: "active" },
      { userId: outsider, organizationId: fx.orgB.organizationId, role: "proposal", status: "active" },
    ]);
    await db
      .update(opportunities)
      .set({ solicitationNumber: SOLNUM, noticeId: "AW-0", stage: "identified", ownerUserId: fx.orgA.userId, responseDueDate: new Date("2026-12-01T17:00:00Z"), createdAt: daysAgo(10) })
      .where(eq(opportunities.id, fx.orgA.opportunityId));
    await db.update(opportunities).set({ solicitationNumber: SOLNUM, noticeId: "AW-0" }).where(eq(opportunities.id, fx.orgB.opportunityId));
    await db.update(proposals).set({ proposalManagerUserId: pm }).where(eq(proposals.id, fx.orgA.proposalId));
    // Someone of the other organization, wrongly set as a section author: never told.
    await db.insert(proposalSections).values({ proposalId: fx.orgA.proposalId, kind: "technical", title: "Technical", authorUserId: outsider });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/search")) return json({ totalRecords: 3, opportunitiesData: url.searchParams.get("solnum") === SOLNUM ? notices() : [] });
        const name = url.pathname.split("/").at(-2) ?? "file";
        return new Response(`Contents of ${name}`, { status: 200, headers: { "content-type": "text/plain", "content-disposition": `attachment; filename="${FILE_NAMES[name] ?? name}"` } });
      }),
    );
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await db.delete(users).where(inArray(users.id, [pm, outsider]));
    await tier?.cleanup();
    await fx.cleanup();
  });

  const filedOn = (organizationId: string, opportunityId: string) =>
    db
      .select({ id: solicitations.id, fileName: solicitations.fileName, parent: solicitations.parentSolicitationId, amendmentNumber: solicitations.amendmentNumber, noticeId: solicitations.noticeId, source: solicitations.source, storagePath: solicitations.storagePath })
      .from(solicitations)
      .where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.opportunityId, opportunityId)));

  it("files every new document, moves the date, tells the team once, and leaves the other tenant alone", async () => {
    const orgA = fx.orgA.organizationId;
    const res = await checkOpportunityNotices({ organizationId: orgA, opportunityId: fx.orgA.opportunityId });
    expect(res).toMatchObject({ ok: true, filed: 3, amendments: 1, notified: true, dueMovedTo: "2026-12-15", retrying: 0 });

    const filed = await filedOn(orgA, fx.orgA.opportunityId);
    expect(filed.map((f) => f.fileName).sort()).toEqual(["PWS.docx", "RFP AW-36C10B26R0042.pdf", "SF30 Amendment 0001.pdf"]);
    const base = filed.find((f) => f.fileName.startsWith("RFP"))!;
    const amendment = filed.find((f) => f.fileName.startsWith("SF30"))!;
    expect(base.parent).toBeNull();
    expect(amendment).toMatchObject({ parent: base.id, amendmentNumber: "0001", noticeId: "AW-1", source: "samgov-watch" });
    // One record per notice carries the notice ID (the daily Q&A check reads each notice once).
    expect(filed.filter((f) => f.noticeId === "AW-0")).toHaveLength(1);
    for (const f of filed) expect(f.storagePath.startsWith(`org/${orgA}/solicitation/${f.id}/`)).toBe(true);
    const jobs = await db.select({ resourceId: backgroundJobs.resourceId }).from(backgroundJobs).where(and(eq(backgroundJobs.organizationId, orgA), eq(backgroundJobs.kind, "solicitation_parse")));
    expect(jobs.map((j) => j.resourceId).sort()).toEqual(filed.map((f) => f.id).sort());

    const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, fx.orgA.opportunityId));
    expect(opp!.responseDueDate?.toISOString()).toBe("2026-12-15T17:00:00.000Z");
    expect(opp!.samWatchSeenLinks).toHaveLength(3);
    expect(opp!.samWatchNoticeIds.sort()).toEqual(["AW-0", "AW-1"]);
    expect(opp!.samWatchCheckedAt).not.toBeNull();

    // The owner and the proposal manager are told; the other organization's user is not.
    const told = await db.select({ to: notifications.recipientUserId, kind: notifications.kind, subject: notifications.subject, body: notifications.body, link: notifications.linkPath }).from(notifications).where(eq(notifications.organizationId, orgA));
    expect(told.map((t) => t.to).sort()).toEqual([fx.orgA.userId, pm].sort());
    expect(told[0]).toMatchObject({ kind: "solicitation_amended", subject: `Amendment 0001 posted — ${opp!.title}`, link: `/opportunities/${fx.orgA.opportunityId}` });
    expect(told[0]!.body).toContain("The response date moved from 2026-12-01 to 2026-12-15");
    expect(told[0]!.body).toContain("Filed on the opportunity and being read: SF30 Amendment 0001.pdf.");
    expect(await db.select().from(notifications).where(eq(notifications.recipientUserId, outsider))).toHaveLength(0);
    const rules = await db.select({ name: notificationRules.name, channels: notificationRules.channels }).from(notificationRules).where(and(eq(notificationRules.organizationId, orgA), eq(notificationRules.triggerEventKind, "solicitation_amended")));
    expect(rules).toEqual([{ name: "Default: Solicitation amended", channels: ["in_app", "email"] }]);

    const notes = await db.select({ title: opportunityActivities.title }).from(opportunityActivities).where(eq(opportunityActivities.opportunityId, fx.orgA.opportunityId));
    expect(notes.map((n) => n.title)).toContain("SAM.gov: Amendment 0001 posted");
    const audits = await db.select({ metadata: auditLogs.metadata }).from(auditLogs).where(and(eq(auditLogs.organizationId, orgA), eq(auditLogs.action, "opportunity.sam_watch")));
    expect(audits).toEqual([{ metadata: { filed: 3, amendments: 1, dueMovedTo: "2026-12-15", skipped: 0, told: true } }]);

    // Again: nothing new, nothing filed, nobody told twice.
    const again = await checkOpportunityNotices({ organizationId: orgA, opportunityId: fx.orgA.opportunityId });
    expect(again).toMatchObject({ ok: true, filed: 0, amendments: 0, notified: false, dueMovedTo: null });
    expect(await filedOn(orgA, fx.orgA.opportunityId)).toHaveLength(3);
    expect(await db.select().from(notifications).where(eq(notifications.organizationId, orgA))).toHaveLength(2);

    // The other tenant's opportunity with the same number was not touched.
    expect(await filedOn(fx.orgB.organizationId, fx.orgB.opportunityId)).toHaveLength(0);
    // And can't be checked through another organization.
    expect(await checkOpportunityNotices({ organizationId: orgA, opportunityId: fx.orgB.opportunityId })).toEqual({ ok: false, error: "Opportunity not found." });
  });

  it("announces an amendment once, reports its late file, and refuses a second manual check at once", async () => {
    const orgA = fx.orgA.organizationId;
    let sf30Fails = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/search")) return json({ totalRecords: 3, opportunitiesData: url.searchParams.get("solnum") === SOLNUM ? notices() : [] });
        const name = url.pathname.split("/").at(-2) ?? "file";
        if (name === "sf30" && sf30Fails) return new Response("", { status: 503 });
        return new Response(`Contents of ${name}`, { status: 200, headers: { "content-type": "text/plain", "content-disposition": `attachment; filename="${FILE_NAMES[name] ?? name}"` } });
      }),
    );
    const actor = { userId: fx.orgA.userId, email: "a@test" };
    const first = await checkOpportunityNotices({ organizationId: orgA, opportunityId: fx.orgA.opportunityId, actor });
    expect(first).toMatchObject({ ok: true, filed: 2, amendments: 1, notified: true, retrying: 1 });
    expect(await checkOpportunityNotices({ organizationId: orgA, opportunityId: fx.orgA.opportunityId, actor })).toEqual({
      ok: false,
      error: "SAM.gov was just checked for this opportunity; try again in a few minutes.",
    });
    const msgs = () => db.select({ to: notifications.recipientUserId, body: notifications.body }).from(notifications).where(and(eq(notifications.organizationId, orgA), eq(notifications.recipientUserId, pm)));
    expect((await msgs())[0]!.body).toContain("Not downloaded:");

    // The next day the file is there: it is filed and reported; the amendment isn't announced again.
    sf30Fails = false;
    await db.update(opportunities).set({ samWatchAttemptedAt: null }).where(eq(opportunities.id, fx.orgA.opportunityId));
    const second = await checkOpportunityNotices({ organizationId: orgA, opportunityId: fx.orgA.opportunityId });
    expect(second).toMatchObject({ ok: true, filed: 1, amendments: 0, notified: true, dueMovedTo: null });
    const all = await msgs();
    expect(all).toHaveLength(2);
    expect(all.some((m) => m.body.includes("Filed on the opportunity and being read: SF30 Amendment 0001.pdf."))).toBe(true);
    const third = await checkOpportunityNotices({ organizationId: orgA, opportunityId: fx.orgA.opportunityId });
    expect(third).toMatchObject({ ok: true, filed: 0, notified: false });
    expect(await msgs()).toHaveLength(2);
  });

  it("the daily run picks up a new file; a closed pursuit is not watched", async () => {
    const orgA = fx.orgA.organizationId;
    await checkOpportunityNotices({ organizationId: orgA, opportunityId: fx.orgA.opportunityId });
    extraLinks = [link("qa")];
    // Due again (as if a day had passed); the other tenant is skipped for now (no plan, so no storage).
    await db.update(opportunities).set({ samWatchCheckedAt: null, samWatchAttemptedAt: null }).where(eq(opportunities.id, fx.orgA.opportunityId));
    await db.update(opportunities).set({ stage: "no_bid" }).where(eq(opportunities.id, fx.orgB.opportunityId));
    const summary = await dispatchAmendmentWatch();
    expect(summary.checked).toBeGreaterThanOrEqual(1);
    const filed = await filedOn(orgA, fx.orgA.opportunityId);
    const qa = filed.find((f) => f.fileName === "Questions and Answers.pdf");
    expect(qa).toMatchObject({ amendmentNumber: "0001" });
    expect(filed).toHaveLength(4);
    expect(await filedOn(fx.orgB.organizationId, fx.orgB.opportunityId)).toHaveLength(0);

    await db.update(opportunities).set({ stage: "won" }).where(eq(opportunities.id, fx.orgA.opportunityId));
    expect(await checkOpportunityNotices({ organizationId: orgA, opportunityId: fx.orgA.opportunityId })).toEqual({
      ok: false,
      error: "This pursuit is closed, so SAM.gov is no longer watched for it.",
    });
  });
});
