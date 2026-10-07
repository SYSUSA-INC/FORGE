/**
 * BL-AIP-5b — proposal bootstrap from Section L.
 *
 * A new proposal used to start from a template's section list no
 * matter what the solicitation asked for; page limits, the due date and
 * win themes were typed in by hand later, if at all. This reads the
 * parsed solicitation's instructions to offerors (Section L summary,
 * the instructions stretch of the document, Section M, the extracted
 * requirements and key dates) and turns them into the outline the
 * offeror must submit: sections in the instructed order with their
 * page caps and a brief of what each must contain, the due date, and
 * proposed win themes grounded in the evaluation factors.
 *
 *   plan  → one structured AI call (feature `proposal_bootstrap`)
 *   apply → sections inserted / refreshed / dropped without ever
 *           removing written text (`planSectionsForRebuild`), themes
 *           seeded when the proposal has none, the opportunity's due
 *           date set when it has none, the plan stored on the proposal
 *
 * Every read and write is scoped by organizationId. Server-only;
 * callers own auth, feature gating and quota.
 */
import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  organizations,
  proposalSections,
  proposals,
  solicitationDocuments,
  solicitations,
  type ProposalBootstrapRecord,
} from "@/db/schema";
import { completeStructuredForTenant } from "@/lib/ai";
import {
  buildProposalBootstrapPrompt,
  PROPOSAL_BOOTSTRAP_PROMPT_VERSION,
  proposalBootstrapSchema,
} from "@/lib/ai-prompts";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";
import {
  normalizeBootstrapPlan,
  outlineRequirements,
  planSectionsForRebuild,
  sectionLWindow,
  type BootstrapPlan,
} from "@/lib/proposal-bootstrap-plan";
import { loadOpportunityRequirements } from "@/lib/solicitation-requirements";
import { describeLmForOutline, mergeLmStructures } from "@/lib/solicitation-lm";

const BOOTSTRAP_MAX_TOKENS = 4000;

export type BootstrapPlanResult =
  | { ok: true; plan: BootstrapPlan; stubbed: boolean; model: string }
  | { ok: false; error: string };

export type BootstrapApplyResult =
  | { ok: true; record: ProposalBootstrapRecord }
  | { ok: false; error: string };

/** True when the opportunity has a parsed solicitation with instructions. */
export async function opportunityHasSectionL(input: {
  organizationId: string;
  opportunityId: string;
}): Promise<boolean> {
  const { organizationId } = input;
  const rows = await db
    .select({ sectionLSummary: solicitations.sectionLSummary, rawText: solicitations.rawText })
    .from(solicitations)
    .where(
      and(
        eq(solicitations.organizationId, organizationId),
        eq(solicitations.opportunityId, input.opportunityId),
        eq(solicitations.parseStatus, "parsed"),
      ),
    )
    .limit(10);
  return rows.some((r) => r.sectionLSummary.trim().length > 0 || sectionLWindow(r.rawText) !== "");
}

