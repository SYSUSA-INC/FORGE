/**
 * BL-AIP-7b — the nightly scout.
 *
 * Until now the platform only looked at SAM.gov when a person opened the
 * import page and clicked Search. The scout runs for every tenant each
 * night (and on demand):
 *
 *   find    — re-runs the tenant's NAICS codes (profile + extra codes)
 *             and up to three keywords against SAM.gov for the notices
 *             posted since the last few days, and turns watchlisted
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
 *             request quota; skipped in stub mode; ten per run.
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

import { and, count, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import {
  bdWatchlistItems,
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
import { log } from "@/lib/log";
import type { RecompeteFlag } from "@/lib/recompete-match";
import { flagSamResults } from "@/lib/recompete-radar";
import { searchSamGovOpportunities, type SamOpportunity } from "@/lib/samgov";
import { isKeyOrQuotaFailure } from "@/lib/samgov-errors";
import { resolveSamCredential } from "@/lib/samgov-key";
import {
  awardExpiresWithin,
  DEFAULT_SCOUT_PROFILE,
  gradeTriage,
  isScoutRecommendation,
  learningExamples,
  scoutFit,
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
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";

export { DEFAULT_SCOUT_PROFILE } from "@/lib/scout-logic";
export type { ScoutCandidateView, ScoutProfileView, ScoutRunSummary, ScoutRunView } from "@/lib/scout-logic";

const DAY_MS = 24 * 60 * 60_000;
/** Model calls per tenant per run. */
const MAX_TRIAGE_PER_RUN = 10;
const MAX_KEYWORD_SEARCHES = 3;
const MAX_CUSTOMER_LOOKUPS = 8;
/** Watchlisted awards ending within this window become recompete candidates. */
const WATCHLIST_HORIZON_DAYS = 180;
const SAM_LIMIT = 100;
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

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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

