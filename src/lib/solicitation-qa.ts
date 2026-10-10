/**
 * BL-FB-SOL-QA — contracting-officer Q&A, server side.
 *
 * Polls a solicitation's SAM.gov notice for new attachments, reads the
 * ones that are Q&A documents (and Q&A written into the notice
 * description), stores each answer once, matches it to the requirements
 * it refines and flags the compliance rows on this tenant's proposals
 * as amended by Q&A. The team can also paste Q&A received by email.
 * Every query carries organizationId; callers own auth. The daily
 * dispatcher is a cron worker and reads across tenants by design, like
 * the key-date reminders in this folder.
 */
import { activeRequirements, type ReviewedRequirement } from "@/lib/requirement-review";
import "server-only";

import { and, asc, desc, eq, gt, inArray, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceItems,
  notifications,
  organizationSamgovKeys,
  proposals,
  solicitationAssignments,
  solicitationQa,
  solicitations,
  users,
  type SolicitationQaSource,
  type SolicitationRequirement,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";
import { jaccard } from "@/lib/requirements-text";
import { downloadSamResource, fetchSamNotice } from "@/lib/samgov";
import { SAM_TIMEOUTS_MS, isKeyOrQuotaFailure, type SamErrorClass } from "@/lib/samgov-errors";
import { platformSamCredential, resolveSamCredential, type SamCredential } from "@/lib/samgov-key";
import { extractTextFromAny } from "@/lib/solicitation-extract";
import {
  QA_LIMITS,
  looksLikeQaDocument,
  matchQaToRequirements,
  normalizeRef,
  parseQaPairs,
  qaDedupeKey,
  type QaPair,
  type QaRequirementMatch,
} from "@/lib/solicitation-qa-logic";

type Actor = { userId: string | null; email?: string | null };

export type SolicitationQaView = {
  id: string;
  source: SolicitationQaSource;
  sourceRef: string;
  ordinal: number;
  question: string;
  answer: string;
  affectedRefs: string[];
  postedAt: string | null;
  createdAt: string;
  addedByName: string | null;
};

/**
 * The solicitation's answers, newest document first, in document order.
 * Pairs of one document share a posted date and a source, so the sort
 * is by those and then the ordinal — never by each row's own insert
 * time, which would put the last pair of a document first.
 */
export async function listSolicitationQa(input: {
  organizationId: string;
  solicitationId: string;
}): Promise<SolicitationQaView[]> {
  const rows = await db
    .select({
      id: solicitationQa.id,
      source: solicitationQa.source,
      sourceRef: solicitationQa.sourceRef,
      ordinal: solicitationQa.ordinal,
      question: solicitationQa.question,
      answer: solicitationQa.answer,
      affectedRefs: solicitationQa.affectedRefs,
      postedAt: solicitationQa.postedAt,
      createdAt: solicitationQa.createdAt,
      addedByName: users.name,
    })
    .from(solicitationQa)
    .leftJoin(users, eq(users.id, solicitationQa.addedByUserId))
    .where(
      and(
        eq(solicitationQa.organizationId, input.organizationId),
        eq(solicitationQa.solicitationId, input.solicitationId),
      ),
    )
    .orderBy(desc(solicitationQa.postedAt), asc(solicitationQa.sourceRef), asc(solicitationQa.ordinal));
  return rows.map((r) => ({
    ...r,
    affectedRefs: r.affectedRefs ?? [],
    postedAt: r.postedAt ? r.postedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

type OwnedSolicitation = {
  id: string;
  title: string;
  noticeId: string;
  opportunityId: string | null;
  extractedRequirements: SolicitationRequirement[];
  qaSeenLinks: string[];
};

async function solicitationForOrg(organizationId: string, solicitationId: string): Promise<OwnedSolicitation | null> {
  const [row] = await db
    .select({
      id: solicitations.id,
      title: solicitations.title,
      noticeId: solicitations.noticeId,
      opportunityId: solicitations.opportunityId,
      extractedRequirements: solicitations.extractedRequirements,
      qaSeenLinks: solicitations.qaSeenLinks,
    })
    .from(solicitations)
    .where(and(eq(solicitations.id, solicitationId), eq(solicitations.organizationId, organizationId)))
    .limit(1);
  if (!row) return null;
  return { ...row, extractedRequirements: row.extractedRequirements ?? [], qaSeenLinks: row.qaSeenLinks ?? [] };
}

export type QaIngestResult =
  | { ok: true; added: number; duplicates: number; flagged: number }
  | { ok: false; error: string };

/** Q&A the team received outside SAM.gov (email, a portal), pasted as text. */
export async function addManualQa(input: {
  organizationId: string;
  solicitationId: string;
  text: string;
  actor: Actor;
}): Promise<QaIngestResult> {
  const { organizationId } = input;
  const sol = await solicitationForOrg(organizationId, input.solicitationId);
  if (!sol) return { ok: false, error: "Solicitation not found." };
  const pairs = parseQaPairs(input.text);
  if (pairs.length === 0) {
    return {
      ok: false,
      error: 'No question/answer pairs found. Use lines like "Q: …" and "A: …" (or Question / Answer, Government Response).',
    };
  }
  const res = await storePairs({
    organizationId,
    sol,
    pairs,
    source: "manual",
    sourceRef: "pasted",
    postedAt: new Date(),
    addedByUserId: input.actor.userId,
  });
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "solicitation.qa.add",
    resourceType: "solicitation",
    resourceId: input.solicitationId,
    metadata: { pairs: pairs.length, ...res },
  });
  return { ok: true, ...res };
}

export type QaPollResult =
  | {
      ok: true;
      /** Attachment links not seen before that were read this time. */
      newDocuments: number;
      /** Of those (plus the description), how many carried Q&A. */
      qaDocuments: number;
      added: number;
      duplicates: number;
      flagged: number;
      /** Why each attachment that could not be read was skipped. */
      skipped: string[];
      /** Of those, how many will be tried again next time (the rest never can be). */
      retrying: number;
    }
  | { ok: false; error: string; cls?: SamErrorClass };

/** Read the notice's new attachments and description for Q&A. */
export async function pollSolicitationQa(input: {
  organizationId: string;
  solicitationId: string;
  /** Present for a user's "Check now"; absent for the cron. */
  actor?: Actor;
  /** The key to poll with (the cron passes one); else the company's is resolved. */
  sam?: SamCredential;
  /** The cron's time budget (epoch ms): no download starts that could run past it. */
  downloadsUntil?: number;
}): Promise<QaPollResult> {
  const { organizationId } = input;
  const sol = await solicitationForOrg(organizationId, input.solicitationId);
  if (!sol) return { ok: false, error: "Solicitation not found." };
  if (!sol.noticeId) {
    return { ok: false, error: "This solicitation has no SAM.gov notice ID, so there is nothing to poll. Paste the Q&A instead." };
  }
  let cred = input.sam;
  if (!cred) {
    const sam = await resolveSamCredential(organizationId);
    if (!sam.ok) return { ok: false, error: sam.failure.error, cls: sam.failure.cls };
    cred = sam.cred;
  }
  const notice = await fetchSamNotice(cred, sol.noticeId);
  if (!notice.ok) {
    // SAM.gov answered that it has no such notice: that is a check, so the
    // row goes to the back of the daily queue instead of blocking its head.
    if (notice.noSuchNotice) {
      await db
        .update(solicitations)
        .set({ qaCheckedAt: new Date() })
        .where(and(eq(solicitations.id, input.solicitationId), eq(solicitations.organizationId, organizationId)));
      if (input.actor) {
        await recordAudit({
          organizationId,
          actor: input.actor,
          action: "solicitation.qa.poll",
          resourceType: "solicitation",
          resourceId: input.solicitationId,
          metadata: { noticeId: sol.noticeId, noSuchNotice: true },
        });
      }
    }
    return { ok: false, error: notice.error, cls: notice.cls };
  }

  const seen = new Set(sol.qaSeenLinks);
  const toRead = notice.notice.resourceLinks.filter((l) => !seen.has(l)).slice(0, QA_LIMITS.maxDownloadsPerPoll);
  const posted = new Date(notice.notice.postedDate);
  const postedAt = Number.isNaN(posted.getTime()) ? new Date() : posted;
  let added = 0;
  let duplicates = 0;
  let flagged = 0;
  let qaDocuments = 0;
  const skipped: string[] = [];
  let retrying = 0;
  const nowSeen: string[] = [];

  for (const [i, link] of toRead.entries()) {
    // BL-STAB-7d — the rest wait (unseen) for the next check rather than run past the cron's limit.
    if (input.downloadsUntil !== undefined && Date.now() + SAM_TIMEOUTS_MS.attachment > input.downloadsUntil) {
      for (let j = i; j < toRead.length; j++) skipped.push("Not downloaded: the daily check ran out of time; it is read on the next check.");
      retrying += toRead.length - i;
      break;
    }
    const dl = await downloadSamResource(cred, link, QA_LIMITS.maxDownloadBytes);
    if (!dl.ok) {
      skipped.push(dl.error);
      // A link that can never be read is marked seen, so it stops taking one
      // of the poll's download slots ahead of a real Q&A attachment.
      if (dl.permanent) nowSeen.push(link);
      else retrying++;
      // The same key would fail every remaining download: those stay unseen
      // and are tried next time.
      if (isKeyOrQuotaFailure(dl.cls)) {
        for (let j = i + 1; j < toRead.length; j++) skipped.push(dl.error);
        retrying += toRead.length - i - 1;
        break;
      }
      continue;
    }
    nowSeen.push(link);
    let text = "";
    try {
      text = (await extractTextFromAny(dl.bytes, dl.contentType, dl.fileName)).text;
    } catch (err) {
      log.warn("[solicitation-qa]", "attachment extraction failed", { organizationId, fileName: dl.fileName, error: err });
      continue;
    }
    if (!looksLikeQaDocument(dl.fileName, text)) continue;
    const pairs = parseQaPairs(text);
    if (pairs.length === 0) continue;
    qaDocuments++;
    const r = await storePairs({
      organizationId,
      sol,
      pairs,
      source: "attachment",
      sourceRef: dl.fileName,
      postedAt,
      addedByUserId: input.actor?.userId ?? null,
    });
    added += r.added;
    duplicates += r.duplicates;
    flagged += r.flagged;
  }

  // Q&A written straight into the notice description.
  const descPairs = parseQaPairs(notice.notice.description);
  if (descPairs.length >= 2) {
    qaDocuments++;
    const r = await storePairs({
      organizationId,
      sol,
      pairs: descPairs,
      source: "description",
      sourceRef: "notice description",
      postedAt,
      addedByUserId: input.actor?.userId ?? null,
    });
    added += r.added;
    duplicates += r.duplicates;
    flagged += r.flagged;
  }

  await db
    .update(solicitations)
    .set({ qaCheckedAt: new Date(), qaSeenLinks: [...seen, ...nowSeen] })
    .where(and(eq(solicitations.id, input.solicitationId), eq(solicitations.organizationId, organizationId)));

  if (input.actor || added > 0) {
    await recordAudit({
      organizationId,
      actor: input.actor ?? { userId: null },
      action: "solicitation.qa.poll",
      resourceType: "solicitation",
      resourceId: input.solicitationId,
      metadata: { noticeId: sol.noticeId, newDocuments: toRead.length - skipped.length, qaDocuments, added, duplicates, flagged, skipped: skipped.length },
    });
  }
  return { ok: true, newDocuments: toRead.length - skipped.length, qaDocuments, added, duplicates, flagged, skipped, retrying };
}

async function storePairs(input: {
  organizationId: string;
  sol: OwnedSolicitation;
  pairs: QaPair[];
  source: SolicitationQaSource;
  sourceRef: string;
  postedAt: Date;
  addedByUserId: string | null;
}): Promise<{ added: number; duplicates: number; flagged: number }> {
  const { organizationId } = input;
  // BL-AIX Phase 2c — answers are matched to the clauses the team kept.
  const requirements = activeRequirements(input.sol.extractedRequirements as ReviewedRequirement[]).map((r) => ({ ref: r.ref ?? "", text: r.text }));
  const matches = matchQaToRequirements(input.pairs, requirements);
  let added = 0;
  let duplicates = 0;
  let flagged = 0;
  for (const p of input.pairs) {
    const m = matches.get(p.ordinal) ?? [];
    const affectedRefs = [...new Set(m.map((x) => normalizeRef(x.ref)).filter(Boolean))];
    const [row] = await db
      .insert(solicitationQa)
      .values({
        organizationId,
        solicitationId: input.sol.id,
        source: input.source,
        sourceRef: input.sourceRef.slice(0, 256),
        ordinal: p.ordinal,
        question: p.question,
        answer: p.answer,
        affectedRefs,
        dedupeKey: qaDedupeKey(p.question, p.answer),
        postedAt: input.postedAt,
        addedByUserId: input.addedByUserId,
      })
      .onConflictDoNothing({ target: [solicitationQa.solicitationId, solicitationQa.dedupeKey] })
      .returning({ id: solicitationQa.id });
    if (!row) {
      duplicates++;
      continue;
    }
    added++;
    if (m.length > 0) {
      flagged += await flagComplianceItems({ organizationId, opportunityId: input.sol.opportunityId, qaId: row.id, matches: m });
    }
  }
  return { added, duplicates, flagged };
}

/**
 * Flag the compliance rows this tenant's proposals carry for the
 * requirements an answer refines: by requirement number, else by the
 * text match the seed uses. SELECT the ids, then UPDATE by id.
 */
async function flagComplianceItems(input: {
  organizationId: string;
  opportunityId: string | null;
  qaId: string;
  matches: QaRequirementMatch[];
}): Promise<number> {
  if (!input.opportunityId) return 0;
  const props = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(and(eq(proposals.organizationId, input.organizationId), eq(proposals.opportunityId, input.opportunityId)));
  if (props.length === 0) return 0;
  const items = await db
    .select({ id: complianceItems.id, number: complianceItems.number, requirementText: complianceItems.requirementText })
    .from(complianceItems)
    .where(inArray(complianceItems.proposalId, props.map((p) => p.id)));
  const refs = new Set(input.matches.map((m) => normalizeRef(m.ref)).filter(Boolean));
  const hit = items
    .filter(
      (it) =>
        (it.number !== "" && refs.has(normalizeRef(it.number))) ||
        input.matches.some((m) => jaccard(it.requirementText, m.text) >= 0.6),
    )
    .map((it) => it.id);
  if (hit.length === 0) return 0;
  await db
    .update(complianceItems)
    .set({ amendedByQaId: input.qaId, updatedAt: new Date() })
    .where(inArray(complianceItems.id, hit));
  return hit.length;
}

export type QaCronSummary = {
  solicitationsPolled: number;
  added: number;
  flagged: number;
  errors: number;
  /** Neither FORGE's shared SAM.gov key nor any company key is set: nothing was polled. */
  skippedNoKey: boolean;
  /** SAM.gov rejected FORGE's shared key (or its limit was reached): companies on it wait for the next run. */
  stoppedByKey: boolean;
  /** Companies skipped for the rest of the run: SAM.gov rejected their own key, or they have no usable key. */
  blockedOrganizations: number;
  /** SAM.gov failed three polls in a row (timeouts, network, its own errors): the run stopped. */
  samOutage: boolean;
  /** Due notices this run didn't reach (time budget, the per-run cap, an outage); they go first next run. */
  deferred: number;
};

/**
 * BL-STAB-7d — the cron route allows 300 s: polls start only in the first
 * 200 s (a notice and its description take up to 30 s), and no download
 * starts that could end after 260 s, leaving room to store what was read.
 */
const QA_CRON = { pollsMs: 200_000, downloadsMs: 260_000, window: 100, maxPasses: 4, outageStreak: 3 } as const;
const TRANSIENT = new Set<SamErrorClass | undefined>(["timeout", "network", "upstream", "bad_response"]);

/**
 * Due notices, one per company in turn (each company's least recently
 * tried first), so one company's backlog or dead key can't fill the run.
 * Companies whose own key SAM.gov rejected are left out until an admin
 * replaces it; `companyKeysOnly` once the shared key is unusable.
 */
function dueQaWhere(f: { blocked: Set<string>; companyKeysOnly: boolean; now: number }) {
  const lastTry = sql`greatest(${solicitations.qaAttemptedAt}, ${solicitations.qaCheckedAt})`;
  const triedBefore = new Date(f.now - 20 * 3_600_000).toISOString();
  const dueAfter = new Date(f.now - 7 * 86_400_000);
  return and(
    ne(solicitations.noticeId, ""),
    or(isNull(solicitations.responseDueDate), gt(solicitations.responseDueDate, dueAfter)),
    sql`(${lastTry} is null or ${lastTry} < ${triedBefore}::timestamptz)`,
    sql`not exists (select 1 from organization_samgov_key k where k.organization_id = ${solicitations.organizationId} and k.status = 'invalid')`,
    f.companyKeysOnly ? sql`exists (select 1 from organization_samgov_key k where k.organization_id = ${solicitations.organizationId})` : undefined,
    f.blocked.size > 0 ? notInArray(solicitations.organizationId, [...f.blocked]) : undefined,
  );
}

/**
 * Daily: poll the notices of live solicitations not tried in the last 20
 * hours and tell the assigned team when answers landed. Cross-tenant by
 * design (cron worker); each poll is scoped and uses its company's key
 * (its own, else FORGE's shared one). BL-STAB-7d — every poll stamps
 * qa_attempted_at, so a notice that keeps failing rotates to the back; a
 * company whose key fails is skipped for the rest of the run, as are
 * companies on the shared key once it fails; key failures don't use up
 * the per-run cap; three SAM.gov failures in a row end the run.
 */
export async function dispatchSolicitationQaPolls(): Promise<QaCronSummary> {
  const started = Date.now();
  const summary: QaCronSummary = {
    solicitationsPolled: 0,
    added: 0,
    flagged: 0,
    errors: 0,
    skippedNoKey: false,
    stoppedByKey: false,
    blockedOrganizations: 0,
    samOutage: false,
    deferred: 0,
  };
  const filter = { blocked: new Set<string>(), companyKeysOnly: platformSamCredential() === null, now: started };
  if (filter.companyKeysOnly && (await db.select({ id: organizationSamgovKeys.organizationId }).from(organizationSamgovKeys).limit(1)).length === 0) {
    return { ...summary, skippedNoKey: true };
  }
  const creds = new Map<string, SamCredential | null>();
  let counted = 0;
  let streak = 0;
  let stopped = false;

  for (let pass = 0; pass < QA_CRON.maxPasses && !stopped; pass++) {
    const rows = await db
      .select({ id: solicitations.id, organizationId: solicitations.organizationId, title: solicitations.title })
      .from(solicitations)
      .where(dueQaWhere(filter))
      .orderBy(
        sql`row_number() over (partition by ${solicitations.organizationId} order by greatest(${solicitations.qaAttemptedAt}, ${solicitations.qaCheckedAt}) asc nulls first, ${solicitations.id})`,
        sql`greatest(${solicitations.qaAttemptedAt}, ${solicitations.qaCheckedAt}) asc nulls first`,
        solicitations.id,
      )
      .limit(QA_CRON.window);
    if (rows.length === 0) break;
    for (const row of rows) {
      if (counted >= QA_LIMITS.maxSolicitationsPerCron || Date.now() >= started + QA_CRON.pollsMs) {
        stopped = true;
        break;
      }
      const organizationId = row.organizationId;
      if (filter.blocked.has(organizationId)) continue;
      if (!creds.has(organizationId)) {
        const r = await resolveSamCredential(organizationId);
        creds.set(organizationId, r.ok ? r.cred : null);
      }
      const sam = creds.get(organizationId) ?? null;
      if (!sam || (sam.source === "platform" && summary.stoppedByKey)) {
        if (!sam) summary.blockedOrganizations++;
        filter.blocked.add(organizationId);
        continue;
      }
      // Stamped first, so a poll that fails (or never returns) still rotates the row back.
      await db
        .update(solicitations)
        .set({ qaAttemptedAt: new Date() })
        .where(and(eq(solicitations.id, row.id), eq(solicitations.organizationId, organizationId)));
      summary.solicitationsPolled++;
      let res: QaPollResult;
      try {
        res = await pollSolicitationQa({ organizationId, solicitationId: row.id, sam, downloadsUntil: started + QA_CRON.downloadsMs });
      } catch (err) {
        summary.errors++;
        counted++;
        log.error("[solicitation-qa]", "poll failed", { solicitationId: row.id, error: err });
        continue;
      }
      if (!res.ok) {
        summary.errors++;
        log.warn("[solicitation-qa]", "poll declined", { solicitationId: row.id, cls: res.cls ?? null, source: sam.source, error: res.error });
        if (isKeyOrQuotaFailure(res.cls)) {
          // The same key fails every later poll: that company (or every company on the shared key) waits.
          if (sam.source === "platform") {
            summary.stoppedByKey = true;
            filter.companyKeysOnly = true;
          } else summary.blockedOrganizations++;
          filter.blocked.add(organizationId);
          streak = 0;
          continue;
        }
        counted++;
        streak = TRANSIENT.has(res.cls) ? streak + 1 : 0;
        if (streak >= QA_CRON.outageStreak) {
          summary.samOutage = true;
          stopped = true;
          break;
        }
        continue;
      }
      counted++;
      streak = 0;
      summary.added += res.added;
      summary.flagged += res.flagged;
      if (res.added > 0) {
        await notifyTeam({ organizationId, solicitationId: row.id, title: row.title, added: res.added, flagged: res.flagged });
      }
    }
  }

  if (stopped) {
    const [left] = await db.select({ n: sql<number>`count(*)::int` }).from(solicitations).where(dueQaWhere(filter));
    summary.deferred = left?.n ?? 0;
  }
  return summary;
}

async function notifyTeam(input: { organizationId: string; solicitationId: string; title: string; added: number; flagged: number }) {
  const team = await db
    .select({ userId: solicitationAssignments.userId })
    .from(solicitationAssignments)
    .where(and(eq(solicitationAssignments.organizationId, input.organizationId), eq(solicitationAssignments.solicitationId, input.solicitationId)));
  const subject = `Q&A posted — ${input.title.slice(0, 80)}`;
  const body = `${input.added} new answer${input.added === 1 ? "" : "s"} from the contracting officer${
    input.flagged > 0 ? `; ${input.flagged} compliance row${input.flagged === 1 ? "" : "s"} flagged as amended by Q&A` : ""
  }.`;
  for (const userId of new Set(team.map((t) => t.userId))) {
    const dup = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, input.organizationId),
          eq(notifications.recipientUserId, userId),
          eq(notifications.subject, subject),
          gt(notifications.createdAt, new Date(Date.now() - 20 * 3_600_000)),
        ),
      )
      .limit(1);
    if (dup.length > 0) continue;
    await db.insert(notifications).values({
      organizationId: input.organizationId,
      recipientUserId: userId,
      kind: "solicitation_role_assigned",
      subject,
      body,
      linkPath: `/solicitations/${input.solicitationId}`,
    });
  }
}
