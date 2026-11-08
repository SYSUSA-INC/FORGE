/**
 * BL-SCOUT-AMEND — the amendment watch, server side.
 *
 * Every open opportunity with a SAM.gov notice is checked once a day (and
 * on demand from its page): FORGE asks SAM.gov for every notice of its
 * solicitation, downloads each attachment it has not filed yet, files it
 * on the opportunity as a solicitation document (an amendment's files
 * under the opportunity's first solicitation, so the amendment is read and
 * compared), moves the response date when a new amendment moves it, and
 * tells the opportunity's owner and everyone assigned to its proposals,
 * reviews and solicitations through the `solicitation_amended` rule (on by
 * default). The scout marks an opportunity due when it sees a new notice
 * of its solicitation, so the next check takes it first.
 *
 * Every query carries organizationId; callers own auth. The daily
 * dispatcher is a cron worker and reads across tenants by design, like
 * the Q&A check in this folder.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, isNotNull, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  memberships,
  notificationRules,
  opportunities,
  opportunityActivities,
  proposalReviewAssignments,
  proposalReviews,
  proposals,
  proposalSections,
  solicitationAssignments,
  solicitations,
} from "@/db/schema";
import {
  isWatched,
  noticeLabel,
  planWatch,
  storageFileName,
  UNWATCHED_STAGES,
  WATCH_LIMITS,
  watchMessage,
  type WatchNotice,
} from "@/lib/amendment-watch-logic";
import { amendmentNumberFromName } from "@/lib/amendment-name";
import { recordAudit } from "@/lib/audit-log";
import { enqueueJob } from "@/lib/jobs";
import { log } from "@/lib/log";
import { dispatchTriggerEvent } from "@/lib/notification-dispatcher";
import { downloadSamResource, fetchSamNotice, fetchSamNoticesForSolicitation } from "@/lib/samgov";
import { SAM_TIMEOUTS_MS, isKeyOrQuotaFailure, type SamErrorClass } from "@/lib/samgov-errors";
import { resolveSamCredential, type SamCredential } from "@/lib/samgov-key";
import { solicitationKey } from "@/lib/scout-logic";
import { getStorageProvider } from "@/lib/storage";
import { enforceStorageQuota, QuotaExceededError } from "@/lib/subscription-gates";

type Actor = { userId: string | null; email?: string | null };

export type WatchCheckResult =
  | {
      ok: true;
      /** Documents filed on the opportunity this check. */
      filed: number;
      /** Amendments (new notices after the opportunity's own) seen this check. */
      amendments: number;
      /** The team was told. */
      notified: boolean;
      /** The response date moved to this day (YYYY-MM-DD). */
      dueMovedTo: string | null;
      /** Why each attachment that wasn't filed was left. */
      skipped: string[];
      /** Of those, how many are tried again next check. */
      retrying: number;
    }
  | { ok: false; error: string; cls?: SamErrorClass };

const day = (d: Date) => d.toISOString().slice(0, 10);
/** A person's check waits this long after the last try (theirs or the daily run's). */
const MANUAL_GAP_MS = 5 * 60_000;

