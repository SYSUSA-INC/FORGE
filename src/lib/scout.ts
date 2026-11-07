/**
 * BL-AIP-7b — the nightly scout.
 *
 * Until now the platform only looked at SAM.gov when a person opened the
 * import page and clicked Search. The scout runs for every tenant each
 * night (and on demand):
 *
 *   find    — asks SAM.gov once for the open notices posted in the last
 *             few days under the tenant's NAICS codes (the Scout page's
 *             first, then the organization's, 10 at most). Every open
 *             notice in the codes is a find and the keywords raise its
 *             score (BL-SCOUT-REACH); with no codes, the keywords are the
 *             search and a find mentions one (BL-STAB-10d). Clears
 *             waiting finds that no longer fit; and turns watchlisted
 *             awards whose period of performance ends within six months
 *             into recompete candidates.
 *   ground  — drops notices the tenant already imported or already saw,
 *             then scores each find against the tenant's own history:
 *             NAICS match, set-aside eligibility, the recompete radar,
 *             the record at that customer, keyword hits, the due date
 *             (`scoutFit`, pure). The score and its signals are stored.
 *   triage  — asks the model for pursue / watch / skip with a rationale,
 *             grounded in the score, the recompete match, the customer
 *             record and what this team imported / dismissed from earlier
 *             finds. Gated per tenant by `aiAutoDraft` and the monthly
 *             request quota, leaving a fifth of the month's requests for
 *             the rest of FORGE; skipped in stub mode; 25 per run.
 *   learn   — a person imports (creates the opportunity) or dismisses
 *             each candidate; the decision grades the triage
 *             (`gradeTriage`) and the newest decisions are shown to the
 *             next night's prompt. The track is on the page.
 *
 * Every read and write carries organizationId. `runScoutCron` is the
 * cross-org worker (same exemption as the other cron libs); everything
 * else is per tenant. Server-only; callers own auth.
 */
import "server-only";

import { and, count, desc, eq, inArray, isNotNull, isNull, ne, notInArray, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import {
  bdWatchlistItems,
  knowledgeEntries,
  opportunities,
  organizations,
  scoutCandidates,
  scoutProfiles,
  scoutRuns,
  type NewScoutCandidate,
  type ScoutCandidate,
  type ScoutCandidateSource,
} from "@/db/schema";
import { completeStructuredForTenant, getAIProviderStatus, zodToToolSchema } from "@/lib/ai";
import { markWatchDue } from "@/lib/amendment-watch";
import { batchingAvailable, type BatchRequest } from "@/lib/ai-batch";
import { queueAiBatch, type BatchHandler } from "@/lib/ai-batch-queue";
import {
  buildScoutTriagePrompt,
  SCOUT_TRIAGE_PROMPT_VERSION,
  scoutTriageSchema,
  type ScoutTriageSnapshot,
} from "@/lib/ai-prompts";
import { recordAudit } from "@/lib/audit-log";
import { clampConfidence, cleanList } from "@/lib/brief-logic";
import { getCustomerIntelligence } from "@/lib/customer-intelligence";
import { companyModelAsCapabilities } from "@/lib/company-model";
import { getApprovedCompanyModel } from "@/lib/company-model-read";
import { log } from "@/lib/log";
import type { RecompeteFlag } from "@/lib/recompete-match";
import { flagSamResults } from "@/lib/recompete-radar";
import { noticeDescriptionUrl, type SamOpportunity } from "@/lib/samgov";
import { asDescription, noticeStore } from "@/lib/sam-notice-store";
import { descriptionsFor } from "@/lib/samgov-descriptions";
import { isKeyOrQuotaFailure } from "@/lib/samgov-errors";
import { resolveSamCredential, type SamCredential } from "@/lib/samgov-key";
import {
  OPEN_NOTICE_TYPES,
  escapeHtml,
  keywordLabel,
  mentionsExcluded,
  noticeAgency,
  readableText,
  withEarlierHit,
  type DescriptionState,
  type KeywordQuery,
  type NoticeMatch,
} from "@/lib/samgov-match";
import { DESCRIPTION_READS, findSamOpportunities } from "@/lib/samgov-search";
import { scoutSourceFields } from "@/lib/opportunity-source";
import {
  awardExpiresWithin,
  DEFAULT_SCOUT_PROFILE,
  gradeTriage,
  isScoutRecommendation,
  learningExamples,
  naicsCodeOf,
  passingMentionOnly,
  recompeteFromSignals,
  SCOUT_DESCRIPTION_CHARS,
  scoutCodes,
  scoutFit,
  scoutKeywordQuery,
  scoutSearchFunnel,
  scoutTriageAllowance,
  solicitationKey,
  staleReason,
  summarizeScoutTrack,
  type ScoutCandidateView,
  type ScoutDecision,
  type ScoutProfileView,
  type ScoutRunSummary,
  type ScoutRunView,
  type ScoutTrack,
} from "@/lib/scout-logic";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  getCurrentTier,
  getCurrentUsage,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";

export { DEFAULT_SCOUT_PROFILE } from "@/lib/scout-logic";
export type { ScoutCandidateView, ScoutProfileView, ScoutRunSummary, ScoutRunView } from "@/lib/scout-logic";

const DAY_MS = 24 * 60 * 60_000;
/** Model calls per tenant per run (BL-SCOUT-REACH: every open notice in the codes is a find). */
const MAX_TRIAGE_PER_RUN = 25;
const MAX_CUSTOMER_LOOKUPS = 8;
/** Watchlisted awards ending within this window become recompete candidates. */
const WATCHLIST_HORIZON_DAYS = 180;
/** Rows per NAICS code: everything SAM.gov sends (BL-SCOUT-REACH; it was 100, and the rest went unseen). */
const SAM_LIMIT = 1000;
/** NAICS codes searched per run (one SAM.gov request each, BL-STAB-10). */
const MAX_SEARCH_CODES = 10;
/** A tenant is scouted again once this much time has passed. */
const RERUN_AFTER_HOURS = 20;

type Actor = { userId: string | null; email?: string | null };

function str(v: unknown, max = 500): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function unique(list: string[]): string[] {
  return Array.from(new Set(list.map((s) => s.trim()).filter(Boolean)));
}

function cleanTerms(list: unknown, max: number, maxLen: number): string[] {
  if (!Array.isArray(list)) return [];
  return unique(list.filter((s): s is string => typeof s === "string").map((s) => s.slice(0, maxLen))).slice(
    0,
    max,
  );
}

function cleanNaics(list: unknown, max: number): string[] {
  if (!Array.isArray(list)) return [];
  return unique(
    list.filter((s): s is string => typeof s === "string").map((s) => s.replace(/\D/g, "")),
  )
    .filter((s) => s.length >= 2 && s.length <= 6)
    .slice(0, max);
}

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

// ── profile ───────────────────────────────────────────────────────────

export async function getScoutProfile(input: { organizationId: string }): Promise<ScoutProfileView> {
  const { organizationId } = input;
  const [row] = await db
    .select()
    .from(scoutProfiles)
    .where(eq(scoutProfiles.organizationId, organizationId))
    .limit(1);
  if (!row) return DEFAULT_SCOUT_PROFILE;
  return {
    enabled: row.enabled,
    keywords: row.keywords,
    extraNaics: row.extraNaics,
    postedDaysBack: row.postedDaysBack,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
  };
}

export async function saveScoutProfile(input: {
  organizationId: string;
  patch: Partial<Omit<ScoutProfileView, "lastRunAt">>;
  actor: Actor;
}): Promise<ScoutProfileView> {
  const { organizationId } = input;
  const current = await getScoutProfile({ organizationId });
  const next = {
    enabled: input.patch.enabled ?? current.enabled,
    keywords: input.patch.keywords ? cleanTerms(input.patch.keywords, 10, 60) : current.keywords,
    extraNaics: input.patch.extraNaics ? cleanNaics(input.patch.extraNaics, 10) : current.extraNaics,
    postedDaysBack: clampInt(input.patch.postedDaysBack ?? current.postedDaysBack, 1, 14),
  };
  const [existing] = await db
    .select({ organizationId: scoutProfiles.organizationId })
    .from(scoutProfiles)
    .where(eq(scoutProfiles.organizationId, organizationId))
    .limit(1);
  if (existing) {
    await db
      .update(scoutProfiles)
      .set({ ...next, updatedAt: new Date(), updatedByUserId: input.actor.userId })
      .where(eq(scoutProfiles.organizationId, organizationId));
  } else {
    await db
      .insert(scoutProfiles)
      .values({ organizationId, ...next, updatedByUserId: input.actor.userId });
  }
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "scout.profile.update",
    resourceType: "scout_profile",
    resourceId: organizationId,
    metadata: next,
  });
  return getScoutProfile({ organizationId });
}

