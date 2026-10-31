/**
 * BL-NEXT-ACTION phase 5a — the rules that propose the next action for a
 * pursuit, and the reconciliation of what they propose with what is
 * stored. Pure: no AI call decides what to do next, and every rule can
 * say what it read (`evidence`) and when its action is done.
 *
 * One rule per kind. A rule `holds` for a pursuit state when its action
 * is the thing to do; its `done` test is the state that means the action
 * happened, so a stored row closes from the state rather than a click.
 */
import type { OpportunityStage, ProposalStage } from "@/db/schema";

export const NEXT_ACTION_PRIORITIES = ["now", "this_week", "later"] as const;
export type NextActionPriority = (typeof NEXT_ACTION_PRIORITIES)[number];

export const NEXT_ACTION_STATUSES = ["proposed", "prepared", "done", "dismissed", "superseded"] as const;
export type NextActionStatus = (typeof NEXT_ACTION_STATUSES)[number];

export const NEXT_ACTION_PRIORITY_LABELS: Record<NextActionPriority, string> = {
  now: "Now",
  this_week: "This week",
  later: "Later",
};

/** How long "Not now" keeps a rule quiet, unless the stage changes first. */
export const NEXT_ACTION_SNOOZE_DAYS = 14;
/** How many actions a pursuit shows at once. */
export const NEXT_ACTION_MAX = 3;

export type PursuitState = {
  opportunityId: string;
  stage: OpportunityStage;
  responseDueDate: Date | null;
  awardDate: Date | null;
  /** The latest solicitation on the opportunity, if any. */
  solicitation: { id: string; parseStatus: string } | null;
  evaluationSaved: boolean;
  questionnaire: {
    built: boolean;
    total: number;
    answered: number;
    suggestionsWaiting: number;
    /** PWin reads the answers (5+ answered and 60% of them). */
    counting: boolean;
    partnerNeeded: boolean;
    shallGapsOpen: number;
  } | null;
  briefExists: boolean;
  incumbentRecorded: boolean;
  proposal: {
    id: string;
    stage: ProposalStage;
    submittedAt: Date | null;
    sections: { total: number; notStarted: number; draftOrBetter: number; overCap: number };
    compliance: { total: number; mapped: number };
    reviews: { any: boolean; goldPassed: boolean };
    openComments: number;
    lastScanAt: Date | null;
    lastSectionSavedAt: Date | null;
    outcome: "won" | "lost" | "no_bid" | "withdrawn" | null;
    debriefHeld: boolean;
  } | null;
  proposedLessons: number;
};

export type ProposedAction = {
  kind: string;
  rule: string;
  title: string;
  reason: string;
  href: string;
  priority: NextActionPriority;
  dueBy: Date | null;
  evidence: string[];
  proposalId: string | null;
};

export type StoredNextAction = {
  id: string;
  kind: string;
  status: NextActionStatus;
  stage: string;
  snoozedUntil: Date | null;
  title: string;
  reason: string;
  href: string;
  priority: NextActionPriority;
  dueBy: Date | null;
};

type Hold = Omit<ProposedAction, "kind" | "rule" | "priority" | "dueBy" | "proposalId"> & { priority?: NextActionPriority };

type Rule = {
  kind: string;
  /** Base priority before the due date escalates it. */
  priority: NextActionPriority;
  holds: (s: PursuitState, now: Date) => Hold | null;
  done: (s: PursuitState) => boolean;
};

const DAY = 86_400_000;
const CLOSED: OpportunityStage[] = ["won", "lost", "no_bid"];
const PRE_PROPOSAL: OpportunityStage[] = ["identified", "sources_sought", "qualification", "capture"];
const REVIEW_ORDER: ProposalStage[] = ["draft", "pink_team", "red_team", "gold_team", "white_gloves", "submitted"];

export function daysUntil(date: Date | null, now: Date): number | null {
  if (!date) return null;
  return Math.ceil((date.getTime() - now.getTime()) / DAY);
}

const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const oppHref = (s: PursuitState, tab = "") => `/opportunities/${s.opportunityId}${tab}`;
const propHref = (s: PursuitState, tab = "") => `/proposals/${s.proposal?.id}${tab}`;
const isActive = (s: PursuitState) => !CLOSED.includes(s.stage);
const beforeStage = (p: ProposalStage, than: ProposalStage) => REVIEW_ORDER.indexOf(p) >= 0 && REVIEW_ORDER.indexOf(p) < REVIEW_ORDER.indexOf(than);
const dueWithin = (s: PursuitState, now: Date, days: number) => {
  const d = daysUntil(s.responseDueDate, now);
  return d !== null && d <= days;
};
const proposalOpen = (s: PursuitState) => !!s.proposal && !s.proposal.outcome && !["awarded", "lost", "no_bid", "archived"].includes(s.proposal.stage);