/** One structured AI call: the outline Section L asks for. */
export async function planProposalFromSolicitation(input: {
  organizationId: string;
  opportunityId: string;
}): Promise<BootstrapPlanResult> {
  const { organizationId, opportunityId } = input;

  const [opp] = await db
    .select({
      title: opportunities.title,
      agency: opportunities.agency,
      solicitationNumber: opportunities.solicitationNumber,
      naicsCode: opportunities.naicsCode,
      setAside: opportunities.setAside,
      responseDueDate: opportunities.responseDueDate,
    })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!opp) return { ok: false, error: "Opportunity not found." };

  const [orgRow] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const loaded = await loadOpportunityRequirements({ organizationId, opportunityId });

  const sols = await db
    .select({
      id: solicitations.id,
      rawText: solicitations.rawText,
      lmStructure: solicitations.lmStructure,
      keyDates: solicitations.keyDates,
      responseDueDate: solicitations.responseDueDate,
    })
    .from(solicitations)
    .where(
      and(
        eq(solicitations.organizationId, organizationId),
        eq(solicitations.opportunityId, opportunityId),
        eq(solicitations.parseStatus, "parsed"),
      ),
    )
    .orderBy(desc(solicitations.updatedAt))
    .limit(10);

  let sectionLText = "";
  for (const s of sols) {
    const win = sectionLWindow(s.rawText);
    if (win.length > sectionLText.length) sectionLText = win;
  }
  // BL-AIX Phase 2b — Sections L and M as read at intake: the newest
  // solicitation's own first, then its companion documents'.
  const docLm =
    sols.length === 0
      ? []
      : await db
          .select({ lmStructure: solicitationDocuments.lmStructure })
          .from(solicitationDocuments)
          .where(
            and(
              eq(solicitationDocuments.organizationId, organizationId),
              inArray(
                solicitationDocuments.solicitationId,
                sols.map((s) => s.id),
              ),
              eq(solicitationDocuments.parseStatus, "parsed"),
            ),
          );
  const structuredLm = describeLmForOutline(
    mergeLmStructures([...sols.map((s) => s.lmStructure), ...docLm.map((d) => d.lmStructure)]),
  );
  const keyDates = sols
    .flatMap((s) => (s.keyDates ?? []).map((d) => ({ label: d.label, isoDate: d.isoDate ?? null, type: d.type })))
    .slice(0, 20);
  const responseDueDate =
    opp.responseDueDate?.toISOString().slice(0, 10) ??
    sols.find((s) => s.responseDueDate)?.responseDueDate?.toISOString().slice(0, 10) ??
    null;

  if (!loaded.sectionLSummary && !sectionLText && !structuredLm && loaded.requirements.length === 0) {
    return {
      ok: false,
      error: "No parsed solicitation with instructions to offerors on this opportunity yet.",
    };
  }

  const prompt = buildProposalBootstrapPrompt({
    organizationName: orgRow?.name ?? "the offeror",
    opportunity: {
      title: opp.title,
      agency: opp.agency,
      solicitationNumber: opp.solicitationNumber,
      naicsCode: opp.naicsCode,
      setAside: opp.setAside,
    },
    sectionLSummary: loaded.sectionLSummary,
    sectionMSummary: loaded.sectionMSummary,
    sectionLText,
    structuredLm,
    requirements: outlineRequirements(loaded.requirements),
    keyDates,
    responseDueDate,
  });

  const res = await completeStructuredForTenant({
    organizationId,
    feature: "proposal_bootstrap",
    promptVersion: PROPOSAL_BOOTSTRAP_PROMPT_VERSION,
    schema: proposalBootstrapSchema,
    toolName: "record_proposal_outline",
    toolDescription: "Record the proposal outline the instructions to offerors ask for.",
    system: prompt.system,
    messages: prompt.messages,
    maxTokens: BOOTSTRAP_MAX_TOKENS,
    temperature: 0,
    cacheSystem: true,
  });
  if (res.stubbed) {
    return { ok: false, error: "The AI provider is in stub mode — the outline was not built." };
  }
  if (!res.data) {
    return { ok: false, error: res.parseError ?? "The model returned no outline." };
  }
  const plan = normalizeBootstrapPlan(res.data);
  if (plan.sections.length === 0) {
    return { ok: false, error: "The model found no sections in the instructions to offerors." };
  }
  return { ok: true, plan, stubbed: false, model: res.model };
}

/**
 * Write a plan onto a proposal. Written sections are never removed; an
 * empty section the instructions do not ask for is dropped; a section
 * with the same title takes the plan's page cap and brief.
 */