async function touchProfileLastRun(organizationId: string, now: Date): Promise<void> {
  const [existing] = await db
    .select({ organizationId: scoutProfiles.organizationId })
    .from(scoutProfiles)
    .where(eq(scoutProfiles.organizationId, organizationId))
    .limit(1);
  if (existing) {
    await db
      .update(scoutProfiles)
      .set({ lastRunAt: now })
      .where(eq(scoutProfiles.organizationId, organizationId));
  } else {
    await db.insert(scoutProfiles).values({ organizationId, lastRunAt: now });
  }
}

// ── finding ───────────────────────────────────────────────────────────

type CandidateDraft = Omit<
  NewScoutCandidate,
  "id" | "organizationId" | "runId" | "fitScore" | "signals" | "createdAt" | "updatedAt"
> & { source: ScoutCandidateSource; noticeId: string };

function placeOf(pop: SamOpportunity["placeOfPerformance"]): string {
  if (!pop) return "";
  return [pop.city?.name, pop.state?.name, pop.country?.name].filter(Boolean).join(", ");
}

function fromSam(o: SamOpportunity, source: ScoutCandidateSource, matchedKeyword: string | null): CandidateDraft {
  return {
    source,
    matchedKeyword: (matchedKeyword ?? "").slice(0, 200),
    noticeId: o.noticeId,
    title: str(o.title, 500) || "Untitled",
    agency: str(noticeAgency(o), 400),
    office: str(o.office, 200),
    solicitationNumber: str(o.solicitationNumber, 200),
    noticeType: str(o.type, 200),
    setAside: str(o.typeOfSetAsideDescription, 200),
    naicsCode: str(o.naicsCode, 20),
    pscCode: str(o.classificationCode, 20),
    incumbent: "",
    postedAt: parseDate(o.postedDate),
    responseDueAt: parseDate(o.responseDeadLine),
    placeOfPerformance: placeOf(o.placeOfPerformance).slice(0, 300),
    description: readableText(o.description).slice(0, SCOUT_DESCRIPTION_CHARS),
    uiLink: str(o.uiLink, 2_000),
  };
}

function fromWatchlistedAward(
  w: { externalId: string; label: string; metadata: Record<string, unknown> },
  daysToEnd: number,
  endDate: Date,
): CandidateDraft {
  const m = w.metadata;
  const recipient = str(m.recipientName, 200);
  const awardId = str(m.awardId, 200);
  const agency = [str(m.awardingAgency, 200), str(m.awardingSubAgency, 200)].filter(Boolean).join(" · ");
  const amount = typeof m.amount === "number" && Number.isFinite(m.amount) ? m.amount : null;
  const when =
    daysToEnd >= 0 ? `ends in ${daysToEnd} day${daysToEnd === 1 ? "" : "s"}` : `ended ${-daysToEnd} days ago`;
  return {
    source: "watchlist_award",
    noticeId: `award:${w.externalId}`,
    title: `Recompete: ${recipient || w.label || awardId || w.externalId}`.slice(0, 500),
    agency,
    office: "",
    solicitationNumber: awardId,
    noticeType: "Expiring award",
    setAside: str(m.setAsideCode, 100),
    naicsCode: str(m.naicsCode, 20),
    pscCode: "",
    incumbent: recipient,
    postedAt: null,
    responseDueAt: endDate,
    placeOfPerformance: "",
    description: [
      `Award ${awardId || w.externalId}${recipient ? ` held by ${recipient}` : ""}${agency ? ` at ${agency}` : ""} ${when} (${endDate.toISOString().slice(0, 10)}).`,
      amount !== null ? `Obligated amount $${Math.round(amount).toLocaleString("en-US")}.` : "",
      "It is on your watchlist; a recompete solicitation is likely before the period of performance ends.",
    ]
      .filter(Boolean)
      .join(" "),
    uiLink: `https://www.usaspending.gov/award/${encodeURIComponent(w.externalId)}`,
  };
}

type CustomerCounts = { pursuits: number; won: number; lost: number; winRate: number | null };

// ── the run ───────────────────────────────────────────────────────────