/**
 * The rules: one per kind, each naming the stages it applies to inside
 * `holds`. At risk first, so it wins a tie on priority and due date;
 * then the design's order by stage.
 */
export const NEXT_ACTION_RULES: Rule[] = [
  {
    kind: "at_risk",
    priority: "now",
    holds: (s, now) => {
      if (!isActive(s) || s.stage === "submitted") return null;
      const d = daysUntil(s.responseDueDate, now);
      if (d === null || d < 0) return null;
      if (!s.proposal && d <= 14 && !PRE_PROPOSAL.includes(s.stage)) return null;
      if (!s.proposal && d <= 14) return { title: "At risk: due soon with no proposal", reason: `Due in ${n(d, "day")} and no proposal exists.`, href: oppHref(s, "/evaluation"), evidence: ["due", "proposal:none"] };
      if (s.proposal && proposalOpen(s) && d <= 7 && beforeStage(s.proposal.stage, "red_team")) return { title: "At risk: due soon, before red team", reason: `Due in ${n(d, "day")} and the proposal is at ${s.proposal.stage.replace("_", " ")}.`, href: propHref(s), evidence: ["due", `proposal:${s.proposal.id}`] };
      return null;
    },
    // Nothing "does" an at-risk flag: it lifts when the risk does.
    done: () => false,
  },
  {
    kind: "parse_solicitation",
    priority: "this_week",
    holds: (s) =>
      isActive(s) && s.solicitation && s.solicitation.parseStatus !== "parsed" && s.solicitation.parseStatus !== "parsing"
        ? {
            title: "Parse the solicitation",
            reason: s.solicitation.parseStatus === "failed" ? "The last parse failed; the questionnaire, the outline and compliance all read the parsed solicitation." : "A solicitation is attached but not parsed; the questionnaire, the outline and compliance all read the parsed solicitation.",
            href: `/solicitations/${s.solicitation.id}`,
            evidence: [`solicitation:${s.solicitation.id}`],
          }
        : null,
    done: (s) => !s.solicitation || s.solicitation.parseStatus === "parsed",
  },
  {
    kind: "score_evaluation",
    priority: "this_week",
    holds: (s) =>
      s.stage === "identified" && !s.evaluationSaved
        ? { title: "Score the evaluation", reason: "No evaluation is saved; the five scores and the rollup are what the gate decision reads.", href: oppHref(s, "/evaluation"), evidence: ["evaluation:none"] }
        : null,
    done: (s) => s.evaluationSaved,
  },
  {
    kind: "write_brief",
    priority: "later",
    holds: (s) =>
      s.stage === "identified" && !s.briefExists
        ? { title: "Write the pursuit brief", reason: "No brief exists; it gives the pursue / watch / no-bid call with the signals behind it.", href: oppHref(s), evidence: ["brief:none"] }
        : null,
    done: (s) => s.briefExists,
  },
  {
    kind: "build_questionnaire",
    priority: "this_week",
    holds: (s) =>
      s.stage === "sources_sought" && s.solicitation?.parseStatus === "parsed" && !s.questionnaire?.built
        ? { title: "Build the capability questionnaire", reason: "The solicitation is parsed and no questionnaire exists; its answers give coverage, the partner call and a PWin factor.", href: oppHref(s, "/evaluation"), evidence: [`solicitation:${s.solicitation.id}`] }
        : null,
    done: (s) => !!s.questionnaire?.built,
  },
  {
    kind: "answer_questionnaire",
    priority: "this_week",
    holds: (s) => {
      const q = s.questionnaire;
      if (!(s.stage === "sources_sought" || s.stage === "qualification") || !q?.built) return null;
      const open = q.total - q.answered;
      if (open <= 0) return null;
      const waiting = q.suggestionsWaiting > 0 ? `; ${n(q.suggestionsWaiting, "suggested answer")} waiting to be confirmed` : "";
      return { title: `Answer the ${n(open, "open questionnaire question")}`, reason: `${q.answered} of ${q.total} answered${waiting}. Coverage, the partner call and PWin read confirmed answers only.`, href: oppHref(s, "/evaluation"), evidence: ["questionnaire"] };
    },
    done: (s) => !!s.questionnaire && s.questionnaire.answered >= s.questionnaire.total,
  },
  {
    kind: "gate_decision",
    priority: "this_week",
    holds: (s, now) => {
      if (s.stage === "identified" && dueWithin(s, now, 14)) {
        return { title: "Take the bid / no-bid decision", reason: `Due in ${n(daysUntil(s.responseDueDate, now)!, "day")} and still at Identified: decide, with the reasoning on the timeline.`, href: oppHref(s, "/evaluation"), evidence: ["due"], priority: "now" };
      }
      if (s.stage === "sources_sought" && s.evaluationSaved && s.questionnaire?.counting) {
        return { title: "Take the bid / no-bid decision", reason: "The evaluation is saved and the questionnaire counts toward PWin: the gate has what it needs.", href: oppHref(s, "/evaluation"), evidence: ["evaluation", "questionnaire"] };
      }
      return null;
    },
    done: (s) => !(s.stage === "identified" || s.stage === "sources_sought"),
  },
  {
    kind: "find_partner",
    priority: "this_week",
    holds: (s) =>
      s.stage === "qualification" && s.questionnaire?.partnerNeeded
        ? { title: "Find a teaming partner", reason: `The questionnaire says a partner is needed (${n(s.questionnaire.shallGapsOpen, "shall-level gap")} with none named). Name one on the gap, or record a company to team with.`, href: "/companies", evidence: ["questionnaire"] }
        : null,
    done: (s) => !!s.questionnaire && !s.questionnaire.partnerNeeded,
  },
  {
    kind: "record_incumbent",
    priority: "later",
    holds: (s) =>
      s.stage === "qualification" && !s.incumbentRecorded
        ? { title: "Record the incumbent", reason: "No competitor is marked as the incumbent; PWin and the brief read the competitive posture from it.", href: oppHref(s, "/competitors"), evidence: ["competitors"] }
        : null,
    done: (s) => s.incumbentRecorded,
  },
  {
    kind: "create_proposal",
    priority: "this_week",
    holds: (s, now) => {
      if (s.proposal) return null;
      if (s.stage === "capture") return { title: "Create the proposal", reason: "The pursuit is captured and has no proposal yet.", href: `/proposals/new?opportunityId=${s.opportunityId}`, evidence: ["proposal:none"] };
      if (s.stage === "qualification" && dueWithin(s, now, 45)) return { title: "Create the proposal", reason: `Due in ${n(daysUntil(s.responseDueDate, now)!, "day")} with no proposal started.`, href: `/proposals/new?opportunityId=${s.opportunityId}`, evidence: ["proposal:none", "due"] };
      return null;
    },
    done: (s) => !!s.proposal,
  },
  {
    kind: "build_outline",
    priority: "this_week",
    holds: (s) =>
      (s.stage === "capture" || s.stage === "pre_proposal") && proposalOpen(s) && s.proposal!.sections.total === 0 && s.solicitation?.parseStatus === "parsed"
        ? { title: "Build the outline from Section L", reason: "The proposal has no sections and the solicitation is parsed: the outline comes from its instructions.", href: propHref(s), evidence: [`proposal:${s.proposal!.id}`, `solicitation:${s.solicitation.id}`] }
        : null,
    done: (s) => !!s.proposal && s.proposal.sections.total > 0,
  },
  {
    kind: "draft_sections",
    priority: "this_week",
    holds: (s) =>
      s.stage === "pre_proposal" && proposalOpen(s) && s.proposal!.sections.notStarted > 0
        ? { title: `Draft the ${n(s.proposal!.sections.notStarted, "section")} not started`, reason: `${s.proposal!.sections.notStarted} of ${s.proposal!.sections.total} sections have no draft.`, href: propHref(s, "/sections"), evidence: [`proposal:${s.proposal!.id}`] }
        : null,
    done: (s) => !!s.proposal && s.proposal.sections.notStarted === 0,
  },
  {
    kind: "map_compliance",
    priority: "this_week",
    holds: (s) => {
      const c = s.proposal?.compliance;
      if (s.stage !== "pre_proposal" || !proposalOpen(s) || !c || c.total === 0 || c.mapped / c.total >= 0.8) return null;
      return { title: "Map the compliance matrix", reason: `${c.mapped} of ${n(c.total, "requirement")} are mapped to a section (${Math.round((100 * c.mapped) / c.total)}%).`, href: propHref(s, "/compliance"), evidence: [`proposal:${s.proposal!.id}`] };
    },
    done: (s) => !!s.proposal && (s.proposal.compliance.total === 0 || s.proposal.compliance.mapped / s.proposal.compliance.total >= 0.8),
  },
  {
    kind: "start_review",
    priority: "this_week",
    holds: (s) => {
      const p = s.proposal;
      if (s.stage !== "pre_proposal" || !proposalOpen(s) || !p || p.reviews.any || p.sections.total === 0 || p.sections.draftOrBetter < p.sections.total) return null;
      return { title: "Start the pink team", reason: "Every section has a draft and no colour-team review has run.", href: propHref(s, "/reviews"), evidence: [`proposal:${p.id}`] };
    },
    done: (s) => !!s.proposal?.reviews.any,
  },
  {
    kind: "resolve_comments",
    priority: "this_week",
    holds: (s) =>
      s.stage === "pre_proposal" && proposalOpen(s) && s.proposal!.openComments > 0
        ? { title: `Resolve the ${n(s.proposal!.openComments, "open review comment")}`, reason: "Reviewers' comments are open; the drafter reads them as feedback until they are resolved.", href: propHref(s, "/reviews"), evidence: [`proposal:${s.proposal!.id}`] }
        : null,
    done: (s) => !!s.proposal && s.proposal.openComments === 0,
  },
  {
    kind: "tighten_sections",
    priority: "this_week",
    holds: (s) =>
      s.stage === "pre_proposal" && proposalOpen(s) && s.proposal!.sections.overCap > 0
        ? { title: `Tighten the ${n(s.proposal!.sections.overCap, "section")} over the page cap`, reason: "At 350 words a page, these sections run past their cap.", href: propHref(s, "/sections"), evidence: [`proposal:${s.proposal!.id}`] }
        : null,
    done: (s) => !!s.proposal && s.proposal.sections.overCap === 0,
  },
  {
    kind: "run_health_scan",
    priority: "later",
    holds: (s) => {
      const p = s.proposal;
      if (s.stage !== "pre_proposal" || !proposalOpen(s) || !p || p.sections.draftOrBetter === 0 || !p.lastSectionSavedAt) return null;
      if (p.lastScanAt && p.lastScanAt >= p.lastSectionSavedAt) return null;
      return { title: "Run the health scan", reason: p.lastScanAt ? "Sections changed since the last scan." : "No health scan has run on this draft.", href: propHref(s), evidence: [`proposal:${p.id}`] };
    },
    done: (s) => !!s.proposal?.lastScanAt && (!s.proposal.lastSectionSavedAt || s.proposal.lastScanAt >= s.proposal.lastSectionSavedAt),
  },
  {
    kind: "submit",
    priority: "now",
    holds: (s, now) =>
      s.stage === "pre_proposal" && proposalOpen(s) && s.proposal!.stage !== "submitted" && dueWithin(s, now, 3) && s.proposal!.reviews.goldPassed
        ? { title: "Submit the proposal", reason: `Due in ${n(Math.max(0, daysUntil(s.responseDueDate, now)!), "day")} and the gold team passed.`, href: propHref(s), evidence: [`proposal:${s.proposal!.id}`, "due"] }
        : null,
    done: (s) => s.stage === "submitted" || s.proposal?.stage === "submitted" || !!s.proposal?.submittedAt,
  },
  {
    kind: "record_outcome",
    priority: "this_week",
    holds: (s, now) => {
      const p = s.proposal;
      if (s.stage !== "submitted" || !p || p.outcome) return null;
      const awardPassed = s.awardDate ? s.awardDate.getTime() <= now.getTime() : false;
      const submitted = p.submittedAt ?? null;
      const longAgo = submitted ? now.getTime() - submitted.getTime() >= 60 * DAY : false;
      if (!awardPassed && !longAgo) return null;
      return { title: "Record the outcome", reason: awardPassed ? "The award date has passed and no outcome is recorded." : "Submitted 60 days ago with no outcome recorded.", href: propHref(s, "/outcome"), evidence: [`proposal:${p.id}`, awardPassed ? "award_date" : "submitted_at"] };
    },
    done: (s) => !!s.proposal?.outcome,
  },
  {
    kind: "hold_debrief",
    priority: "this_week",
    holds: (s) =>
      (s.stage === "submitted" || s.stage === "lost") && s.proposal?.outcome === "lost" && !s.proposal.debriefHeld
        ? { title: "Hold the debrief", reason: "The bid was lost and no debrief has been held; the lessons and the loss intelligence read it.", href: propHref(s, "/outcome"), evidence: [`proposal:${s.proposal.id}`] }
        : null,
    done: (s) => !!s.proposal?.debriefHeld,
  },
  {
    kind: "confirm_lessons",
    priority: "this_week",
    holds: (s) =>
      CLOSED.includes(s.stage) && s.proposedLessons > 0
        ? { title: `Confirm the ${n(s.proposedLessons, "proposed lesson")}`, reason: "FORGE drafted lessons from this outcome; nothing reads one until a Capture or Admin user confirms it.", href: "/intelligence/lessons", evidence: ["lessons:proposed"] }
        : null,
    done: (s) => s.proposedLessons === 0,
  },
];

