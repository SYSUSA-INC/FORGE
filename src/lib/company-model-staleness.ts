import type { CompanyModelBody, CompanyModelSources } from "@/lib/company-model";

/**
 * BL-COMPANY-MODEL phase 1b — what changed since the model was approved.
 * Pure: the cron gathers the counts, this turns them into the reasons a
 * person reads on the Command Center and the Settings page. Nothing
 * here changes the model; a person rebuilds and approves.
 */
export const QUESTIONNAIRE_STALE_MIN_ANSWERS = 5;

export type StalenessSignals = {
  /** Proposal outcomes recorded or changed since approval. */
  outcomesSince: number;
  /** Questionnaires with at least QUESTIONNAIRE_STALE_MIN_ANSWERS confirmed answers, updated since approval. */
  questionnairesSince: number;
  /** Capability entries added or edited since approval. */
  capabilityEntriesSince: number;
  currentPastPerformanceIds: string[];
  currentNaicsCodes: string[];
};

export function computeStaleReasons(sources: CompanyModelSources | null, s: StalenessSignals): string[] {
  const reasons: string[] = [];
  if (s.outcomesSince > 0) reasons.push(`${s.outcomesSince} bid${s.outcomesSince === 1 ? "" : "s"} decided`);
  if (s.questionnairesSince > 0) reasons.push(`${s.questionnairesSince} questionnaire${s.questionnairesSince === 1 ? "" : "s"} confirmed`);
  if (s.capabilityEntriesSince > 0) reasons.push(`${s.capabilityEntriesSince} capability entr${s.capabilityEntriesSince === 1 ? "y" : "ies"} added or edited`);
  if (sources) {
    const before = new Set(sources.pastPerformanceIds);
    const now = new Set(s.currentPastPerformanceIds);
    const added = s.currentPastPerformanceIds.filter((id) => !before.has(id)).length;
    const removed = sources.pastPerformanceIds.filter((id) => !now.has(id)).length;
    if (added || removed) reasons.push(`past performance changed (${added} added, ${removed} removed)`);
    if (sources.naicsCodes) {
      const a = [...sources.naicsCodes].sort().join(",");
      const b = [...s.currentNaicsCodes].sort().join(",");
      if (a !== b) reasons.push("NAICS codes changed");
    }
  }
  return reasons;
}

/** The sections of the draft that differ from the approved body, for the editor's markers. */
export function changedSections(approved: CompanyModelBody | null, draft: CompanyModelBody): Set<keyof CompanyModelBody> {
  const out = new Set<keyof CompanyModelBody>();
  for (const key of Object.keys(draft) as (keyof CompanyModelBody)[]) {
    if (!approved || JSON.stringify(approved[key]) !== JSON.stringify(draft[key])) out.add(key);
  }
  return out;
}