export async function runScoutForOrganization(input: {
  organizationId: string;
  trigger: "cron" | "manual";
  requestedByUserId?: string | null;
  now?: Date;
  maxTriage?: number;
  /** BL-STAB-7d — the cron's breaker: set once FORGE's shared key fails; later companies on it aren't searched. */
  sharedKey?: { failed: string | null };
  /**
   * BL-SCOUT-ONEPAGE — a one-off search from the Scout page's search bar:
   * these criteria instead of the saved ones. Its finds join the list; it
   * clears and re-scores no waiting find, and the nightly criteria stay.
   */
  criteria?: { keywords: string[]; extraNaics: string[]; postedDaysBack: number };
}): Promise<ScoutRunSummary> {
  const { organizationId } = input;
  const now = input.now ?? new Date();
  const maxTriage = input.maxTriage ?? MAX_TRIAGE_PER_RUN;
  const summary: ScoutRunSummary = {
    runId: null,
    searches: 0,
    found: 0,
    created: 0,
    triaged: 0,
    skippedGated: 0,
    errors: 0,
    stubbed: false,
    note: "",
  };
  const notes: string[] = [];

  const [org] = await db
    .select({
      name: organizations.name,
      primaryNaics: organizations.primaryNaics,
      naicsList: organizations.naicsList,
      socio: organizations.socioEconomic,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) return { ...summary, note: "Organization not found." };

  const saved = await getScoutProfile({ organizationId });
  const oneOff = !!input.criteria;
  const profile = input.criteria
    ? {
        ...saved,
        keywords: input.criteria.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 10),
        extraNaics: input.criteria.extraNaics.map((k) => k.trim()).filter(Boolean).slice(0, MAX_SEARCH_CODES),
        postedDaysBack: clampInt(input.criteria.postedDaysBack, 1, 14),
      }
    : saved;
  // BL-STAB-10d — the Scout page's codes first, then the organization's.
  const codes = scoutCodes({ extra: profile.extraNaics, primary: org.primaryNaics, list: org.naicsList }, MAX_SEARCH_CODES);
  const query = scoutKeywordQuery(profile.keywords);
  // BL-SCOUT-REACH (owner, 2026-11-05) — with codes, every open notice in them is a
  // find and the keywords only raise its score; with none, the keywords are the search.
  // An excluded word ("-staffing") still keeps a notice out either way.
  const rank = codes.searched.length > 0 && query !== null;
  const searchQuery = rank ? null : query;
  const excludedOnly: KeywordQuery | null =
    rank && query && query.excluded.length > 0 ? { terms: [], anyOf: [], excluded: query.excluded, labels: query.labels, notes: [] } : null;

  const [run] = await db
    .insert(scoutRuns)
    .values({ organizationId, trigger: input.trigger, requestedByUserId: input.requestedByUserId ?? null })
    .returning({ id: scoutRuns.id });
  summary.runId = run?.id ?? null;

  // 1. SAM.gov — one search over the codes, keeping notices that mention a keyword.
  const found = new Map<string, { sam: SamOpportunity; source: ScoutCandidateSource; keyword: string | null }>();
  // Notice ids the search can't rule out this run (found, or not settled yet): never cleared.
  const keepIds = new Set<string>();
  let searched = false;
  let descriptionCred: SamCredential | null = null;
  // Live description reads for this tenant this run, shared by the keyword check and the finds' texts.
  let liveBudget = 0;
  const pastDue = (o: { responseDeadLine?: string | null }) => {
    const due = parseDate(o.responseDeadLine);
    return !!due && due.getTime() < now.getTime();
  };
  if (codes.unreadable.length > 0) {
    notes.push(`Not read as a NAICS code: ${codes.unreadable.map((e) => `"${e.slice(0, 60)}"`).join(", ")}; enter the 6-digit code under Settings → Classification or on the Scout page.`);
  }
  const sam = await resolveSamCredential(organizationId);
  if (!sam.ok) {
    notes.push(`SAM.gov was not searched: ${sam.failure.error}`);
  } else if (sam.cred.source === "platform" && input.sharedKey?.failed) {
    notes.push(`SAM.gov was not searched: ${input.sharedKey.failed}`);
  } else if (codes.searched.length === 0 && !query) {
    notes.push("No NAICS codes or keywords to search; add them under Settings → Classification or on the Scout page.");
  } else {
    // BL-STAB-10 — SAM.gov can't filter by keyword: it is asked for the codes'
    // open notices (or, with no codes, notices with one of the first five
    // keywords in the title), and FORGE keeps those that mention a keyword —
    // in the title, agency or description (FORGE's nightly copy of SAM.gov
    // first; what the copy can't settle is read live within the budget).
    descriptionCred = sam.cred;
    liveBudget = DESCRIPTION_READS[sam.cred.source];
    if (codes.all.length > codes.searched.length) {
      notes.push(`Not searched (${MAX_SEARCH_CODES} codes at most, one SAM.gov request each): ${codes.all.slice(MAX_SEARCH_CODES).join(", ")}.`);
    }
    if (query?.notes.length) notes.push(...query.notes);
    try {
      const r = await findSamOpportunities(sam.cred, {
        naicsCodes: codes.searched,
        query: searchQuery ?? undefined,
        noticeTypes: OPEN_NOTICE_TYPES,
        postedDaysBack: profile.postedDaysBack,
        limit: SAM_LIMIT,
        readBudget: 0,
      });
      if (!r.ok) {
        summary.errors += 1;
        notes.push(`SAM.gov search for ${codes.searched.length ? `NAICS ${codes.searched.join(", ")}` : "your keywords"} failed: ${r.error}`);
        // BL-STAB-7a/7d — the same key fails the description reads, and (shared) every later company on it.
        if (isKeyOrQuotaFailure(r.cls)) {
          descriptionCred = null;
          liveBudget = 0;
          if (sam.cred.source === "platform" && input.sharedKey) input.sharedKey.failed ??= r.error;
        }
      } else {
        searched = true;
        summary.searches = codes.searched.length || Math.min(5, query?.anyOf[0]?.length ?? 1);
        notes.push(
          `${codes.searched.length ? `NAICS searched: ${codes.searched.join(", ")}` : "All NAICS codes"}${
            rank && query ? `; every open notice in these codes is a find, and mentioning ${keywordLabel(query)} raises its score` : searchQuery ? `; kept notices that mention ${keywordLabel(searchQuery)}` : ""
          }.`,
        );
        notes.push(scoutSearchFunnel(r.counts, !!searchQuery, SAM_LIMIT));
        if (r.warning) notes.push(r.warning);
        let overdue = 0;
        const keep = (o: SamOpportunity, m: NoticeMatch | null) => {
          if (!o.noticeId || found.has(o.noticeId)) return;
          // Past its response date: the clearing rule would only take it out again.
          if (pastDue(o)) return void overdue++;
          keepIds.add(o.noticeId);
          found.set(o.noticeId, { sam: o, source: searchQuery ? "keyword" : "org_naics", keyword: m?.status === "match" ? (m.matched[0]?.term ?? null) : null });
        };
        for (const o of r.notices) keep(o, o.match);
        // What FORGE's copy can't settle (cut off, only a link, run together, newer than the
        // copy): read SAM.gov live, newest first, for notices this organization hasn't seen.
        if (searchQuery && r.unchecked.length > 0) {
          for (const o of r.unchecked) if (!pastDue(o)) keepIds.add(o.noticeId);
          const ids = r.unchecked.map((o) => o.noticeId);
          const [seenU, importedU] = await Promise.all([
            db.select({ noticeId: scoutCandidates.noticeId }).from(scoutCandidates).where(and(eq(scoutCandidates.organizationId, organizationId), inArray(scoutCandidates.noticeId, ids))),
            db.select({ noticeId: opportunities.noticeId }).from(opportunities).where(and(eq(opportunities.organizationId, organizationId), inArray(opportunities.noticeId, ids))),
          ]);
          const knownU = new Set([...seenU, ...importedU].map((x) => x.noticeId));
          const fresh = r.unchecked.filter((o) => !knownU.has(o.noticeId) && !pastDue(o));
          const ask = fresh.slice(0, liveBudget);
          let unsettled = fresh.length - ask.length;
          if (ask.length > 0) {
            liveBudget -= ask.length;
            const read = await descriptionsFor(sam.cred, ask.map((o) => o.noticeId), ask.length, { liveFirst: true });
            for (const o of ask) {
              const d = read.get(o.noticeId);
              const m = d && !("unread" in d) ? withEarlierHit({ title: o.title, agency: noticeAgency(o) }, searchQuery, d, o.earlierMatch) : null;
              if (m?.status === "match") keep({ ...o, description: d && "text" in d && !d.partial ? d.text : o.description }, m);
              else if (!m || m.status === "unchecked") unsettled++;
            }
          }
          if (unsettled > 0) {
            notes.push(`${unsettled} notice${unsettled === 1 ? "" : "s"} couldn't be checked for the keywords (description too long for FORGE's copy, only a link, or newer than it) within this run's ${DESCRIPTION_READS[sam.cred.source]} SAM.gov reads; the next run tries again while ${unsettled === 1 ? "it is" : "they are"} in the look-back window.`);
          }
        }
        if (overdue > 0) notes.push(`${overdue} notice${overdue === 1 ? "" : "s"} already past the response date left out.`);
      }
    } catch (err) {
      summary.errors += 1;
      log.warn("[scout]", "sam search failed", { organizationId, error: err });
    }
  }

  // Waiting finds the search kept again remember the keyword they fit (rows from before
  // matched_keyword get it), so a later clear can't lose them once an earlier notice leaves.
  const byKeyword = new Map<string, string[]>();
  for (const [noticeId, f] of found) if (f.keyword) byKeyword.set(f.keyword, [...(byKeyword.get(f.keyword) ?? []), noticeId]);
  for (const [keyword, ids] of byKeyword) {
    await db
      .update(scoutCandidates)
      .set({ matchedKeyword: keyword.slice(0, 200) })
      .where(and(eq(scoutCandidates.organizationId, organizationId), eq(scoutCandidates.status, "new"), eq(scoutCandidates.matchedKeyword, ""), inArray(scoutCandidates.noticeId, ids)))
      .catch((err) => log.warn("[scout]", "matched keyword backfill failed", { organizationId, error: err }));
  }

  // BL-STAB-10d — waiting finds that no longer fit (past due, outside the codes, or not
  // mentioning a keyword) are deleted with their triage; a later run finds one again only
  // if it still fits and is in the look-back window. A code that couldn't be read never
  // clears anything; what this run's search kept or couldn't settle is never cleared.
  if (oneOff) notes.push("A one-off search from the Scout page: the nightly criteria are unchanged, and no waiting find was cleared.");
  else try {
    // Ranked keywords clear nothing: a find in the codes stays whatever it mentions.
    const cleared = await clearStaleFinds(organizationId, { codes: codes.unreadable.length ? [] : codes.all, query: searchQuery, now }, searched ? keepIds : new Set());
    if (cleared > 0) notes.push(`Removed ${cleared} waiting find${cleared === 1 ? "" : "s"} that no longer fit${cleared === 1 ? "s" : ""} your keywords and codes, or ${cleared === 1 ? "is" : "are"} past due.`);
  } catch (err) {
    log.warn("[scout]", "clearing stale finds failed", { organizationId, error: err });
  }

  // BL-SCOUT-QUALITY — one card per solicitation: waiting finds that are
  // notices of the same solicitation (each amendment is its own notice)
  // fold into the latest.
  try {
    const folded = await foldWaitingFinds(organizationId);
    if (folded > 0) notes.push(`Folded ${folded} waiting find${folded === 1 ? "" : "s"} into the latest notice of the same solicitation.`);
  } catch (err) {
    log.warn("[scout]", "folding waiting finds failed", { organizationId, error: err });
  }

  // 2. Watchlisted awards ending soon.
  const awardDrafts: CandidateDraft[] = [];
  try {
    const watch = await db
      .select({
        externalId: bdWatchlistItems.externalId,
        label: bdWatchlistItems.label,
        metadata: bdWatchlistItems.metadata,
      })
      .from(bdWatchlistItems)
      .where(and(eq(bdWatchlistItems.organizationId, organizationId), eq(bdWatchlistItems.kind, "award")))
      .limit(200);
    for (const w of watch) {
      const endRaw = str((w.metadata as Record<string, unknown>).endDate, 40);
      const days = awardExpiresWithin(endRaw, now, WATCHLIST_HORIZON_DAYS);
      if (days === null) continue;
      awardDrafts.push(fromWatchlistedAward({ ...w, metadata: w.metadata as Record<string, unknown> }, days, new Date(endRaw)));
    }
  } catch (err) {
    summary.errors += 1;
    log.warn("[scout]", "watchlist scan failed", { organizationId, error: err });
  }
  summary.found = found.size + awardDrafts.length;

  // Customer records, read once per agency per run.
  const customers = new Map<string, CustomerCounts | null>();
  async function customerFor(agency: string, naicsCode: string): Promise<CustomerCounts | null> {
    const key = agency.trim().toLowerCase();
    if (!key) return null;
    if (customers.has(key)) return customers.get(key) ?? null;
    if (customers.size >= MAX_CUSTOMER_LOOKUPS) return null;
    let counts: CustomerCounts | null = null;
    try {
      const ci = await getCustomerIntelligence({ organizationId, agency, naicsCode });
      if (ci) {
        counts = {
          pursuits: ci.history.pursuits,
          won: ci.history.won,
          lost: ci.history.lost,
          winRate: ci.history.winRate,
        };
      }
    } catch (err) {
      log.warn("[scout]", "customer intel failed", { organizationId, error: err });
    }
    customers.set(key, counts);
    return counts;
  }

  const ctxBase = {
    primaryNaics: naicsCodeOf(org.primaryNaics),
    naicsList: codes.all,
    socio: org.socio,
    keywords: profile.keywords,
    now,
  };

  // BL-SCOUT-QUALITY — every waiting find is scored again each run, so the
  // deadline, the keyword weighting and the customer record are current; a
  // find that is now only a passing mention of a keyword leaves the list.
  if (!oneOff) try {
    const r = await rescoreWaitingFinds(organizationId, ctxBase, customerFor);
    if (r.dropped > 0) notes.push(`Removed ${r.dropped} waiting find${r.dropped === 1 ? "" : "s"} that only mention${r.dropped === 1 ? "s" : ""} a keyword in passing.`);
  } catch (err) {
    log.warn("[scout]", "re-scoring waiting finds failed", { organizationId, error: err });
  }

  // 3. Drop what the tenant already has or already saw.
  const allIds = [...found.keys(), ...awardDrafts.map((d) => d.noticeId)];
  const triageOnly = allIds.length === 0;
  const [seen, imported] = triageOnly
    ? [[], []]
    : await Promise.all([
        db
          .select({ noticeId: scoutCandidates.noticeId })
          .from(scoutCandidates)
          .where(and(eq(scoutCandidates.organizationId, organizationId), inArray(scoutCandidates.noticeId, allIds))),
        db
          .select({ noticeId: opportunities.noticeId })
          .from(opportunities)
          .where(and(eq(opportunities.organizationId, organizationId), inArray(opportunities.noticeId, allIds))),
      ]);
  const known = new Set([...seen, ...imported].map((r) => r.noticeId));
  // BL-SCOUT-QUALITY — one card per solicitation, across runs: a new notice
  // of a solicitation already in the pipeline raises no find (the amendment
  // watch files it there); one already dismissed or added stays decided; one
  // still waiting is replaced by its newer notice.
  const sol = await bySolicitation(organizationId, [...found.values()].filter((f) => !known.has(f.sam.noticeId)));
  if (sol.inPipeline > 0) notes.push(`${sol.inPipeline} notice${sol.inPipeline === 1 ? " is" : "s are"} a new notice of a solicitation already in your pipeline; no find raised, and the amendment watch files ${sol.inPipeline === 1 ? "it" : "them"} on the opportunit${sol.pipelineIds.length === 1 ? "y" : "ies"} at its next check (09:45 UTC daily).`);
  await markWatchDue(organizationId, sol.pipelineIds).catch((err) => log.warn("[scout]", "marking the amendment watch failed", { organizationId, error: err }));
  const freshSam = sol.fresh;
  const replaceFor = sol.replaceFor;
  const freshAwards = awardDrafts.filter((d) => !known.has(d.noticeId));

  // BL-STAB-10 — the searches read no descriptions; read the new finds'
  // so scoring and triage have the text: from FORGE's copy of SAM.gov's
  // descriptions (BL-STAB-10b; free, even with no working key), then live,
  // newest first, within the key's per-search budget.
  if (freshSam.length > 0) {
    const wanted = freshSam
      .filter((f) => !f.sam.description)
      .sort((a, b) => (Date.parse(b.sam.postedDate) || 0) - (Date.parse(a.sam.postedDate) || 0))
      .map((f) => f.sam.noticeId);
    const read = await descriptionsFor(descriptionCred, wanted, liveBudget);
    for (const f of freshSam) {
      const d = read.get(f.sam.noticeId);
      // Cut text stays marked as cut ("..."), so clearing never reads it as whole.
      if (d && "text" in d) f.sam = { ...f.sam, description: d.partial && !/\.\.\.\s*$/.test(d.text) ? `${d.text} ...` : d.text };
    }
  }

  // 4. Grounding — recompete flags for the SAM rows, customer record per agency.
  let flags: Record<string, RecompeteFlag> = {};
  try {
    flags = await flagSamResults(
      organizationId,
      freshSam.map((f) => f.sam),
    );
  } catch (err) {
    log.warn("[scout]", "recompete flagging failed", { organizationId, error: err });
  }
  // 5. Score and store.
  type Staged = { draft: CandidateDraft; fit: { score: number; signals: string[] }; flag: RecompeteFlag | null; customer: CustomerCounts | null };
  const staged: Staged[] = [];
  let passing = 0;
  let excluded = 0;
  for (const f of freshSam) {
    const draft = fromSam(f.sam, f.source, f.keyword);
    if (excludedOnly && mentionsExcluded({ title: draft.title ?? "", agency: draft.agency ?? "" }, excludedOnly, { text: escapeHtml(draft.description ?? "") })) {
      excluded += 1;
      continue;
    }
    const flag = flags[f.sam.noticeId] ?? null;
    const customer = await customerFor(draft.agency ?? "", draft.naicsCode ?? "");
    const recompete = flag ? { outcome: flag.outcome, confidence: flag.confidence, hasLessons: !!flag.lessons } : null;
    const fit = scoutFit(
      {
        source: draft.source,
        title: draft.title ?? "",
        description: draft.description ?? "",
        agency: draft.agency ?? "",
        naicsCode: draft.naicsCode ?? "",
        setAside: draft.setAside ?? "",
        responseDueAt: draft.responseDueAt ?? null,
      },
      { ...ctxBase, keyword: f.keyword, recompete, customer },
    );
    // BL-SCOUT-QUALITY — a keyword mentioned once in passing, with nothing else tying the notice to you, is not a find.
    if (passingMentionOnly(fit, { recompete, customer }, draft.source)) {
      passing += 1;
      continue;
    }
    // BL-SCOUT-REACH — the keyword the text gave, shown on the card and kept by later runs.
    if (!draft.matchedKeyword && fit.keyword) draft.matchedKeyword = fit.keyword.term.slice(0, 200);
    staged.push({ draft, fit, flag, customer });
  }
  for (const draft of freshAwards) {
    const customer = await customerFor(draft.agency ?? "", draft.naicsCode ?? "");
    const fit = scoutFit(
      {
        source: draft.source,
        title: draft.title ?? "",
        description: draft.description ?? "",
        agency: draft.agency ?? "",
        naicsCode: draft.naicsCode ?? "",
        setAside: draft.setAside ?? "",
        responseDueAt: draft.responseDueAt ?? null,
      },
      { ...ctxBase, keyword: null, recompete: null, customer },
    );
    staged.push({ draft, fit, flag: null, customer });
  }
  if (excluded > 0) notes.push(`Left out ${excluded} notice${excluded === 1 ? "" : "s"} that mention${excluded === 1 ? "s" : ""} a word you excluded.`);
  if (passing > 0) notes.push(`Left out ${passing} notice${passing === 1 ? "" : "s"} that only mention${passing === 1 ? "s" : ""} a keyword in passing.`);

  // A newer notice of a solicitation still waiting replaces that find in place.
  const replacements = staged.filter((x) => replaceFor.has(x.draft.noticeId));
  for (const x of replacements) {
    await db
      .update(scoutCandidates)
      .set({ ...x.draft, fitScore: x.fit.score, signals: x.fit.signals, updatedAt: now })
      .where(and(eq(scoutCandidates.organizationId, organizationId), eq(scoutCandidates.id, replaceFor.get(x.draft.noticeId)!), eq(scoutCandidates.status, "new")));
  }
  const toInsert = staged.filter((x) => !replaceFor.has(x.draft.noticeId));
  const inserted =
    toInsert.length === 0
      ? []
      : await db
          .insert(scoutCandidates)
          .values(
            toInsert.map((x) => ({
              ...x.draft,
              organizationId,
              runId: run?.id ?? null,
              fitScore: x.fit.score,
              signals: x.fit.signals,
            })),
          )
          .onConflictDoNothing()
          .returning();
  summary.created = inserted.length;

  // 6. Triage the best-fitting new finds.
  if (getAIProviderStatus().active.name === "stub") {
    summary.stubbed = true;
    notes.push("AI provider is in stub mode; candidates were scored but not triaged.");
  } else {
    const byNotice = new Map(staged.map((s) => [s.draft.noticeId, s]));
    // BL-SCOUT-QUALITY — the review takes the best of the new finds and of
    // the waiting finds it has not reviewed yet, so no find stays unjudged
    // just because it arrived on a busy run.
    const backlog = await db
      .select()
      .from(scoutCandidates)
      .where(
        and(
          eq(scoutCandidates.organizationId, organizationId),
          eq(scoutCandidates.status, "new"),
          isNull(scoutCandidates.recommendation),
          isNull(scoutCandidates.triageBatchId),
          inserted.length ? notInArray(scoutCandidates.id, inserted.map((r) => r.id)) : sql`true`,
        ),
      )
      .orderBy(desc(scoutCandidates.fitScore))
      .limit(maxTriage);
    const ranked = [...inserted, ...backlog].sort((a, b) => b.fitScore - a.fitScore);
    // BL-SCOUT-REACH — never the whole month's AI allowance: a fifth stays for the rest of FORGE.
    const allowed = await triageAllowance(organizationId, Math.min(maxTriage, ranked.length));
    const queue = ranked.slice(0, allowed);
    if (allowed < Math.min(maxTriage, ranked.length)) {
      notes.push(`AI review held to ${allowed} find${allowed === 1 ? "" : "s"} this run, so a fifth of this month's AI requests stays for the rest of FORGE; the others wait for next month or a larger allowance.`);
    }
    const history = await learningHistory(organizationId);
    const track = await getScoutTrack({ organizationId });
    const capabilities = await capabilitiesOf(organizationId);
    if (capabilities.length === 0) notes.push("No approved company model and no capability statement in the Knowledge base: the AI can't judge scope, so it recommends Watch at most.");
    else if (capabilities[0]?.title.startsWith("Company model v")) notes.push(`Triage grounded in the approved ${capabilities[0].title.toLowerCase()}.`);
    const snapshotOf = (row: ScoutCandidate) => {
      const s = byNotice.get(row.noticeId);
      return buildSnapshot(org.name, org.primaryNaics, org.naicsList, org.socio, profile, capabilities, row, s?.flag ?? null, s?.customer ?? null, history, track, now);
    };
    // BL-AIX Phase 1g-2 — the nightly run sends its triage as one batch
    // (half price, read by the jobs cron); a manual run, another provider
    // or a failed submit triages live as before.
    const live =
      input.trigger === "cron" && batchingAvailable() && queue.length > 0
        ? await queueTriageBatch({ organizationId, runId: run?.id ?? null, queue, snapshotOf, summary, notes })
        : queue;
    for (const row of live) {
      try {
        await ensureFeature(organizationId, "aiAutoDraft");
        await enforceQuota(organizationId, "aiRequestsPerMonth");
      } catch (err) {
        if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
          summary.skippedGated += queue.length - summary.triaged;
          notes.push(`Triage stopped: ${err.message}`);
          break;
        }
        throw err;
      }
      try {
        const prompt = buildScoutTriagePrompt(snapshotOf(row));
        const res = await completeStructuredForTenant({
          organizationId,
          feature: "opportunity_triage",
          promptVersion: SCOUT_TRIAGE_PROMPT_VERSION,
          schema: scoutTriageSchema,
          toolName: "record_scout_triage",
          toolDescription: "Record the scout's triage of this candidate.",
          system: prompt.system,
          messages: prompt.messages,
          maxTokens: 600,
          temperature: 0.2,
          cacheSystem: true,
        });
        const data = res.data;
        if (!data || !isScoutRecommendation(data.recommendation)) {
          summary.errors += 1;
          await refundQuota(organizationId, "aiRequestsPerMonth").catch(() => undefined);
          log.warn("[scout]", "triage returned no data", { organizationId, candidateId: row.id, error: res.parseError });
          continue;
        }
        await db
          .update(scoutCandidates)
          .set({
            recommendation: data.recommendation,
            confidence: clampConfidence(data.confidence),
            rationale: data.rationale.trim().slice(0, 2_000),
            nextActions: cleanList(data.nextActions, 3),
            promptVersion: SCOUT_TRIAGE_PROMPT_VERSION,
            model: res.model,
            stubbed: res.stubbed,
            updatedAt: new Date(),
          })
          .where(and(eq(scoutCandidates.id, row.id), eq(scoutCandidates.organizationId, organizationId)));
        summary.triaged += 1;
      } catch (err) {
        summary.errors += 1;
        await refundQuota(organizationId, "aiRequestsPerMonth").catch(() => undefined);
        log.error("[scout]", "triage failed", { organizationId, candidateId: row.id, error: err });
      }
    }
  }

  await finishRun(organizationId, run?.id ?? null, summary, notes, now);
  return summary;
}