const RULE_BY_KIND = new Map(NEXT_ACTION_RULES.map((r) => [r.kind, r]));
export const NEXT_ACTION_KINDS = NEXT_ACTION_RULES.map((r) => r.kind);

function escalate(base: NextActionPriority, dueBy: Date | null, now: Date): NextActionPriority {
  const d = daysUntil(dueBy, now);
  if (d === null) return base;
  if (d <= 7) return "now";
  if (d <= 21 && base === "later") return "this_week";
  return base;
}

function dueByFor(s: PursuitState): Date | null {
  if (s.stage === "submitted") return s.awardDate;
  return isActive(s) ? s.responseDueDate : null;
}

const PRIORITY_RANK: Record<NextActionPriority, number> = { now: 0, this_week: 1, later: 2 };

export function rankActions<T extends { priority: NextActionPriority; dueBy: Date | null; rule: string }>(actions: T[]): T[] {
  const order = new Map(NEXT_ACTION_RULES.map((r, i) => [r.kind, i]));
  return [...actions].sort((a, b) => {
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (p !== 0) return p;
    const da = a.dueBy?.getTime() ?? Infinity;
    const db = b.dueBy?.getTime() ?? Infinity;
    if (da !== db) return da - db;
    return (order.get(a.rule) ?? 99) - (order.get(b.rule) ?? 99);
  });
}