/** Check one opportunity's solicitation on SAM.gov and file what is new. */
export async function checkOpportunityNotices(input: {
  organizationId: string;
  opportunityId: string;
  /** A person's "Check SAM.gov now"; absent for the cron. */
  actor?: Actor;
  /** The cron passes its key; else the company's is resolved. */
  sam?: SamCredential;
  /** The cron's time budget (epoch ms): no download starts that could run past it. */
  downloadsUntil?: number;
}): Promise<WatchCheckResult> {
  const { organizationId, opportunityId } = input;
  const [opp] = await db
    .select({
      id: opportunities.id,
      title: opportunities.title,
      stage: opportunities.stage,
      agency: opportunities.agency,
      noticeId: opportunities.noticeId,
      solicitationNumber: opportunities.solicitationNumber,
      responseDueDate: opportunities.responseDueDate,
      ownerUserId: opportunities.ownerUserId,
      createdAt: opportunities.createdAt,
      seenLinks: opportunities.samWatchSeenLinks,
      noticeIds: opportunities.samWatchNoticeIds,
      attemptedAt: opportunities.samWatchAttemptedAt,
    })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!opp) return { ok: false, error: "Opportunity not found." };
  if (!isWatched(opp.stage)) return { ok: false, error: "This pursuit is closed, so SAM.gov is no longer watched for it." };
  const solKey = solicitationKey(opp.solicitationNumber);
  if (!solKey && !opp.noticeId) {
    return { ok: false, error: "This opportunity has no SAM.gov notice ID or solicitation number to watch. Add one on its overview." };
  }

  // A person's check: one at a time, and never beside the daily run's (both would file the same files).
  if (input.actor) {
    if (opp.attemptedAt && opp.attemptedAt.getTime() > Date.now() - MANUAL_GAP_MS) {
      return { ok: false, error: "SAM.gov was just checked for this opportunity; try again in a few minutes." };
    }
    await db.update(opportunities).set({ samWatchAttemptedAt: new Date() }).where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)));
  }

  let cred = input.sam;
  if (!cred) {
    const r = await resolveSamCredential(organizationId);
    if (!r.ok) return { ok: false, error: r.failure.error, cls: r.failure.cls };
    cred = r.cred;
  }

  // Every notice of the solicitation; with no usable number (or none found), the opportunity's own notice.
  let notices: WatchNotice[] = [];
  if (solKey) {
    const r = await fetchSamNoticesForSolicitation(cred, opp.solicitationNumber);
    if (!r.ok) return { ok: false, error: r.error, cls: r.cls };
    notices = r.notices
      .filter((o) => solicitationKey(o.solicitationNumber) === solKey)
      .map((o) => ({ noticeId: o.noticeId, title: o.title ?? "", type: o.type ?? "", postedDate: o.postedDate ?? "", responseDeadLine: o.responseDeadLine ?? null, resourceLinks: o.resourceLinks ?? [] }));
  }
  if (notices.length === 0 && opp.noticeId) {
    // Only the attachment links are needed: no description request.
    const r = await fetchSamNotice(cred, opp.noticeId, { withDescription: false });
    if (!r.ok) {
      if (r.noSuchNotice) await stamp(organizationId, opportunityId, {});
      return { ok: false, error: r.error, cls: r.cls };
    }
    notices = [{ noticeId: r.notice.noticeId, title: r.notice.title, type: "", postedDate: r.notice.postedDate, responseDeadLine: null, resourceLinks: r.notice.resourceLinks }];
  }

  const plan = planWatch(
    { noticeId: opp.noticeId, createdAt: opp.createdAt, responseDueDate: opp.responseDueDate, seenLinks: opp.seenLinks ?? [], noticeIds: opp.noticeIds ?? [] },
    notices,
  );

  // The opportunity's first solicitation is the one amendments are filed under.
  const [baseRow] = await db
    .select({ id: solicitations.id })
    .from(solicitations)
    .where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.opportunityId, opportunityId), isNull(solicitations.parentSolicitationId)))
    .orderBy(asc(solicitations.createdAt))
    .limit(1);
  let baseId: string | null = baseRow?.id ?? null;
  // One record per notice carries its notice ID, so the daily Q&A check reads each notice once.
  const carriers = new Set(
    (
      await db
        .select({ n: solicitations.noticeId })
        .from(solicitations)
        .where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.opportunityId, opportunityId), ne(solicitations.noticeId, "")))
    ).map((r) => r.n),
  );

  const seenNow: string[] = [];
  const skipped: string[] = [];
  let retrying = 0;
  let downloads = 0;
  let stop: "time" | "key" | "storage" | null = null;
  const filedIds: string[] = [];
  const told: { label: string; files: string[]; notFiled: string[] }[] = [];

  for (const p of plan.notices) {
    const files: string[] = [];
    const notFiled: string[] = [];
    for (const link of p.newLinks) {
      if (stop || downloads >= WATCH_LIMITS.maxDownloadsPerCheck) {
        retrying++;
        continue;
      }
      if (input.downloadsUntil !== undefined && Date.now() + SAM_TIMEOUTS_MS.attachment > input.downloadsUntil) {
        stop = "time";
        retrying++;
        continue;
      }
      downloads++;
      const dl = await downloadSamResource(cred, link, WATCH_LIMITS.maxDownloadBytes);
      if (!dl.ok) {
        skipped.push(dl.error);
        notFiled.push(dl.error);
        if (dl.permanent) seenNow.push(link);
        else retrying++;
        if (isKeyOrQuotaFailure(dl.cls)) stop = "key";
        continue;
      }
      try {
        await enforceStorageQuota(organizationId, dl.bytes.length);
      } catch (err) {
        if (!(err instanceof QuotaExceededError)) throw err;
        skipped.push(err.message);
        notFiled.push(`${dl.fileName}: the storage limit is reached`);
        retrying++;
        stop = "storage";
        continue;
      }
      const id = randomUUID();
      const storagePath = `org/${organizationId}/solicitation/${id}/${storageFileName(dl.fileName)}`;
      const contentType = dl.contentType || "application/octet-stream";
      await getStorageProvider().put({ key: storagePath, bytes: dl.bytes, contentType });
      const amendmentNumber = p.amendment ? p.amendmentNumber || amendmentNumberFromName(dl.fileName) : "";
      const qaCarrier = !carriers.has(p.notice.noticeId);
      try {
        await db.insert(solicitations).values({
          id,
          organizationId,
          title: dl.fileName.replace(/\.[a-z0-9]{1,5}$/i, "").slice(0, 300) || p.notice.title.slice(0, 300),
          agency: opp.agency,
          solicitationNumber: opp.solicitationNumber,
          noticeId: qaCarrier ? p.notice.noticeId : "",
          fileName: dl.fileName.slice(0, 300),
          fileSize: dl.bytes.length,
          contentType,
          storagePath,
          parseStatus: "uploaded",
          source: "samgov-watch",
          postedDate: p.notice.postedDate ? new Date(p.notice.postedDate) : null,
          opportunityId,
          parentSolicitationId: p.amendment ? baseId : null,
          amendmentNumber: amendmentNumber.slice(0, 64),
          uploadedByUserId: input.actor?.userId ?? null,
        });
      } catch (err) {
        await getStorageProvider().delete(storagePath).catch(() => undefined);
        throw err;
      }
      carriers.add(p.notice.noticeId);
      baseId ??= id;
      seenNow.push(link);
      filedIds.push(id);
      files.push(dl.fileName);
      await enqueueJob({ organizationId, kind: "solicitation_parse", resourceId: id, requestedByUserId: input.actor?.userId ?? null });
    }
    const changed = files.length > 0 || (p.amendment && p.newNotice);
    if (p.tell && changed) told.push({ label: noticeLabel(p, files), files, notFiled });
  }

  // Every notice read is remembered, so an amendment is announced (and moves the date) once; its
  // attachments still waiting are tried again by link, and only those filed later are reported.
  const keep = (xs: string[]) => [...new Set(xs)].slice(-WATCH_LIMITS.maxRemembered);
  await stamp(organizationId, opportunityId, {
    samWatchSeenLinks: keep([...(opp.seenLinks ?? []), ...seenNow]),
    samWatchNoticeIds: keep([...(opp.noticeIds ?? []), ...plan.notices.map((p) => p.notice.noticeId)]),
    ...(plan.due ? { responseDueDate: plan.due.to } : {}),
  });

  const amendments = plan.notices.filter((p) => p.amendment && p.newNotice).length;
  const dueMovedTo = plan.due ? day(plan.due.to) : null;
  let notified = false;
  if (filedIds.length > 0 || told.length > 0 || plan.due) {
    const msg = watchMessage({
      title: opp.title,
      solicitationNumber: opp.solicitationNumber,
      labels: told.map((t) => t.label),
      due: plan.due,
      filed: told.flatMap((t) => t.files),
      notFiled: told.flatMap((t) => t.notFiled),
    });
    // Files of notices posted before the opportunity was added are filed quietly: the team saw those.
    const quiet = [
      plan.due && told.length === 0 ? `Response date moved to ${dueMovedTo} by an amendment.` : "",
      filedIds.length > 0 ? `${filedIds.length} document${filedIds.length === 1 ? "" : "s"} filed from SAM.gov and being read.` : "",
    ].filter(Boolean);
    await db.insert(opportunityActivities).values({
      opportunityId,
      userId: input.actor?.userId ?? null,
      kind: "note",
      title: `SAM.gov: ${told.length > 0 ? msg.subject.replace(/ — .*$/, "") : plan.due ? "response date moved" : "documents filed"}`.slice(0, 200),
      body: told.length > 0 ? msg.body : quiet.join("\n"),
      metadata: { source: "sam_watch", solicitationIds: filedIds, noticeIds: plan.notices.filter((p) => p.newNotice).map((p) => p.notice.noticeId) },
    });
    await recordAudit({
      organizationId,
      actor: input.actor ?? { userId: null },
      action: "opportunity.sam_watch",
      resourceType: "opportunity",
      resourceId: opportunityId,
      metadata: { filed: filedIds.length, amendments, dueMovedTo, skipped: skipped.length, told: told.length > 0 },
    });
    if (told.length > 0) {
      try {
        notified = await tellTeam({ organizationId, opportunityId, ownerUserId: opp.ownerUserId, subject: msg.subject, body: msg.body, actorUserId: input.actor?.userId ?? undefined });
      } catch (err) {
        log.error("[amendment-watch]", "team notification failed", { organizationId, opportunityId, error: err });
      }
    }
  } else if (input.actor) {
    await recordAudit({ organizationId, actor: input.actor, action: "opportunity.sam_watch", resourceType: "opportunity", resourceId: opportunityId, metadata: { filed: 0, amendments: 0, skipped: skipped.length } });
  }

  return { ok: true, filed: filedIds.length, amendments, notified, dueMovedTo, skipped, retrying };
}

