/**
 * BL-AIP-6 — research while you write.
 *
 * On a debounce, for the section and the paragraph the writer is in:
 *   - Brain hits (corpus + curated, won boost) for the paragraph
 *   - matrix rows mapped to this section the draft does not cover yet
 *   - win themes the draft does not reinforce yet
 *   - contradictions the last health scan raised involving this section
 *
 * One embedding call per refresh (metered `embedding_query`); the
 * coverage checks are lexical (`research-signals.ts`) so the rail never
 * spends a completion. Server-only; scoped by organizationId.
 */
import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceItems,
  opportunities,
  proposalScanResults,
  proposalSections,
  proposals,
} from "@/db/schema";
import { searchBrain, type BrainHit } from "@/lib/brain-retrieval";
import { itemsNotCovered } from "@/lib/research-signals";
import { log } from "@/lib/log";

export type ResearchRailResult = {
  hits: BrainHit[];
  unaddressed: { id: string; number: string; text: string; coverage: number; missingTerms: string[] }[];
  missingThemes: { title: string; statement: string; coverage: number; missingTerms: string[] }[];
  contradictions: {
    otherSectionTitle: string;
    claim1: string;
    claim2: string;
    explanation: string;
    severity: "high" | "medium" | "low";
  }[];
  stubbed: boolean;
  /** Set when the Brain lookup was skipped or declined. */
  brainNote?: string;
};

const HITS = 4;
const FOCUS_CHARS = 600;

export async function gatherResearchForSection(input: {
  organizationId: string;
  sectionId: string;
  /** The whole section as plain text. */
  text: string;
  /** The paragraph under the cursor. */
  focus: string;
}): Promise<ResearchRailResult | null> {
  const { organizationId } = input;
  const [row] = await db
    .select({
      sectionTitle: proposalSections.title,
      sectionKind: proposalSections.kind,
      proposalId: proposals.id,
      winThemes: proposals.winThemes,
      agency: opportunities.agency,
      naicsCode: opportunities.naicsCode,
    })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .where(and(eq(proposalSections.id, input.sectionId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  if (!row) return null;

  const [mapped, scan] = await Promise.all([
    db
      .select({
        id: complianceItems.id,
        number: complianceItems.number,
        requirementText: complianceItems.requirementText,
        status: complianceItems.status,
      })
      .from(complianceItems)
      .where(and(eq(complianceItems.proposalId, row.proposalId), eq(complianceItems.proposalSectionId, input.sectionId)))
      .orderBy(asc(complianceItems.ordering))
      .limit(60),
    db
      .select({ contradictions: proposalScanResults.contradictions })
      .from(proposalScanResults)
      .where(and(eq(proposalScanResults.proposalId, row.proposalId), eq(proposalScanResults.organizationId, organizationId)))
      .limit(1),
  ]);

  const text = input.text ?? "";
  const unaddressed = itemsNotCovered(
    text,
    mapped
      .filter((m) => m.status !== "complete" && m.status !== "not_applicable")
      .map((m) => ({ id: m.id, number: m.number, text: m.requirementText })),
    { max: 6 },
  ).map((m) => ({ id: m.id, number: m.number, text: m.text.slice(0, 300), coverage: m.coverage, missingTerms: m.missingTerms }));

  const missingThemes = itemsNotCovered(
    text,
    (row.winThemes ?? []).slice(0, 3).map((t) => ({ title: t.title ?? "", statement: t.statement ?? "", text: `${t.title ?? ""} ${t.statement ?? ""}` })),
    { max: 3, threshold: 0.3 },
  ).map((t) => ({ title: t.title, statement: t.statement, coverage: t.coverage, missingTerms: t.missingTerms }));

  const contradictions = (scan[0]?.contradictions ?? [])
    .filter((c) => c.section1Id === input.sectionId || c.section2Id === input.sectionId)
    .slice(0, 4)
    .map((c) => ({
      otherSectionTitle: c.section1Id === input.sectionId ? c.section2Title : c.section1Title,
      claim1: c.section1Id === input.sectionId ? c.claim1 : c.claim2,
      claim2: c.section1Id === input.sectionId ? c.claim2 : c.claim1,
      explanation: c.explanation,
      severity: c.severity,
    }));

  let hits: BrainHit[] = [];
  let stubbed = false;
  let brainNote: string | undefined;
  const focus = (input.focus || text).trim().slice(0, FOCUS_CHARS);
  if (focus.length >= 40) {
    const query = [
      focus,
      `Section: ${row.sectionTitle} (${row.sectionKind.replace(/_/g, " ")})`,
      row.agency ? `Agency: ${row.agency}` : "",
      row.naicsCode ? `NAICS ${row.naicsCode}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const res = await searchBrain({ organizationId, query, take: HITS });
      if (res.ok) {
        hits = res.hits;
        stubbed = res.stubbed;
      } else {
        brainNote = res.error;
      }
    } catch (err) {
      log.warn("[research-rail]", "brain search failed", { error: err });
      brainNote = "Brain lookup failed.";
    }
  } else {
    brainNote = "Write a little more in this paragraph to search the Brain.";
  }

  return { hits, unaddressed, missingThemes, contradictions, stubbed, brainNote };
}
