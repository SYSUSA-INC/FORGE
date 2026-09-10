/**
 * BL-FB-X-PWIN-MODEL — server side of the PWin estimate.
 *
 * Gathers the signals for one opportunity (evaluation, incumbency,
 * competitors, set-aside eligibility, NAICS fit, the org's agency and
 * NAICS track record, proposal readiness), fits the org's calibration
 * shift from its decided outcomes, scores with the pure model, and
 * records snapshots so the model can be graded against what actually
 * happened.
 *
 * Every query is scoped by the caller-supplied organizationId; callers
 * own auth. Server-only lib, not an action.
 */
import "server-only";

import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceItems,
  opportunities,
  opportunityCompetitors,
  opportunityEvaluations,
  organizations,
  proposalOutcomes,
  proposals,
  proposalScanResults,
  pwinSnapshots,
} from "@/db/schema";
import {
  brierScore,
  computePrior,
  fitCalibrationShift,
  PWIN_MODEL_VERSION,
  scoreFeatures,
  setAsideEligibility,
  type CalibrationFit,
  type PwinEvaluation,
  type PwinFeatures,
  type PwinHistory,
  type PwinPrior,
  type PwinScore,
  type SocioEconomic,
} from "@/lib/pwin-model";
import { log } from "@/lib/log";

/** Most recent decided outcomes considered for prior + calibration. */
const HISTORY_LIMIT = 300;

export type PwinEstimate = {
  opportunityId: string;
  proposalId: string | null;
  score: PwinScore;
  features: PwinFeatures;
  prior: PwinPrior;
  calibration: { applied: boolean; fit: CalibrationFit | null };
  /** The hand-set value on the opportunity record. */
  manualPwin: number;
  /** Model grade on snapshots frozen at outcome time. */
  track: { n: number; brier: number | null };
  modelVersion: string;
};