async function stamp(organizationId: string, opportunityId: string, set: Partial<typeof opportunities.$inferInsert>) {
  await db
    .update(opportunities)
    .set({ ...set, samWatchCheckedAt: new Date(), ...(set.responseDueDate ? { updatedAt: new Date() } : {}) })
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)));
}

/**
 * The opportunity's owner and everyone assigned to its proposals (manager,
 * capture lead, pricing lead, section authors), its reviews and its
 * solicitations, who are still active members of the organization.
 */
export async function amendmentRecipients(organizationId: string, opportunityId: string, ownerUserId: string | null): Promise<string[]> {
  const ids = new Set<string>(ownerUserId ? [ownerUserId] : []);
  const props = await db
    .select({ id: proposals.id, pm: proposals.proposalManagerUserId, cm: proposals.captureManagerUserId, pl: proposals.pricingLeadUserId })
    .from(proposals)
    .where(and(eq(proposals.organizationId, organizationId), eq(proposals.opportunityId, opportunityId)));
  for (const p of props) for (const u of [p.pm, p.cm, p.pl]) if (u) ids.add(u);
  const propIds = props.map((p) => p.id);
  if (propIds.length > 0) {
    const [authors, reviewers] = await Promise.all([
      db.select({ u: proposalSections.authorUserId }).from(proposalSections).where(and(inArray(proposalSections.proposalId, propIds), isNotNull(proposalSections.authorUserId))),
      db
        .select({ u: proposalReviewAssignments.userId })
        .from(proposalReviewAssignments)
        .innerJoin(proposalReviews, eq(proposalReviews.id, proposalReviewAssignments.reviewId))
        .where(inArray(proposalReviews.proposalId, propIds)),
    ]);
    for (const r of [...authors, ...reviewers]) if (r.u) ids.add(r.u);
  }
  const team = await db
    .select({ u: solicitationAssignments.userId })
    .from(solicitationAssignments)
    .innerJoin(solicitations, eq(solicitations.id, solicitationAssignments.solicitationId))
    .where(and(eq(solicitationAssignments.organizationId, organizationId), eq(solicitations.organizationId, organizationId), eq(solicitations.opportunityId, opportunityId)));
  for (const r of team) ids.add(r.u);
  if (ids.size === 0) return [];
  const active = await db
    .select({ u: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.status, "active"), inArray(memberships.userId, [...ids])));
  return [...new Set(active.map((m) => m.u))];
}