/**
 * BL-SCOUT-REACH — how many finds the AI may review this run, within the
 * plan's monthly requests less the fifth kept for the rest of FORGE. A
 * lookup that fails allows the run's number; `enforceQuota` still stops it.
 */
async function triageAllowance(organizationId: string, wanted: number): Promise<number> {
  try {
    const tier = await getCurrentTier(organizationId);
    const limit = tier?.effectiveQuotas.aiRequestsPerMonth ?? 0;
    if (!tier || limit === 0) return wanted;
    return scoutTriageAllowance(limit, await getCurrentUsage(organizationId, "aiRequestsPerMonth"), wanted);
  } catch (err) {
    log.warn("[scout]", "AI allowance lookup failed", { organizationId, error: err });
    return wanted;
  }
}

const TRIAGE_TOOL = { name: "record_scout_triage", description: "Record the scout's triage of this candidate." };

/**
 * BL-AIX Phase 1g-2 — gate each candidate like a live call (feature flag,
 * request quota), then submit the lot as one batch and mark the
 * candidates as waiting on it. Returns the candidates still to triage
 * live: none when the batch went out, all of them when the submit failed
 * (their quota is refunded first, and the live loop gates them again).
 */
async function queueTriageBatch(input: {
  organizationId: string;
  runId: string | null;
  queue: ScoutCandidate[];
  snapshotOf: (row: ScoutCandidate) => ScoutTriageSnapshot;
  summary: ScoutRunSummary;
  notes: string[];
}): Promise<ScoutCandidate[]> {
  const { organizationId, summary, notes } = input;
  const gated: ScoutCandidate[] = [];
  for (const row of input.queue) {
    try {
      await ensureFeature(organizationId, "aiAutoDraft");
      await enforceQuota(organizationId, "aiRequestsPerMonth");
    } catch (err) {
      if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
        summary.skippedGated += input.queue.length - gated.length;
        notes.push(`Triage stopped: ${err.message}`);
        break;
      }
      throw err;
    }
    gated.push(row);
  }
  if (gated.length === 0) return [];

  const inputSchema = zodToToolSchema(scoutTriageSchema);
  const requests: BatchRequest[] = gated.map((row) => {
    const prompt = buildScoutTriagePrompt(input.snapshotOf(row));
    return {
      customId: row.id,
      opts: {
        system: prompt.system,
        messages: prompt.messages,
        tool: { ...TRIAGE_TOOL, inputSchema },
        maxTokens: 600,
        temperature: 0.2,
        cacheSystem: true,
      },
    };
  });
  try {
    const { batchId } = await queueAiBatch({
      organizationId,
      feature: "opportunity_triage",
      promptVersion: SCOUT_TRIAGE_PROMPT_VERSION,
      context: { runId: input.runId },
      requests,
    });
    await db
      .update(scoutCandidates)
      .set({ triageBatchId: batchId, updatedAt: new Date() })
      .where(and(eq(scoutCandidates.organizationId, organizationId), inArray(scoutCandidates.id, gated.map((r) => r.id))));
    notes.push(`Triage of ${gated.length} candidate${gated.length === 1 ? "" : "s"} went out as a batch at half price; results arrive within the hour.`);
    return [];
  } catch (err) {
    await refundQuota(organizationId, "aiRequestsPerMonth", gated.length).catch(() => undefined);
    // Over the token cap or past the trial: a live call would be refused too.
    if (err instanceof QuotaExceededError) {
      summary.skippedGated += gated.length;
      notes.push(`Triage stopped: ${err.message}`);
      return [];
    }
    log.warn("[scout]", "triage batch submit failed; triaging live", { organizationId, error: err });
    notes.push("The triage batch could not be sent, so the scout triaged live.");
    return gated;
  }
}