/** Every action whose rule holds for the state, ranked; not yet capped. */
export function proposeNextActions(state: PursuitState, now = new Date()): ProposedAction[] {
  const dueBy = dueByFor(state);
  const out: ProposedAction[] = [];
  for (const rule of NEXT_ACTION_RULES) {
    const hold = rule.holds(state, now);
    if (!hold) continue;
    out.push({
      kind: rule.kind,
      rule: rule.kind,
      title: hold.title,
      reason: hold.reason,
      href: hold.href,
      evidence: hold.evidence,
      priority: hold.priority ?? escalate(rule.priority, dueBy, now),
      dueBy,
      proposalId: hold.href.startsWith("/proposals/") && state.proposal ? state.proposal.id : null,
    });
  }
  return rankActions(out);
}

export type Reconciliation = {
  insert: ProposedAction[];
  update: { id: string; patch: Pick<ProposedAction, "title" | "reason" | "href" | "priority" | "dueBy"> }[];
  close: { id: string; status: "done" | "superseded" }[];
};

/**
 * What to write so the stored rows match the rules: a rule that holds
 * keeps its open row (refreshed) or gets one, unless a dismissal still
 * snoozes it at this stage; an open row whose rule no longer holds is
 * done when its done test passes and superseded otherwise.
 */