/**
 * The default rule, for a company created after migration 0146 seeded it:
 * added once, when the watch first has something to say, unless the
 * company already has a rule of this kind (its own, or the default
 * switched off).
 */
async function ensureDefaultRule(organizationId: string): Promise<void> {
  const [any] = await db
    .select({ id: notificationRules.id })
    .from(notificationRules)
    .where(and(eq(notificationRules.organizationId, organizationId), eq(notificationRules.triggerEventKind, "solicitation_amended")))
    .limit(1);
  if (any) return;
  await db.insert(notificationRules).values({
    organizationId,
    name: "Default: Solicitation amended",
    description:
      "When SAM.gov posts an amendment or a new document for an opportunity you are pursuing, FORGE files it on the opportunity and tells the owner and everyone assigned to its proposals and reviews.",
    triggerEventKind: "solicitation_amended",
    recipientStrategy: "mentioned_in_payload",
    channels: ["in_app", "email"],
    frequency: "immediate",
  });
}

async function tellTeam(input: { organizationId: string; opportunityId: string; ownerUserId: string | null; subject: string; body: string; actorUserId?: string }): Promise<boolean> {
  const recipients = await amendmentRecipients(input.organizationId, input.opportunityId, input.ownerUserId);
  if (recipients.length === 0) return false;
  await ensureDefaultRule(input.organizationId);
  const r = await dispatchTriggerEvent({
    organizationId: input.organizationId,
    kind: "solicitation_amended",
    payload: { opportunityId: input.opportunityId, mentionedUserIds: recipients },
    subject: input.subject,
    body: input.body,
    linkPath: `/opportunities/${input.opportunityId}`,
    actorUserId: input.actorUserId,
  });
  return r.deliveries > 0;
}