/**
 * BL-AIX Phase 1g-2 — applying a batched triage, under the batch's own
 * organization and only to candidates still waiting on that batch.
 */
export const scoutTriageBatchHandler: BatchHandler<z.infer<typeof scoutTriageSchema>> = {
  schema: scoutTriageSchema,
  async apply({ organizationId, batchId, customId, data, model, promptVersion }) {
    if (!isScoutRecommendation(data.recommendation)) return false;
    const updated = await db
      .update(scoutCandidates)
      .set({
        recommendation: data.recommendation,
        confidence: clampConfidence(data.confidence),
        rationale: data.rationale.trim().slice(0, 2_000),
        nextActions: cleanList(data.nextActions, 3),
        promptVersion,
        model,
        stubbed: false,
        triageBatchId: null,
        updatedAt: new Date(),
      })
      .where(and(eq(scoutCandidates.id, customId), eq(scoutCandidates.organizationId, organizationId), eq(scoutCandidates.triageBatchId, batchId)))
      .returning({ id: scoutCandidates.id });
    return updated.length > 0;
  },
  async fail({ organizationId, batchId, customId }) {
    await refundQuota(organizationId, "aiRequestsPerMonth").catch(() => undefined);
    await db
      .update(scoutCandidates)
      .set({ triageBatchId: null, updatedAt: new Date() })
      .where(and(eq(scoutCandidates.id, customId), eq(scoutCandidates.organizationId, organizationId), eq(scoutCandidates.triageBatchId, batchId)));
  },
  async finish({ organizationId, context }) {
    const runId = typeof context.runId === "string" ? context.runId : null;
    if (!runId) return;
    const [row] = await db
      .select({ n: count() })
      .from(scoutCandidates)
      .where(and(eq(scoutCandidates.organizationId, organizationId), eq(scoutCandidates.runId, runId), isNotNull(scoutCandidates.recommendation)));
    await db
      .update(scoutRuns)
      .set({ triaged: Number(row?.n ?? 0) })
      .where(and(eq(scoutRuns.id, runId), eq(scoutRuns.organizationId, organizationId)));
  },
};

