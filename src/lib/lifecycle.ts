/**
 * BL-NAV-LIFECYCLE (FORGE II) — the seven stages of the proposal
 * lifecycle: Identify · Evaluate · Capture · Plan · Develop · Deliver ·
 * Measure. Each is a page under /pipeline with the chevron on top; the
 * chevron on an opportunity or proposal shows where it is. Pure;
 * unit-tested.
 */
import type { OpportunityStage } from "@/db/schema";

export type LifecycleKey = "identify" | "evaluate" | "capture" | "plan" | "develop" | "deliver" | "measure";

export type LifecycleStage = {
  key: LifecycleKey;
  label: string;
  href: string;
  /** What the stage is for, in the owner's words. */
  description: string;
  /** The pipeline stages whose opportunities this page lists (none for Identify: it finds and creates). */
  lists: OpportunityStage[];
};

export const LIFECYCLE: readonly LifecycleStage[] = [
  {
    key: "identify",
    label: "Identify",
    href: "/pipeline/identify",
    description: "Find and bring in opportunities: the scout and every portal on one page, and Create for the ones you add by hand. What you add lands in the pipeline.",
    lists: [],
  },
  {
    key: "evaluate",
    label: "Evaluate",
    href: "/pipeline/evaluate",
    description: "What was identified, waiting for the call: analyze it, build the capability matrix, then decide Go, No-Go with a reason, or Partner.",
    lists: ["identified", "sources_sought"],
  },
  {
    key: "capture",
    label: "Capture",
    href: "/pipeline/capture",
    description: "The Go and Partner decisions: shape the pursuit, find and qualify the partner where one is needed, then move it to Plan.",
    lists: ["qualification"],
  },
  {
    key: "plan",
    label: "Plan",
    href: "/pipeline/plan",
    description: "The response plan: the RACI, the team and charter, the Pink, Red, Gold and White Gloves teams, who writes what, the milestones.",
    lists: ["capture"],
  },
  {
    key: "develop",
    label: "Develop",
    href: "/pipeline/develop",
    description: "The response itself: the first draft, the sections, the colour-team reviews, until everyone has signed off.",
    lists: ["pre_proposal", "writing"],
  },
  {
    key: "deliver",
    label: "Deliver",
    href: "/pipeline/deliver",
    description: "Submission: the final PDF, sent from the portal so the record stays in one place.",
    lists: ["submitted"],
  },
  {
    key: "measure",
    label: "Measure",
    href: "/pipeline/measure",
    description: "How it ended: wins, losses, debriefs, and what the next bid learns from them.",
    lists: ["won", "lost", "no_bid"],
  },
] as const;

export function lifecycleStage(key: string): LifecycleStage | null {
  return LIFECYCLE.find((s) => s.key === key) ?? null;
}

export function lifecycleIndex(key: LifecycleKey): number {
  return LIFECYCLE.findIndex((s) => s.key === key);
}

/** Where an opportunity's pipeline stage sits on the lifecycle (the stored keys predate the chevron). */
export function lifecycleForOpportunity(stage: string): LifecycleKey {
  for (const s of LIFECYCLE) if ((s.lists as readonly string[]).includes(stage)) return s.key;
  return "identify";
}

/** Where a proposal's colour-team stage sits: drafting and reviews are Develop, the last review and submission Deliver, the outcome Measure. */
export function lifecycleForProposal(stage: string): LifecycleKey {
  switch (stage) {
    case "white_gloves":
    case "submitted":
      return "deliver";
    case "awarded":
    case "lost":
    case "no_bid":
    case "archived":
      return "measure";
    default:
      return "develop";
  }
}