/**
 * The scout saw a new notice of these opportunities' solicitations: they
 * go to the front of the next check.
 */
export async function markWatchDue(organizationId: string, opportunityIds: string[]): Promise<void> {
  if (opportunityIds.length === 0) return;
  await db
    .update(opportunities)
    .set({ samWatchAttemptedAt: null, samWatchCheckedAt: null })
    .where(and(eq(opportunities.organizationId, organizationId), inArray(opportunities.id, opportunityIds)));
}

// ── the daily check ───────────────────────────────────────────────────

export type WatchCronSummary = {
  checked: number;
  filed: number;
  amendments: number;
  notified: number;
  errors: number;
  /** FORGE's shared key failed: companies on it wait for the next run. */
  stoppedByKey: boolean;
  /** Companies skipped for the run: their own key failed, or they have none. */
  blockedOrganizations: number;
  /** SAM.gov failed three checks in a row: the run stopped. */
  samOutage: boolean;
};

/** As the Q&A check: checks start in the first 200 s, no download starts that could end after 260 s. */
const WATCH_CRON = { checksMs: 200_000, downloadsMs: 260_000, window: 100, maxChecks: 150, outageStreak: 3 } as const;
const TRANSIENT = new Set<SamErrorClass | undefined>(["timeout", "network", "upstream", "bad_response"]);

function dueWhere(now: number, blocked: Set<string>) {
  const lastTry = sql`greatest(${opportunities.samWatchAttemptedAt}, ${opportunities.samWatchCheckedAt})`;
  return and(
    notInArray(opportunities.stage, UNWATCHED_STAGES),
    or(sql`${opportunities.noticeId} <> ''`, sql`length(regexp_replace(${opportunities.solicitationNumber}, '[^A-Za-z0-9]', '', 'g')) >= 8`),
    // Still open, or closed within the week (late amendments and award notices).
    or(isNull(opportunities.responseDueDate), gt(opportunities.responseDueDate, new Date(now - 7 * 86_400_000))),
    sql`(${lastTry} is null or ${lastTry} < ${new Date(now - 20 * 3_600_000).toISOString()}::timestamptz)`,
    blocked.size > 0 ? notInArray(opportunities.organizationId, [...blocked]) : undefined,
  );
}