/**
 * BL-STAB-10e — what the organization says it does, for the triage: its
 * capability statement first (Getting started's, tagged
 * `capability-statement`), then its best other capability entries; short
 * excerpts, archived entries left out.
 */
async function capabilitiesOf(organizationId: string): Promise<{ title: string; text: string }[]> {
  // BL-COMPANY-MODEL 1c — the approved company model, when there is one,
  // is what the organization says it does; the entries are the fallback.
  const model = await getApprovedCompanyModel(organizationId).catch((err) => {
    log.warn("[scout]", "company model read failed; using capability entries", { error: err });
    return null;
  });
  if (model) return companyModelAsCapabilities(model.body, model.version);
  const rows = await db
    .select({ title: knowledgeEntries.title, body: knowledgeEntries.body })
    .from(knowledgeEntries)
    .where(and(eq(knowledgeEntries.organizationId, organizationId), eq(knowledgeEntries.kind, "capability"), isNull(knowledgeEntries.archivedAt)))
    .orderBy(
      desc(sql`'capability-statement' = ANY(${knowledgeEntries.tags})`),
      sql`${knowledgeEntries.qualityScore} DESC NULLS LAST`,
      desc(knowledgeEntries.updatedAt),
    )
    .limit(4);
  return rows
    .map((r) => ({ title: r.title.slice(0, 120), text: readableText(r.body).replace(/\s+/g, " ").slice(0, 700) }))
    .filter((r) => r.text);
}

function buildSnapshot(
  organizationName: string,
  primaryNaics: string,
  naicsList: string[],
  socio: { sba8a: boolean; smallBusiness: boolean; sdb: boolean; wosb: boolean; sdvosb: boolean; hubzone: boolean } | null,
  profile: ScoutProfileView,
  capabilities: { title: string; text: string }[],
  row: ScoutCandidate,
  flag: RecompeteFlag | null,
  customer: CustomerCounts | null,
  history: { imported: string[]; dismissed: string[] },
  track: ScoutTrack,
  now: Date,
): ScoutTriageSnapshot {
  const setAsides = socio
    ? (Object.entries(socio) as [string, boolean][]).filter(([, v]) => v).map(([k]) => k)
    : [];
  return {
    organizationName,
    asOf: now.toISOString().slice(0, 10),
    organization: {
      primaryNaics,
      naicsList: unique([...naicsList, ...profile.extraNaics]),
      setAsides,
      keywords: profile.keywords,
      capabilities,
    },
    candidate: {
      source: row.source,
      title: row.title,
      agency: row.agency,
      office: row.office,
      noticeType: row.noticeType,
      solicitationNumber: row.solicitationNumber,
      naicsCode: row.naicsCode,
      pscCode: row.pscCode,
      setAside: row.setAside,
      incumbent: row.incumbent,
      postedAt: row.postedAt ? row.postedAt.toISOString().slice(0, 10) : null,
      responseDueAt: row.responseDueAt ? row.responseDueAt.toISOString().slice(0, 10) : null,
      daysToDue: row.responseDueAt ? Math.ceil((row.responseDueAt.getTime() - now.getTime()) / DAY_MS) : null,
      placeOfPerformance: row.placeOfPerformance,
      description: row.description.slice(0, 1_500),
      matchedKeyword: row.matchedKeyword,
    },
    fitScore: row.fitScore,
    signals: row.signals,
    recompete: flag
      ? { title: flag.title, outcome: flag.outcome, awardedTo: flag.awardedTo, lessons: flag.lessons.slice(0, 400) }
      : null,
    customer,
    history: { imported: history.imported, dismissed: history.dismissed, track: { n: track.n, accuracy: track.accuracy } },
  };
}

async function learningHistory(organizationId: string): Promise<{ imported: string[]; dismissed: string[] }> {
  const rows = await db
    .select({
      title: scoutCandidates.title,
      agency: scoutCandidates.agency,
      status: scoutCandidates.status,
      recommendation: scoutCandidates.recommendation,
    })
    .from(scoutCandidates)
    .where(and(eq(scoutCandidates.organizationId, organizationId), ne(scoutCandidates.status, "new")))
    .orderBy(desc(scoutCandidates.decidedAt))
    .limit(12);
  return learningExamples(rows);
}

/**
 * BL-STAB-10d — delete the organization's waiting finds (never decided,
 * not watchlisted awards) that no longer fit the scout's rules
 * (staleReason). A find with no description of its own is judged on FORGE's
 * copy of SAM.gov; one that can't be judged yet is kept.
 */
/** The solicitation key of a column, computed in SQL the way solicitationKey does it. */
function keyOf(col: typeof scoutCandidates.solicitationNumber | typeof opportunities.solicitationNumber): SQL<string> {
  return sql<string>`upper(regexp_replace(${col}, '[^A-Za-z0-9]', '', 'g'))`;
}

/**
 * BL-SCOUT-QUALITY — this run's new notices, one per solicitation (the
 * latest), set against what the tenant already has: a solicitation in the
 * pipeline raises no find, a decided one stays decided, a waiting one is
 * replaced by its newer notice. Notices without a usable number pass as is.
 */
async function bySolicitation<F extends { sam: SamOpportunity }>(
  organizationId: string,
  notices: F[],
): Promise<{ fresh: F[]; replaceFor: Map<string, string>; inPipeline: number; pipelineIds: string[] }> {
  const latest = new Map<string, F>();
  const fresh: F[] = [];
  for (const f of notices) {
    const k = solicitationKey(f.sam.solicitationNumber);
    if (!k) {
      fresh.push(f);
      continue;
    }
    const prev = latest.get(k);
    if (!prev || (Date.parse(f.sam.postedDate) || 0) > (Date.parse(prev.sam.postedDate) || 0)) latest.set(k, f);
  }
  const keys = [...latest.keys()];
  const replaceFor = new Map<string, string>();
  if (keys.length === 0) return { fresh, replaceFor, inPipeline: 0, pipelineIds: [] };
  const [cands, opps] = await Promise.all([
    db
      .select({ id: scoutCandidates.id, status: scoutCandidates.status, key: keyOf(scoutCandidates.solicitationNumber) })
      .from(scoutCandidates)
      .where(and(eq(scoutCandidates.organizationId, organizationId), inArray(keyOf(scoutCandidates.solicitationNumber), keys))),
    db
      .select({ id: opportunities.id, key: keyOf(opportunities.solicitationNumber) })
      .from(opportunities)
      .where(and(eq(opportunities.organizationId, organizationId), inArray(keyOf(opportunities.solicitationNumber), keys))),
  ]);
  const pipeline = new Set(opps.map((o) => o.key));
  let inPipeline = 0;
  for (const [k, f] of latest) {
    if (pipeline.has(k)) {
      inPipeline += 1;
      continue;
    }
    const rows = cands.filter((c) => c.key === k);
    if (rows.some((c) => c.status !== "new")) continue;
    const waiting = rows.find((c) => c.status === "new");
    if (waiting) replaceFor.set(f.sam.noticeId, waiting.id);
    fresh.push(f);
  }
  // BL-SCOUT-AMEND — the opportunities whose solicitation has a new notice: the amendment watch checks them first.
  const pipelineIds = opps.map((o) => o.id);
  return { fresh, replaceFor, inPipeline, pipelineIds };
}