export function reconcileNextActions(stored: StoredNextAction[], state: PursuitState, now = new Date()): Reconciliation {
  const proposed = proposeNextActions(state, now);
  const byKind = new Map(proposed.map((p) => [p.kind, p]));
  const res: Reconciliation = { insert: [], update: [], close: [] };
  const openKinds = new Set<string>();
  const snoozed = new Set<string>();
  for (const row of stored) {
    if (row.status === "dismissed" && row.snoozedUntil && row.snoozedUntil > now && row.stage === state.stage) snoozed.add(row.kind);
  }
  for (const row of stored) {
    if (row.status !== "proposed" && row.status !== "prepared") continue;
    const p = byKind.get(row.kind);
    if (p && !openKinds.has(row.kind)) {
      openKinds.add(row.kind);
      const same = row.title === p.title && row.reason === p.reason && row.href === p.href && row.priority === p.priority && (row.dueBy?.getTime() ?? null) === (p.dueBy?.getTime() ?? null);
      if (!same) res.update.push({ id: row.id, patch: { title: p.title, reason: p.reason, href: p.href, priority: p.priority, dueBy: p.dueBy } });
      continue;
    }
    const rule = RULE_BY_KIND.get(row.kind);
    res.close.push({ id: row.id, status: rule && rule.done(state) ? "done" : "superseded" });
  }
  for (const p of proposed) {
    if (openKinds.has(p.kind) || snoozed.has(p.kind)) continue;
    res.insert.push(p);
  }
  return res;
}

/** Who may mark an action done or dismiss it: the pursuit's owner, Capture and Admin. */
export function mayDecideNextAction(user: { id: string; role: string | null; isSuperadmin: boolean }, ownerUserId: string | null): boolean {
  return user.isSuperadmin || user.role === "admin" || user.role === "capture" || (!!ownerUserId && ownerUserId === user.id);
}