/**
 * Daily: check the opportunities not tried in the last 20 hours, one
 * company at a time in turn, each on its company's SAM.gov key (its own,
 * else FORGE's shared one). Cross-tenant by design (cron worker); each
 * check is scoped. A company whose key fails is skipped for the rest of
 * the run, as are companies on the shared key once it fails; three SAM.gov
 * failures in a row end the run.
 */
export async function dispatchAmendmentWatch(): Promise<WatchCronSummary> {
  const started = Date.now();
  const summary: WatchCronSummary = { checked: 0, filed: 0, amendments: 0, notified: 0, errors: 0, stoppedByKey: false, blockedOrganizations: 0, samOutage: false };
  const blocked = new Set<string>();
  const creds = new Map<string, SamCredential | null>();
  let streak = 0;
  let stopped = false;
  while (!stopped) {
    const rows = await db
      .select({ id: opportunities.id, organizationId: opportunities.organizationId })
      .from(opportunities)
      .where(dueWhere(started, blocked))
      .orderBy(
        sql`row_number() over (partition by ${opportunities.organizationId} order by greatest(${opportunities.samWatchAttemptedAt}, ${opportunities.samWatchCheckedAt}) asc nulls first, ${opportunities.id})`,
        opportunities.id,
      )
      .limit(WATCH_CRON.window);
    if (rows.length === 0) break;
    let progressed = false;
    for (const row of rows) {
      if (summary.checked >= WATCH_CRON.maxChecks || Date.now() >= started + WATCH_CRON.checksMs) {
        stopped = true;
        break;
      }
      const { organizationId } = row;
      if (blocked.has(organizationId)) continue;
      if (!creds.has(organizationId)) {
        const r = await resolveSamCredential(organizationId);
        creds.set(organizationId, r.ok ? r.cred : null);
      }
      const sam = creds.get(organizationId) ?? null;
      if (!sam || (sam.source === "platform" && summary.stoppedByKey) || (sam.source === "company" && sam.storedStatus === "invalid")) {
        summary.blockedOrganizations++;
        blocked.add(organizationId);
        continue;
      }
      progressed = true;
      let res: WatchCheckResult;
      try {
        // Stamped first, so a check that fails (or never returns) still rotates the row back.
        await db.update(opportunities).set({ samWatchAttemptedAt: new Date() }).where(and(eq(opportunities.id, row.id), eq(opportunities.organizationId, organizationId)));
        summary.checked++;
        res = await checkOpportunityNotices({ organizationId, opportunityId: row.id, sam, downloadsUntil: started + WATCH_CRON.downloadsMs });
      } catch (err) {
        summary.errors++;
        log.error("[amendment-watch]", "check failed", { opportunityId: row.id, error: err });
        continue;
      }
      if (!res.ok) {
        summary.errors++;
        log.warn("[amendment-watch]", "check declined", { opportunityId: row.id, cls: res.cls ?? null, source: sam.source, error: res.error });
        if (isKeyOrQuotaFailure(res.cls)) {
          if (sam.source === "platform") summary.stoppedByKey = true;
          else summary.blockedOrganizations++;
          blocked.add(organizationId);
          streak = 0;
          continue;
        }
        streak = TRANSIENT.has(res.cls) ? streak + 1 : 0;
        if (streak >= WATCH_CRON.outageStreak) {
          summary.samOutage = true;
          stopped = true;
          break;
        }
        continue;
      }
      streak = 0;
      summary.filed += res.filed;
      summary.amendments += res.amendments;
      if (res.notified) summary.notified++;
    }
    if (!progressed) break;
  }
  return summary;
}

/** For the opportunity page: when SAM.gov was last checked for it. */
export async function watchStatus(organizationId: string, opportunityId: string): Promise<{ watched: boolean; checkedAt: Date | null } | null> {
  const [row] = await db
    .select({ stage: opportunities.stage, noticeId: opportunities.noticeId, solicitationNumber: opportunities.solicitationNumber, checkedAt: opportunities.samWatchCheckedAt })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!row) return null;
  return { watched: isWatched(row.stage) && (!!row.noticeId || !!solicitationKey(row.solicitationNumber)), checkedAt: row.checkedAt };
}