/** BL-SCOUT-QUALITY — waiting finds of one solicitation fold into the latest notice; returns how many left. */
async function foldWaitingFinds(organizationId: string): Promise<number> {
  const rows = await db
    .select({ id: scoutCandidates.id, number: scoutCandidates.solicitationNumber, postedAt: scoutCandidates.postedAt, createdAt: scoutCandidates.createdAt })
    .from(scoutCandidates)
    .where(and(eq(scoutCandidates.organizationId, organizationId), eq(scoutCandidates.status, "new"), ne(scoutCandidates.solicitationNumber, "")));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = solicitationKey(r.number);
    if (k) groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const drop: string[] = [];
  const when = (r: (typeof rows)[number]) => (r.postedAt ?? r.createdAt).getTime();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const keep = members.reduce((a, b) => (when(b) > when(a) ? b : a));
    for (const m of members) if (m.id !== keep.id) drop.push(m.id);
  }
  if (drop.length === 0) return 0;
  await db.delete(scoutCandidates).where(and(eq(scoutCandidates.organizationId, organizationId), eq(scoutCandidates.status, "new"), inArray(scoutCandidates.id, drop)));
  return drop.length;
}

/**
 * BL-SCOUT-QUALITY — score every waiting find again with today's rules and
 * dates; a find that is now only a passing mention of a keyword is removed.
 */
async function rescoreWaitingFinds(
  organizationId: string,
  ctxBase: Omit<Parameters<typeof scoutFit>[1], "keyword" | "recompete" | "customer">,
  customerFor: (agency: string, naicsCode: string) => Promise<CustomerCounts | null>,
): Promise<{ rescored: number; dropped: number }> {
  const rows = await db
    .select()
    .from(scoutCandidates)
    .where(and(eq(scoutCandidates.organizationId, organizationId), eq(scoutCandidates.status, "new")))
    .orderBy(desc(scoutCandidates.fitScore))
    .limit(300);
  const drop: string[] = [];
  let rescored = 0;
  for (const row of rows) {
    const recompete = recompeteFromSignals(row.signals ?? []);
    const customer = await customerFor(row.agency, row.naicsCode);
    const fit = scoutFit(
      {
        source: row.source,
        title: row.title,
        description: row.description,
        agency: row.agency,
        naicsCode: row.naicsCode,
        setAside: row.setAside,
        responseDueAt: row.responseDueAt,
      },
      { ...ctxBase, keyword: row.matchedKeyword || null, recompete, customer },
    );
    if (passingMentionOnly(fit, { recompete, customer }, row.source)) {
      drop.push(row.id);
      continue;
    }
    if (fit.score !== row.fitScore || JSON.stringify(fit.signals) !== JSON.stringify(row.signals ?? [])) {
      await db
        .update(scoutCandidates)
        .set({ fitScore: fit.score, signals: fit.signals, updatedAt: new Date() })
        .where(and(eq(scoutCandidates.organizationId, organizationId), eq(scoutCandidates.id, row.id), eq(scoutCandidates.status, "new")));
      rescored += 1;
    }
  }
  if (drop.length > 0) {
    await db.delete(scoutCandidates).where(and(eq(scoutCandidates.organizationId, organizationId), eq(scoutCandidates.status, "new"), inArray(scoutCandidates.id, drop)));
  }
  return { rescored, dropped: drop.length };
}

async function clearStaleFinds(organizationId: string, rules: { codes: string[]; query: KeywordQuery | null; now: Date }, keep: Set<string>): Promise<number> {
  const waiting = await db
    .select({
      id: scoutCandidates.id,
      noticeId: scoutCandidates.noticeId,
      source: scoutCandidates.source,
      title: scoutCandidates.title,
      agency: scoutCandidates.agency,
      naicsCode: scoutCandidates.naicsCode,
      responseDueAt: scoutCandidates.responseDueAt,
      description: scoutCandidates.description,
      matchedKeyword: scoutCandidates.matchedKeyword,
    })
    .from(scoutCandidates)
    .where(and(eq(scoutCandidates.organizationId, organizationId), eq(scoutCandidates.status, "new"), ne(scoutCandidates.source, "watchlist_award")));
  if (waiting.length === 0) return 0;
  const stored = rules.query ? await (await noticeStore()).lookup(waiting.filter((w) => !w.description).map((w) => w.noticeId)) : new Map();
  const descOf = (w: (typeof waiting)[number]): DescriptionState | null =>
    w.description
      ? // Saved as readable text, cut at SCOUT_DESCRIPTION_CHARS (or by FORGE's copy, ending "..."): a cut one may hold more.
        { text: escapeHtml(w.description), ...(w.description.length >= SCOUT_DESCRIPTION_CHARS || /\.\.\.\s*$/.test(w.description) ? { partial: true as const } : {}) }
      : asDescription(stored.get(w.noticeId.toLowerCase()));
  const stale = waiting.filter((w) => !keep.has(w.noticeId) && staleReason(w, rules, descOf(w)) !== null).map((w) => w.id);
  if (stale.length === 0) return 0;
  await db
    .delete(scoutCandidates)
    .where(and(eq(scoutCandidates.organizationId, organizationId), eq(scoutCandidates.status, "new"), inArray(scoutCandidates.id, stale)));
  return stale.length;
}

async function finishRun(
  organizationId: string,
  runId: string | null,
  summary: ScoutRunSummary,
  notes: string[],
  now: Date,
): Promise<void> {
  summary.note = notes.join(" ").slice(0, 2_000);
  if (runId) {
    await db
      .update(scoutRuns)
      .set({
        finishedAt: new Date(),
        searches: summary.searches,
        found: summary.found,
        created: summary.created,
        triaged: summary.triaged,
        skippedGated: summary.skippedGated,
        errors: summary.errors,
        stubbed: summary.stubbed,
        note: summary.note,
      })
      .where(and(eq(scoutRuns.id, runId), eq(scoutRuns.organizationId, organizationId)));
  }
  await touchProfileLastRun(organizationId, now).catch((err) =>
    log.warn("[scout]", "profile touch failed", { organizationId, error: err }),
  );
}

// ── the cron ──────────────────────────────────────────────────────────

export type ScoutCronSummary = {
  organizations: number;
  created: number;
  triaged: number;
  errors: number;
  /** Tenants due but left for the next tick (time budget). */
  deferred: number;
  /** BL-STAB-7d — SAM.gov rejected FORGE's shared key (or its limit was reached); later companies on it weren't searched. */
  sharedKeyFailed: boolean;
};

/**
 * Scout every enabled tenant that has something to search for and was
 * not scouted in the last twenty hours, oldest first, inside a time
 * budget. Cross-org by design: this is a background worker; each
 * tenant's work goes through `runScoutForOrganization` with its own id.
 */
export async function runScoutCron(opts: { maxOrgs?: number; budgetMs?: number } = {}): Promise<ScoutCronSummary> {
  const maxOrgs = opts.maxOrgs ?? 25;
  const budgetMs = opts.budgetMs ?? 240_000;
  const started = Date.now();
  const summary: ScoutCronSummary = { organizations: 0, created: 0, triaged: 0, errors: 0, deferred: 0, sharedKeyFailed: false };
  const sharedKey: { failed: string | null } = { failed: null };

  const due = rowsOf<{ organization_id: string }>(
    await db.execute(sql`
      SELECT o.id AS organization_id
      FROM organization o
      LEFT JOIN scout_profile p ON p.organization_id = o.id
      WHERE o.disabled_at IS NULL
        AND COALESCE(p.enabled, true)
        AND (
          o.primary_naics <> ''
          OR cardinality(o.naics_list) > 0
          OR cardinality(COALESCE(p.keywords, ARRAY[]::text[])) > 0
          OR cardinality(COALESCE(p.extra_naics, ARRAY[]::text[])) > 0
        )
        AND (p.last_run_at IS NULL OR p.last_run_at < now() - make_interval(hours => ${RERUN_AFTER_HOURS}))
      ORDER BY p.last_run_at ASC NULLS FIRST
      LIMIT ${maxOrgs}
    `),
  );

  for (const row of due) {
    if (Date.now() - started > budgetMs) {
      summary.deferred += 1;
      continue;
    }
    const organizationId = row.organization_id;
    try {
      const r = await runScoutForOrganization({ organizationId, trigger: "cron", sharedKey });
      summary.organizations += 1;
      summary.created += r.created;
      summary.triaged += r.triaged;
      summary.errors += r.errors;
    } catch (err) {
      summary.errors += 1;
      log.error("[scout]", "tenant run failed", { organizationId, error: err });
    }
  }
  summary.sharedKeyFailed = sharedKey.failed !== null;
  return summary;
}

// ── reading and deciding ──────────────────────────────────────────────