export async function applyProposalBootstrap(input: {
  organizationId: string;
  proposalId: string;
  plan: BootstrapPlan;
  mode: "create" | "rebuild";
  stubbed?: boolean;
  actor: { userId: string | null; email?: string | null };
}): Promise<BootstrapApplyResult> {
  const { organizationId, proposalId, plan } = input;

  const [prop] = await db
    .select({
      id: proposals.id,
      opportunityId: proposals.opportunityId,
      winThemes: proposals.winThemes,
    })
    .from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  if (!prop) return { ok: false, error: "Proposal not found." };

  const existing = await db
    .select({
      id: proposalSections.id,
      title: proposalSections.title,
      wordCount: proposalSections.wordCount,
      pageLimit: proposalSections.pageLimit,
      instructions: proposalSections.instructions,
    })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId))
    .orderBy(asc(proposalSections.ordering));

  const diff = planSectionsForRebuild(existing, plan.sections);
  const now = new Date();

  for (const u of diff.update) {
    await db
      .update(proposalSections)
      .set({ pageLimit: u.pageLimit, instructions: u.instructions, ordering: u.ordering, updatedAt: now })
      .where(and(eq(proposalSections.id, u.id), eq(proposalSections.proposalId, proposalId)));
  }
  for (const k of diff.keep) {
    await db
      .update(proposalSections)
      .set({ ordering: k.ordering, updatedAt: now })
      .where(and(eq(proposalSections.id, k.id), eq(proposalSections.proposalId, proposalId)));
  }
  if (diff.remove.length > 0) {
    await db
      .delete(proposalSections)
      .where(
        and(
          eq(proposalSections.proposalId, proposalId),
          inArray(proposalSections.id, diff.remove),
          eq(proposalSections.wordCount, 0),
        ),
      );
  }
  if (diff.insert.length > 0) {
    await db.insert(proposalSections).values(
      diff.insert.map((s) => ({
        proposalId,
        kind: s.kind,
        title: s.title,
        ordering: s.ordering,
        pageLimit: s.pageLimit,
        instructions: s.instructions,
      })),
    );
  }

  // Themes: only when the proposal has none — a team's own themes win.
  let themesSeeded = false;
  if ((prop.winThemes ?? []).length === 0 && plan.proposedThemes.length > 0) {
    await db
      .update(proposals)
      .set({
        winThemes: plan.proposedThemes.map((t) => ({ title: t.title, statement: t.statement })),
        updatedAt: now,
      })
      .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)));
    themesSeeded = true;
  }

  // Due date: only when the opportunity has none.
  let dueDateSet = false;
  if (plan.dueDate) {
    const [opp] = await db
      .select({ responseDueDate: opportunities.responseDueDate })
      .from(opportunities)
      .where(and(eq(opportunities.id, prop.opportunityId), eq(opportunities.organizationId, organizationId)))
      .limit(1);
    if (opp && !opp.responseDueDate) {
      await db
        .update(opportunities)
        .set({ responseDueDate: new Date(`${plan.dueDate}T00:00:00Z`), updatedAt: now })
        .where(and(eq(opportunities.id, prop.opportunityId), eq(opportunities.organizationId, organizationId)));
      dueDateSet = true;
    }
  }

  const record: ProposalBootstrapRecord = {
    promptVersion: PROPOSAL_BOOTSTRAP_PROMPT_VERSION,
    generatedAt: now.toISOString(),
    stubbed: !!input.stubbed,
    sections: plan.sections,
    dueDate: plan.dueDate,
    proposedThemes: plan.proposedThemes,
    notes: plan.notes,
    applied: {
      mode: input.mode,
      sectionsInserted: diff.insert.length,
      sectionsUpdated: diff.update.length,
      sectionsRemoved: diff.remove.length,
      sectionsKept: diff.keep.length,
      themesSeeded,
      dueDateSet,
    },
  };
  await db
    .update(proposals)
    .set({ bootstrap: record, updatedAt: now })
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)));

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "proposal.bootstrap",
    resourceType: "proposal",
    resourceId: proposalId,
    metadata: { ...record.applied, sections: plan.sections.length, promptVersion: record.promptVersion },
  });

  return { ok: true, record };
}

/** Plan + apply for a proposal that already exists. */
export async function bootstrapProposal(input: {
  organizationId: string;
  proposalId: string;
  mode: "create" | "rebuild";
  actor: { userId: string | null; email?: string | null };
}): Promise<BootstrapApplyResult> {
  const { organizationId, proposalId } = input;
  const [prop] = await db
    .select({ opportunityId: proposals.opportunityId })
    .from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  if (!prop) return { ok: false, error: "Proposal not found." };

  const planned = await planProposalFromSolicitation({ organizationId, opportunityId: prop.opportunityId });
  if (!planned.ok) {
    log.info("[bootstrapProposal]", "no outline", { proposalId, error: planned.error });
    return planned;
  }
  return applyProposalBootstrap({
    organizationId,
    proposalId,
    plan: planned.plan,
    mode: input.mode,
    stubbed: planned.stubbed,
    actor: input.actor,
  });
}
