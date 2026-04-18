"use client";

import { useSyncExternalStore } from "react";
import type { Proposal } from "@/lib/mock";

// ---------- Types ----------

export type ArtifactKind =
  | "proposal"
  | "draft_section"
  | "revision"
  | "review_comment"
  | "win_theme"
  | "past_performance"
  | "boilerplate"
  | "resume"
  | "debrief";

export type LearningArtifact = {
  id: string;
  kind: ArtifactKind;
  proposalId?: string;
  sectionId?: string;
  content: string;
  embeddingId?: string;
  outcome?: "accepted" | "revised" | "rejected" | "won" | "lost";
  score?: number;
  agency?: string;
  naics?: string;
  sectionType?: string;
  evalCriterion?: string;
  createdAt: string;
};

export type PromptTemplate =
  | "section_generation"
  | "requirement_extraction"
  | "revision"
  | "red_team"
  | "compliance_check";

export type PromptVersion = {
  id: string;
  template: PromptTemplate;
  version: number;
  hash: string;
  body: string;
  status: "active" | "candidate" | "deprecated";
  stats: {
    runs: number;
    acceptanceRate: number;
    avgEditDistance: number;
    avgReviewSeverity: number;
  };
  createdAt: string;
};

export type Outcome = {
  id: string;
  proposalId: string;
  proposalTitle?: string;
  result: "won" | "lost" | "no_bid" | "cancelled" | "pending";
  score?: number;
  evaluatorNotes?: string;
  awardedValue?: number;
  capturedAt: string;
};

export type LearnedPattern = {
  id: string;
  statement: string;
  confidence: number;
  evidenceCount: number;
  scope: { agency?: string; naics?: string; sectionType?: string };
  trend: "rising" | "stable" | "fading";
  discoveredAt: string;
};

export type TrainingSignal = {
  id: string;
  source:
    | "accept_reject"
    | "comment_severity"
    | "win_loss"
    | "eval_score"
    | "retrieval_reward"
    | "phase_advance"
    | "phase_revert";
  positive: boolean;
  weight: number;
  artifactId: string;
  note?: string;
  appliedAt: string;
};

export type BrainState = {
  artifacts: LearningArtifact[];
  prompts: PromptVersion[];
  outcomes: Outcome[];
  patterns: LearnedPattern[];
  signals: TrainingSignal[];
};

// ---------- Store ----------

const KEY = "forge.brain.v1";

type Listener = () => void;

const INITIAL: BrainState = {
  artifacts: [],
  prompts: [],
  outcomes: [],
  patterns: [],
  signals: [],
};

function load(): BrainState {
  if (typeof window === "undefined") return INITIAL;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...INITIAL, ...(JSON.parse(raw) as BrainState) } : INITIAL;
  } catch {
    return INITIAL;
  }
}

function save(next: BrainState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // quota or disabled
  }
}

let state: BrainState = INITIAL;
let hydrated = false;
const listeners = new Set<Listener>();

function hydrate() {
  if (!hydrated && typeof window !== "undefined") {
    state = load();
    hydrated = true;
  }
}