function toView(row: ScoutCandidate, now: Date): ScoutCandidateView {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    noticeId: row.noticeId,
    title: row.title,
    agency: row.agency,
    office: row.office,
    solicitationNumber: row.solicitationNumber,
    noticeType: row.noticeType,
    setAside: row.setAside,
    naicsCode: row.naicsCode,
    incumbent: row.incumbent,
    postedAt: row.postedAt ? row.postedAt.toISOString().slice(0, 10) : null,
    responseDueAt: row.responseDueAt ? row.responseDueAt.toISOString().slice(0, 10) : null,
    daysToDue: row.responseDueAt ? Math.ceil((row.responseDueAt.getTime() - now.getTime()) / DAY_MS) : null,
    placeOfPerformance: row.placeOfPerformance,
    description: row.description.slice(0, 600),
    uiLink: row.uiLink,
    fitScore: row.fitScore,
    signals: row.signals ?? [],
    recommendation: isScoutRecommendation(row.recommendation) ? row.recommendation : null,
    triageQueued: !row.recommendation && row.triageBatchId !== null,
    confidence: row.confidence,
    rationale: row.rationale,
    nextActions: row.nextActions ?? [],
    stubbed: row.stubbed,
    grade: row.grade === "correct" || row.grade === "wrong" || row.grade === "inconclusive" ? row.grade : null,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    opportunityId: row.opportunityId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * New finds in the order the page shows them (BL-SCOUT-REACH: Pursue,
 * Watch, not yet reviewed, Skip; each best fit first), so a long list
 * never cuts an AI recommendation off; decided ones newest decision first.
 */
export async function listScoutCandidates(input: {
  organizationId: string;
  status: "new" | "decided";
  limit?: number;
}): Promise<ScoutCandidateView[]> {
  const { organizationId } = input;
  const now = new Date();
  const base = and(
    eq(scoutCandidates.organizationId, organizationId),
    input.status === "new" ? eq(scoutCandidates.status, "new") : ne(scoutCandidates.status, "new"),
  );
  const q = db.select().from(scoutCandidates).where(base);
  const rows =
    input.status === "new"
      ? await q
          .orderBy(
            sql`case ${scoutCandidates.recommendation} when 'pursue' then 0 when 'watch' then 1 when 'skip' then 3 else 2 end`,
            desc(scoutCandidates.fitScore),
            desc(scoutCandidates.createdAt),
          )
          .limit(input.limit ?? 50)
      : await q.orderBy(desc(scoutCandidates.decidedAt)).limit(input.limit ?? 20);
  return rows.map((r) => toView(r, now));
}

/** BL-SCOUT-REACH — how many finds are waiting, and how many of them the AI hasn't reviewed, for the page's counts (the list itself is capped). */
export async function countNewScoutCandidates(input: { organizationId: string }): Promise<{ total: number; unreviewed: number }> {
  const [row] = await db
    .select({ total: count(), unreviewed: sql<number>`count(*) filter (where ${scoutCandidates.recommendation} is null)`.mapWith(Number) })
    .from(scoutCandidates)
    .where(and(eq(scoutCandidates.organizationId, input.organizationId), eq(scoutCandidates.status, "new")));
  return { total: row?.total ?? 0, unreviewed: row?.unreviewed ?? 0 };
}

export type ScoutDecideResult =
  | { ok: true; status: ScoutDecision; opportunityId: string | null }
  | { ok: false; error: string };

function stageFor(noticeType: string): "identified" | "sources_sought" {
  const t = noticeType.toLowerCase();
  return t.includes("sources sought") || t.includes("rfi") || t.includes("special notice")
    ? "sources_sought"
    : "identified";
}

/**
 * A person imports (the candidate becomes an opportunity) or dismisses
 * a new candidate. The decision grades the scout's call.
 */
export async function decideScoutCandidate(input: {
  organizationId: string;
  candidateId: string;
  decision: ScoutDecision;
  actor: Actor;
}): Promise<ScoutDecideResult> {
  const { organizationId } = input;
  const [c] = await db
    .select()
    .from(scoutCandidates)
    .where(
      and(
        eq(scoutCandidates.id, input.candidateId),
        eq(scoutCandidates.organizationId, organizationId),
        eq(scoutCandidates.status, "new"),
      ),
    )
    .limit(1);
  if (!c) return { ok: false, error: "Candidate not found, or already decided." };

  const recommendation = isScoutRecommendation(c.recommendation) ? c.recommendation : null;
  const grade = gradeTriage(recommendation, input.decision);
  const now = new Date();
  let opportunityId: string | null = null;

  if (input.decision === "imported") {
    // BL-STAB-10 — a find whose description the nightly run didn't read gets it now
    // (FORGE's copy, else one SAM.gov request).
    let description = c.description;
    if (!description && c.source !== "watchlist_award" && noticeDescriptionUrl(c.noticeId)) {
      const sam = await resolveSamCredential(organizationId);
      const d = (await descriptionsFor(sam.ok ? sam.cred : null, [c.noticeId], 1)).get(c.noticeId);
      if (d && "text" in d) description = readableText(d.text).slice(0, 20_000);
    }
    const [opp] = await db
      .insert(opportunities)
      .values({
        organizationId,
        title: c.title || "Untitled",
        agency: c.agency,
        office: c.office,
        stage: stageFor(c.noticeType),
        solicitationNumber: c.solicitationNumber,
        // Award candidates carry a synthetic id; the opportunity gets none.
        // …and a find read from a portal email carries an email-based one (BL-SCOUT-INBOX).
        noticeId: c.source === "watchlist_award" || c.source === "portal_email" ? "" : c.noticeId,
        // BL-OPP-SOURCE — where it came from, with the find's own link.
        ...scoutSourceFields(c.source, c.noticeId, c.uiLink),
        responseDueDate: c.responseDueAt,
        releaseDate: c.postedAt,
        naicsCode: c.naicsCode,
        pscCode: c.pscCode,
        setAside: c.setAside,
        placeOfPerformance: c.placeOfPerformance,
        incumbent: c.incumbent,
        description,
        ownerUserId: input.actor.userId ?? undefined,
        createdByUserId: input.actor.userId ?? undefined,
      })
      .returning({ id: opportunities.id });
    if (!opp) return { ok: false, error: "Could not create the opportunity." };
    opportunityId = opp.id;
    // BL-SCOUT-FILES — a SAM.gov notice's attachments are downloaded now, not at the next daily check.
    if (c.source !== "watchlist_award" && c.source !== "portal_email" && c.noticeId) {
      const { queueNoticeFiles } = await import("@/lib/sam-notice-files");
      await queueNoticeFiles({ organizationId, opportunityId: opp.id, userId: input.actor.userId ?? null });
    }
    // BL-SCOUT-INBOX — a find read from a portal email brings that email's attachments.
    if (c.inboundEmailId) {
      const { fileInboundAttachments } = await import("@/lib/inbound-bids");
      await fileInboundAttachments({ organizationId, emailId: c.inboundEmailId, opportunityId: opp.id, userId: input.actor.userId ?? null }).catch((err) =>
        log.warn("[scout]", "portal email attachments not filed", { organizationId, error: err }),
      );
    }
  }

  const decided = { status: input.decision, grade, decidedByUserId: input.actor.userId, decidedAt: now, opportunityId, updatedAt: now };
  const updated = await db
    .update(scoutCandidates)
    .set(decided)
    .where(and(eq(scoutCandidates.id, c.id), eq(scoutCandidates.organizationId, organizationId), eq(scoutCandidates.status, "new")))
    .returning({ id: scoutCandidates.id });
  // BL-STAB-10d — a scout run cleared the find while this decision was made: keep the decision.
  if (updated.length === 0) await db.insert(scoutCandidates).values({ ...c, ...decided }).onConflictDoNothing();

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: input.decision === "imported" ? "scout.candidate.import" : "scout.candidate.dismiss",
    resourceType: "scout_candidate",
    resourceId: c.id,
    metadata: {
      noticeId: c.noticeId,
      source: c.source,
      recommendation,
      grade,
      fitScore: c.fitScore,
      opportunityId,
    },
  });
  return { ok: true, status: input.decision, opportunityId };
}

/** How the scout's calls have matched this team's decisions. */
export async function getScoutTrack(input: { organizationId: string }): Promise<ScoutTrack> {
  const { organizationId } = input;
  const rows = await db
    .select({ status: scoutCandidates.status, grade: scoutCandidates.grade })
    .from(scoutCandidates)
    .where(and(eq(scoutCandidates.organizationId, organizationId), ne(scoutCandidates.status, "new")))
    .orderBy(desc(scoutCandidates.decidedAt))
    .limit(500);
  return summarizeScoutTrack(rows);
}

export async function latestScoutRun(input: { organizationId: string }): Promise<ScoutRunView | null> {
  const { organizationId } = input;
  const [row] = await db
    .select()
    .from(scoutRuns)
    .where(eq(scoutRuns.organizationId, organizationId))
    .orderBy(desc(scoutRuns.startedAt))
    .limit(1);
  if (!row) return null;
  return {
    runId: row.id,
    trigger: row.trigger,
    searches: row.searches,
    found: row.found,
    created: row.created,
    triaged: row.triaged,
    skippedGated: row.skippedGated,
    errors: row.errors,
    stubbed: row.stubbed,
    note: row.note,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}