function fromSam(o: SamOpportunity, source: ScoutCandidateSource): CandidateDraft {
  return {
    source,
    noticeId: o.noticeId,
    title: str(o.title, 500) || "Untitled",
    agency: [str(o.department, 200), str(o.subTier, 200)].filter(Boolean).join(" · "),
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
    description: stripTags(o.description ?? "").slice(0, 20_000),
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

  const profile = await getScoutProfile({ organizationId });
  const naics = unique([org.primaryNaics, ...org.naicsList, ...profile.extraNaics]);

  const [run] = await db
    .insert(scoutRuns)
    .values({ organizationId, trigger: input.trigger, requestedByUserId: input.requestedByUserId ?? null })
    .returning({ id: scoutRuns.id });
  summary.runId = run?.id ?? null;

  // 1. SAM.gov — the tenant's codes, then each keyword.
  const found = new Map<string, { sam: SamOpportunity; source: ScoutCandidateSource; keyword: string | null }>();
  const sam = await resolveSamCredential(organizationId);
  if (!sam.ok) {
    notes.push(`SAM.gov was not searched: ${sam.failure.error}`);
  } else {
    const searches: { params: Parameters<typeof searchSamGovOpportunities>[1]; source: ScoutCandidateSource; keyword: string | null }[] = [];
    if (naics.length > 0) {
      searches.push({
        params: { naicsCodes: naics, postedDaysBack: profile.postedDaysBack, limit: SAM_LIMIT },
        source: "org_naics",
        keyword: null,
      });
    }
    for (const kw of profile.keywords.slice(0, MAX_KEYWORD_SEARCHES)) {
      searches.push({
        params: { keyword: kw, postedDaysBack: profile.postedDaysBack, limit: SAM_LIMIT },
        source: "keyword",
        keyword: kw,
      });
    }
    if (searches.length === 0) {
      notes.push("No NAICS codes or keywords to search; add them under Settings → Classification or on the Scout page.");
    }
    for (const [i, s] of searches.entries()) {
      summary.searches += 1;
      try {
        const r = await searchSamGovOpportunities(sam.cred, s.params);
        if (!r.ok) {
          summary.errors += 1;
          notes.push(`${s.keyword ? `Keyword "${s.keyword}"` : "NAICS"} search: ${r.error}`);
          // BL-STAB-7a — the same key would fail every remaining search.
          if (isKeyOrQuotaFailure(r.cls) && i < searches.length - 1) {
            notes.push("Remaining SAM.gov searches skipped.");
            break;
          }
          continue;
        }
        for (const o of r.opportunities) {
          if (!o.noticeId || found.has(o.noticeId)) continue;
          found.set(o.noticeId, { sam: o, source: s.source, keyword: s.keyword });
        }
      } catch (err) {
        summary.errors += 1;
        log.warn("[scout]", "sam search failed", { organizationId, error: err });
      }
    }
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

  // 3. Drop what the tenant already has or already saw.
  const allIds = [...found.keys(), ...awardDrafts.map((d) => d.noticeId)];
  if (allIds.length === 0) {
    await finishRun(organizationId, run?.id ?? null, summary, notes, now);
    return summary;
  }
  const [seen, imported] = await Promise.all([
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
  const freshSam = [...found.values()].filter((f) => !known.has(f.sam.noticeId));
  const freshAwards = awardDrafts.filter((d) => !known.has(d.noticeId));

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

  // 5. Score and store.
  const ctxBase = {
    primaryNaics: org.primaryNaics,
    naicsList: [...org.naicsList, ...profile.extraNaics],
    socio: org.socio,
    keywords: profile.keywords,
    now,
  };
  type Staged = { draft: CandidateDraft; fit: { score: number; signals: string[] }; flag: RecompeteFlag | null; customer: CustomerCounts | null };
  const staged: Staged[] = [];
  for (const f of freshSam) {
    const draft = fromSam(f.sam, f.source);
    const flag = flags[f.sam.noticeId] ?? null;
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
      {
        ...ctxBase,
        keyword: f.keyword,
        recompete: flag ? { outcome: flag.outcome, confidence: flag.confidence, hasLessons: !!flag.lessons } : null,
        customer,
      },
    );
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
  if (staged.length === 0) {
    await finishRun(organizationId, run?.id ?? null, summary, notes, now);
    return summary;
  }
  const inserted = await db
    .insert(scoutCandidates)
    .values(
      staged.map((s) => ({
        ...s.draft,
        organizationId,
        runId: run?.id ?? null,
        fitScore: s.fit.score,
        signals: s.fit.signals,
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
    const queue = [...inserted].sort((a, b) => b.fitScore - a.fitScore).slice(0, maxTriage);
    const history = await learningHistory(organizationId);
    const track = await getScoutTrack({ organizationId });
    const snapshotOf = (row: ScoutCandidate) => {
      const s = byNotice.get(row.noticeId);
      return buildSnapshot(org.name, org.primaryNaics, org.naicsList, org.socio, profile, row, s?.flag ?? null, s?.customer ?? null, history, track, now);
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

function buildSnapshot(
  organizationName: string,
  primaryNaics: string,
  naicsList: string[],
  socio: { sba8a: boolean; smallBusiness: boolean; sdb: boolean; wosb: boolean; sdvosb: boolean; hubzone: boolean } | null,
  profile: ScoutProfileView,
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
  const summary: ScoutCronSummary = { organizations: 0, created: 0, triaged: 0, errors: 0, deferred: 0 };

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
      const r = await runScoutForOrganization({ organizationId, trigger: "cron" });
      summary.organizations += 1;
      summary.created += r.created;
      summary.triaged += r.triaged;
      summary.errors += r.errors;
    } catch (err) {
      summary.errors += 1;
      log.error("[scout]", "tenant run failed", { organizationId, error: err });
    }
  }
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

/** New finds fit-first; decided ones newest decision first. */
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
      ? await q.orderBy(desc(scoutCandidates.fitScore), desc(scoutCandidates.createdAt)).limit(input.limit ?? 50)
      : await q.orderBy(desc(scoutCandidates.decidedAt)).limit(input.limit ?? 20);
  return rows.map((r) => toView(r, now));
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
        noticeId: c.source === "watchlist_award" ? "" : c.noticeId,
        responseDueDate: c.responseDueAt,
        releaseDate: c.postedAt,
        naicsCode: c.naicsCode,
        pscCode: c.pscCode,
        setAside: c.setAside,
        placeOfPerformance: c.placeOfPerformance,
        incumbent: c.incumbent,
        description: c.description,
        ownerUserId: input.actor.userId ?? undefined,
        createdByUserId: input.actor.userId ?? undefined,
      })
      .returning({ id: opportunities.id });
    if (!opp) return { ok: false, error: "Could not create the opportunity." };
    opportunityId = opp.id;
  }

  await db
    .update(scoutCandidates)
    .set({
      status: input.decision,
      grade,
      decidedByUserId: input.actor.userId,
      decidedAt: now,
      opportunityId,
      updatedAt: now,
    })
    .where(and(eq(scoutCandidates.id, c.id), eq(scoutCandidates.organizationId, organizationId)));

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