function emit() {
  save(state);
  listeners.forEach((l) => l());
}

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const brainStore = {
  getSnapshot(): BrainState {
    hydrate();
    return state;
  },
  getServerSnapshot(): BrainState {
    return INITIAL;
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  recordArtifact(a: Omit<LearningArtifact, "id" | "createdAt">) {
    hydrate();
    const full: LearningArtifact = {
      id: uid("art"),
      createdAt: new Date().toISOString(),
      ...a,
    };
    state = { ...state, artifacts: [full, ...state.artifacts].slice(0, 5000) };
    emit();
    return full;
  },
  recordOutcome(o: Omit<Outcome, "id" | "capturedAt">) {
    hydrate();
    const full: Outcome = {
      id: uid("out"),
      capturedAt: new Date().toISOString(),
      ...o,
    };
    state = { ...state, outcomes: [full, ...state.outcomes] };
    emit();
    return full;
  },
  recordPrompt(p: Omit<PromptVersion, "id" | "createdAt">) {
    hydrate();
    const full: PromptVersion = {
      id: uid("pv"),
      createdAt: new Date().toISOString(),
      ...p,
    };
    state = { ...state, prompts: [full, ...state.prompts] };
    emit();
    return full;
  },
  recordPattern(p: Omit<LearnedPattern, "id" | "discoveredAt">) {
    hydrate();
    const full: LearnedPattern = {
      id: uid("pat"),
      discoveredAt: new Date().toISOString(),
      ...p,
    };
    state = { ...state, patterns: [full, ...state.patterns] };
    emit();
    return full;
  },
  recordSignal(s: Omit<TrainingSignal, "id" | "appliedAt">) {
    hydrate();
    const full: TrainingSignal = {
      id: uid("sig"),
      appliedAt: new Date().toISOString(),
      ...s,
    };
    state = {
      ...state,
      signals: [full, ...state.signals].slice(0, 10000),
    };
    emit();
    return full;
  },
  clear() {
    state = INITIAL;
    emit();
  },
};

export function useBrain(): BrainState {
  return useSyncExternalStore(
    brainStore.subscribe,
    brainStore.getSnapshot,
    brainStore.getServerSnapshot,
  );
}

// ---------- Higher-level event helpers ----------

// Stage names are the 10 proposal phases already in Proposal.status.
// Map them to a linear position for velocity signals.
const PHASE_ORDER: Proposal["status"][] = [
  "PLANNING",
  "OUTLINING",
  "DRAFTING",
  "PINK_TEAM",
  "REVISING",
  "RED_TEAM",
  "GOLD_TEAM",
  "FINAL_REVIEW",
  "PRODUCTION",
  "SUBMITTED",
];

function phaseIndex(status: Proposal["status"]): number {
  const i = PHASE_ORDER.indexOf(status);
  return i < 0 ? 0 : i;
}

/**
 * Proposal creation — write a `proposal` artifact (metadata corpus) + a weak
 * positive retrieval-reward signal so the brain has something to show immediately.
 */
export function recordProposalCreated(p: Proposal) {
  const content = [
    `Proposal: ${p.title}`,
    p.solicitation ? `Solicitation: ${p.solicitation}` : undefined,
    p.agency ? `Agency: ${p.agency}` : undefined,
    p.captureManager ? `Capture: ${p.captureManager}` : undefined,
    p.proposalManager ? `PM: ${p.proposalManager}` : undefined,
    `Target: ${p.pagesLimit}p due ${p.dueAt || "TBD"}`,
  ]
    .filter(Boolean)
    .join("\n");

  const artifact = brainStore.recordArtifact({
    kind: "proposal",
    proposalId: p.id,
    content,
    agency: p.agency || undefined,
  });

  brainStore.recordSignal({
    source: "retrieval_reward",
    positive: true,
    weight: 0.1,
    artifactId: artifact.id,
    note: `New proposal ${p.code} captured`,
  });

  return artifact;
}

/**
 * Kanban drag-drop or explicit phase change — emit a velocity signal.
 * Forward moves are positive, reverts are negative; weight scales with distance.
 */
export function recordPhaseMove(
  proposalId: string,
  from: Proposal["status"],
  to: Proposal["status"],
) {
  if (from === to) return;
  const delta = phaseIndex(to) - phaseIndex(from);
  const positive = delta > 0;
  const weight = Math.min(1, Math.abs(delta) * 0.15);

  brainStore.recordSignal({
    source: positive ? "phase_advance" : "phase_revert",
    positive,
    weight,
    artifactId: proposalId,
    note: `${from} → ${to}`,
  });
}

// ---------- Derived summary ----------

export type BrainSummary = {
  corpusSize: number;
  embeddedCount: number;
  embeddingCoverage: number;
  promptTemplates: number;
  activePrompts: number;
  avgAcceptance: number;
  outcomesCaptured: number;
  winRate: number;
  patternsDiscovered: number;
  signalsApplied: number;
  lastEventAt?: string;
};

export function summarize(s: BrainState): BrainSummary {
  const embeddedCount = s.artifacts.filter((a) => !!a.embeddingId).length;
  const wins = s.outcomes.filter((o) => o.result === "won").length;
  const decided = s.outcomes.filter((o) =>
    ["won", "lost"].includes(o.result),
  ).length;
  const avgAcceptance =
    s.prompts.length === 0
      ? 0
      : s.prompts.reduce((a, p) => a + p.stats.acceptanceRate, 0) / s.prompts.length;

  const latest = [
    s.artifacts[0]?.createdAt,
    s.outcomes[0]?.capturedAt,
    s.patterns[0]?.discoveredAt,
    s.signals[0]?.appliedAt,
  ]
    .filter(Boolean)
    .sort()
    .reverse()[0];

  return {
    corpusSize: s.artifacts.length,
    embeddedCount,
    embeddingCoverage: s.artifacts.length === 0 ? 0 : embeddedCount / s.artifacts.length,
    promptTemplates: new Set(s.prompts.map((p) => p.template)).size,
    activePrompts: s.prompts.filter((p) => p.status === "active").length,
    avgAcceptance,
    outcomesCaptured: s.outcomes.length,
    winRate: decided === 0 ? 0 : wins / decided,
    patternsDiscovered: s.patterns.length,
    signalsApplied: s.signals.length,
    lastEventAt: latest,
  };
}