type HistoryRow = {
  opportunityId: string;
  agency: string;
  naicsCode: string;
  setAside: string;
  incumbent: string;
  won: boolean;
};

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isUs(incumbent: string, orgName: string): boolean {
  const a = normalizeName(incumbent);
  const b = normalizeName(orgName);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function evaluationOrNull(row: PwinEvaluation | null | undefined): PwinEvaluation | null {
  if (!row) return null;
  const vals = [
    row.strategicFit,
    row.customerRelationship,
    row.competitivePosture,
    row.resourceAvailability,
    row.financialAttractiveness,
  ];
  // All zeros means the assessor never filled it in.
  return vals.every((v) => !v) ? null : row;
}

function tally(rows: HistoryRow[], pick: (r: HistoryRow) => boolean): PwinHistory | null {
  let won = 0;
  let lost = 0;
  for (const r of rows) {
    if (!pick(r)) continue;
    if (r.won) won += 1;
    else lost += 1;
  }
  return won + lost > 0 ? { won, lost } : null;
}

async function loadHistory(organizationId: string): Promise<HistoryRow[]> {
  const rows = await db
    .select({
      opportunityId: proposals.opportunityId,
      agency: opportunities.agency,
      naicsCode: opportunities.naicsCode,
      setAside: opportunities.setAside,
      incumbent: opportunities.incumbent,
      outcomeType: proposalOutcomes.outcomeType,
      decisionDate: proposalOutcomes.decisionDate,
      createdAt: proposalOutcomes.createdAt,
    })
    .from(proposalOutcomes)
    .innerJoin(proposals, eq(proposals.id, proposalOutcomes.proposalId))
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .where(
      and(
        eq(proposalOutcomes.organizationId, organizationId),
        inArray(proposalOutcomes.outcomeType, ["won", "lost"]),
      ),
    )
    .orderBy(desc(proposalOutcomes.createdAt))
    .limit(HISTORY_LIMIT);

  return rows.map((r) => ({
    opportunityId: r.opportunityId,
    agency: r.agency ?? "",
    naicsCode: r.naicsCode ?? "",
    setAside: r.setAside ?? "",
    incumbent: r.incumbent ?? "",
    won: r.outcomeType === "won",
  }));
}

/**
 * Static features for historical opportunities (what was knowable at
 * bid time and is still stored): evaluation, competitors, set-aside,
 * NAICS, incumbency. History and readiness are deliberately excluded so
 * the calibration fit does not see the outcome it is being fitted to.
 */
async function historicalStaticLogits(
  history: HistoryRow[],
  org: { name: string; naicsList: string[]; socioEconomic: SocioEconomic | null },
  prior: PwinPrior,
): Promise<{ logit: number; won: boolean }[]> {
  if (history.length === 0) return [];
  const ids = [...new Set(history.map((h) => h.opportunityId))];

  const evals = await db
    .select()
    .from(opportunityEvaluations)
    .where(inArray(opportunityEvaluations.opportunityId, ids));
  const evalById = new Map(evals.map((e) => [e.opportunityId, e]));

  const comps = await db
    .select({
      opportunityId: opportunityCompetitors.opportunityId,
      isIncumbent: opportunityCompetitors.isIncumbent,
    })
    .from(opportunityCompetitors)
    .where(inArray(opportunityCompetitors.opportunityId, ids));
  const compStats = new Map<string, { count: number; incumbent: boolean }>();
  for (const c of comps) {
    const cur = compStats.get(c.opportunityId) ?? { count: 0, incumbent: false };
    cur.count += 1;
    cur.incumbent = cur.incumbent || c.isIncumbent;
    compStats.set(c.opportunityId, cur);
  }

  return history.map((h) => {
    const cs = compStats.get(h.opportunityId) ?? { count: 0, incumbent: false };
    const weAreIncumbent = isUs(h.incumbent, org.name);
    const features: PwinFeatures = {
      evaluation: evaluationOrNull(evalById.get(h.opportunityId) ?? null),
      weAreIncumbent,
      competitorIncumbent: !weAreIncumbent && cs.incumbent,
      incumbentNamed: !weAreIncumbent && h.incumbent.trim().length > 0,
      competitorCount: cs.count,
      setAsideEligible: setAsideEligibility(h.setAside, org.socioEconomic),
      naicsInOrgList:
        org.naicsList.length > 0 && h.naicsCode ? org.naicsList.includes(h.naicsCode) : null,
      agencyHistory: null,
      naicsHistory: null,
      readiness: null,
    };
    return { logit: scoreFeatures(features, prior).logit, won: h.won };
  });
}

/** Grade: snapshots frozen at outcome time, probability vs what happened. */
export async function getPwinTrack(
  organizationId: string,
): Promise<{ n: number; brier: number | null }> {
  const rows = await db
    .select({ probability: pwinSnapshots.probability, outcome: pwinSnapshots.outcome })
    .from(pwinSnapshots)
    .where(
      and(
        eq(pwinSnapshots.organizationId, organizationId),
        eq(pwinSnapshots.trigger, "outcome"),
        isNotNull(pwinSnapshots.outcome),
      ),
    )
    .orderBy(desc(pwinSnapshots.createdAt))
    .limit(HISTORY_LIMIT);
  const samples = rows
    .filter((r) => r.outcome === "won" || r.outcome === "lost")
    .map((r) => ({ p: r.probability, won: r.outcome === "won" }));
  return { n: samples.length, brier: brierScore(samples) };
}

export async function computePwin(
  organizationId: string,
  opportunityId: string,
): Promise<PwinEstimate | null> {
  const [opp] = await db
    .select({
      id: opportunities.id,
      agency: opportunities.agency,
      naicsCode: opportunities.naicsCode,
      setAside: opportunities.setAside,
      incumbent: opportunities.incumbent,
      pWin: opportunities.pWin,
    })
    .from(opportunities)
    .where(
      and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)),
    )
    .limit(1);
  if (!opp) return null;

  const [orgRow] = await db
    .select({
      name: organizations.name,
      naicsList: organizations.naicsList,
      socioEconomic: organizations.socioEconomic,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const org = {
    name: orgRow?.name ?? "",
    naicsList: orgRow?.naicsList ?? [],
    socioEconomic: (orgRow?.socioEconomic as SocioEconomic | null) ?? null,
  };

  const [evalRow] = await db
    .select()
    .from(opportunityEvaluations)
    .where(eq(opportunityEvaluations.opportunityId, opportunityId))
    .limit(1);

  const competitors = await db
    .select({ isIncumbent: opportunityCompetitors.isIncumbent })
    .from(opportunityCompetitors)
    .where(eq(opportunityCompetitors.opportunityId, opportunityId));

  // Latest proposal for this opportunity → readiness signals.
  const [prop] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(
      and(eq(proposals.opportunityId, opportunityId), eq(proposals.organizationId, organizationId)),
    )
    .orderBy(desc(proposals.createdAt))
    .limit(1);

  let readiness: PwinFeatures["readiness"] = null;
  if (prop) {
    const [scan] = await db
      .select({ overallScore: proposalScanResults.overallScore })
      .from(proposalScanResults)
      .where(eq(proposalScanResults.proposalId, prop.id))
      .limit(1);
    const items = await db
      .select({ status: complianceItems.status })
      .from(complianceItems)
      .where(eq(complianceItems.proposalId, prop.id));
    const applicable = items.filter((i) => i.status !== "not_applicable");
    const complete = applicable.filter((i) => i.status === "complete").length;
    readiness = {
      scanScore:
        scan?.overallScore === "strong" ||
        scan?.overallScore === "needs_work" ||
        scan?.overallScore === "critical"
          ? scan.overallScore
          : null,
      complianceRatio: applicable.length > 0 ? complete / applicable.length : null,
      complianceTotal: applicable.length,
    };
  }

  // History excludes this opportunity so an already-decided bid does
  // not see its own outcome.
  const history = (await loadHistory(organizationId)).filter(
    (h) => h.opportunityId !== opportunityId,
  );
  const prior = computePrior(
    history.filter((h) => h.won).length,
    history.filter((h) => !h.won).length,
  );

  const weAreIncumbent = isUs(opp.incumbent ?? "", org.name);
  const features: PwinFeatures = {
    evaluation: evaluationOrNull(evalRow ?? null),
    weAreIncumbent,
    competitorIncumbent: !weAreIncumbent && competitors.some((c) => c.isIncumbent),
    incumbentNamed: !weAreIncumbent && (opp.incumbent ?? "").trim().length > 0,
    competitorCount: competitors.length,
    setAsideEligible: setAsideEligibility(opp.setAside ?? "", org.socioEconomic),
    naicsInOrgList:
      org.naicsList.length > 0 && opp.naicsCode ? org.naicsList.includes(opp.naicsCode) : null,
    agencyHistory: opp.agency
      ? tally(history, (h) => normalizeName(h.agency) === normalizeName(opp.agency))
      : null,
    naicsHistory: opp.naicsCode ? tally(history, (h) => h.naicsCode === opp.naicsCode) : null,
    readiness,
  };

  let fit: CalibrationFit | null = null;
  try {
    fit = fitCalibrationShift(await historicalStaticLogits(history, org, prior));
  } catch (err) {
    log.warn("[computePwin]", "calibration fit failed", { error: err });
  }

  const score = scoreFeatures(features, prior, fit?.shift ?? 0);
  const track = await getPwinTrack(organizationId).catch(() => ({ n: 0, brier: null }));

  return {
    opportunityId,
    proposalId: prop?.id ?? null,
    score,
    features,
    prior,
    calibration: { applied: fit !== null, fit },
    manualPwin: opp.pWin,
    track,
    modelVersion: PWIN_MODEL_VERSION,
  };
}

export type PwinSnapshotTrigger = "apply" | "outcome";

export async function snapshotPwin(input: {
  organizationId: string;
  estimate: PwinEstimate;
  trigger: PwinSnapshotTrigger;
  outcome?: "won" | "lost" | null;
}): Promise<void> {
  const e = input.estimate;
  await db.insert(pwinSnapshots).values({
    organizationId: input.organizationId,
    opportunityId: e.opportunityId,
    proposalId: e.proposalId,
    probability: e.score.probability,
    pwin: e.score.pwin,
    manualPwin: e.manualPwin,
    confidence: e.score.confidence,
    factors: e.score.factors,
    prior: e.prior,
    calibration: e.calibration.fit ?? {},
    modelVersion: e.modelVersion,
    trigger: input.trigger,
    outcome: input.outcome ?? null,
  });
}

/**
 * Freeze the model's estimate for a proposal's opportunity alongside the
 * decided outcome. Called from the outcome save (best-effort) so every
 * decision grades the model. The estimate excludes this outcome from its
 * own history, so the grade is not self-fulfilling.
 */
export async function recordPwinOutcome(input: {
  organizationId: string;
  proposalId: string;
  outcome: "won" | "lost";
}): Promise<boolean> {
  const [prop] = await db
    .select({ opportunityId: proposals.opportunityId })
    .from(proposals)
    .where(
      and(eq(proposals.id, input.proposalId), eq(proposals.organizationId, input.organizationId)),
    )
    .limit(1);
  if (!prop) return false;
  const estimate = await computePwin(input.organizationId, prop.opportunityId);
  if (!estimate) return false;
  await snapshotPwin({
    organizationId: input.organizationId,
    estimate,
    trigger: "outcome",
    outcome: input.outcome,
  });
  return true;
}
