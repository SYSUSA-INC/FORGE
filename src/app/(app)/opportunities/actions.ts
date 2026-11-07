"use server";

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  memberships,
  opportunities,
  users,
  type OpportunityStage,
  solicitations,
  opportunityActivities,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { dispatchTriggerEvent } from "@/lib/notification-dispatcher";
import { log } from "@/lib/log";
import { isOpportunitySource, normalizeSourceUrl, samNoticeUrl, sourceUrlProblem } from "@/lib/opportunity-source";

export type OpportunityInput = {
  title: string;
  agency?: string;
  office?: string;
  stage?: OpportunityStage;
  solicitationNumber?: string;
  noticeId?: string;
  valueLow?: string;
  valueHigh?: string;
  releaseDate?: string | null;
  responseDueDate?: string | null;
  awardDate?: string | null;
  naicsCode?: string;
  pscCode?: string;
  setAside?: string;
  contractType?: string;
  placeOfPerformance?: string;
  incumbent?: string;
  description?: string;
  pWin?: number;
  ownerUserId?: string | null;
  /** BL-OPP-SOURCE — left out, an update keeps what is there. */
  source?: string;
  sourceUrl?: string;
};

/**
 * The source fields to write: only those given, checked. A SAM.gov
 * opportunity with no link takes its notice's page.
 */
function sourceFields(input: OpportunityInput): { source?: string; sourceUrl?: string } {
  const out: { source?: string; sourceUrl?: string } = {};
  if (input.source !== undefined && isOpportunitySource(input.source)) out.source = input.source;
  if (input.sourceUrl !== undefined) out.sourceUrl = normalizeSourceUrl(input.sourceUrl);
  if (out.source === "samgov" && out.sourceUrl === "") out.sourceUrl = samNoticeUrl(input.noticeId ?? "");
  return out;
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toRow(input: OpportunityInput) {
  return {
    title: input.title.trim(),
    agency: input.agency?.trim() ?? "",
    office: input.office?.trim() ?? "",
    stage: input.stage ?? "identified",
    solicitationNumber: input.solicitationNumber?.trim() ?? "",
    noticeId: input.noticeId?.trim() ?? "",
    valueLow: input.valueLow?.trim() ?? "",
    valueHigh: input.valueHigh?.trim() ?? "",
    releaseDate: parseDate(input.releaseDate ?? null),
    responseDueDate: parseDate(input.responseDueDate ?? null),
    awardDate: parseDate(input.awardDate ?? null),
    naicsCode: input.naicsCode?.trim() ?? "",
    pscCode: input.pscCode?.trim() ?? "",
    setAside: input.setAside?.trim() ?? "",
    contractType: input.contractType?.trim() ?? "",
    placeOfPerformance: input.placeOfPerformance?.trim() ?? "",
    incumbent: input.incumbent?.trim() ?? "",
    description: input.description?.trim() ?? "",
    pWin: typeof input.pWin === "number" ? Math.max(0, Math.min(100, Math.round(input.pWin))) : 0,
    ownerUserId: input.ownerUserId ?? null,
  };
}

export async function createOpportunityAction(
  input: OpportunityInput,
  /** BL-NAV-LIFECYCLE 1a — Create from a document: the solicitation it was read from, linked from birth. */
  from?: { solicitationId: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  if (!input.title?.trim()) {
    return { ok: false, error: "Title is required." };
  }
  const linkProblem = sourceUrlProblem(input.sourceUrl ?? "");
  if (linkProblem) return { ok: false, error: linkProblem };

  // The document must be this organization's, and not already an opportunity's.
  let source: { id: string; fileName: string } | null = null;
  if (from?.solicitationId) {
    const [sol] = await db
      .select({ id: solicitations.id, fileName: solicitations.fileName, opportunityId: solicitations.opportunityId })
      .from(solicitations)
      .where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.id, from.solicitationId)))
      .limit(1);
    if (!sol) return { ok: false, error: "That document is not in this workspace." };
    if (sol.opportunityId) return { ok: false, error: "That document already belongs to an opportunity." };
    source = { id: sol.id, fileName: sol.fileName };
  }

  try {
    const [row] = await db
      .insert(opportunities)
      .values({
        ...toRow(input),
        source: source ? "document" : "manual",
        ...sourceFields(input),
        organizationId,
        createdByUserId: actor.id,
      })
      .returning({ id: opportunities.id });
    if (!row) return { ok: false, error: "Could not create opportunity." };

    if (source) {
      // The document and any amendments already uploaded under it follow the new opportunity.
      await db
        .update(solicitations)
        .set({ opportunityId: row.id, updatedAt: new Date() })
        .where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.id, source.id), isNull(solicitations.opportunityId)));
      await db
        .update(solicitations)
        .set({ opportunityId: row.id, updatedAt: new Date() })
        .where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.parentSolicitationId, source.id), isNull(solicitations.opportunityId)));
      await db.insert(opportunityActivities).values({
        opportunityId: row.id,
        userId: actor.id,
        kind: "note",
        title: "Created from a document",
        body: source.fileName ? `Created on Identify → Create from ${source.fileName}; the document is linked.` : "Created on Identify → Create from an uploaded document; the document is linked.",
      });
      revalidatePath("/solicitations");
    }

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "opportunity.create",
      resourceType: "opportunity",
      resourceId: row.id,
      metadata: { title: input.title, stage: input.stage ?? "identified", from: source ? "document" : "hand", solicitationId: source?.id ?? null },
    });

    revalidatePath("/opportunities");
    revalidatePath("/");
    return { ok: true, id: row.id };
  } catch (err) {
    log.error("[createOpportunityAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Create failed.",
    };
  }
}

export async function updateOpportunityAction(
  id: string,
  input: OpportunityInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  if (!input.title?.trim()) {
    return { ok: false, error: "Title is required." };
  }
  const linkProblem = sourceUrlProblem(input.sourceUrl ?? "");
  if (linkProblem) return { ok: false, error: linkProblem };

  try {
    await db
      .update(opportunities)
      .set({ ...toRow(input), ...sourceFields(input), updatedAt: new Date() })
      .where(
        and(
          eq(opportunities.id, id),
          eq(opportunities.organizationId, organizationId),
        ),
      );
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "opportunity.update",
      resourceType: "opportunity",
      resourceId: id,
      metadata: { title: input.title },
    });
    revalidatePath("/opportunities");
    revalidatePath(`/opportunities/${id}`);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    log.error("[updateOpportunityAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}

export async function setOpportunityStageAction(
  id: string,
  stage: OpportunityStage,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  try {
    await db
      .update(opportunities)
      .set({ stage, updatedAt: new Date() })
      .where(
        and(
          eq(opportunities.id, id),
          eq(opportunities.organizationId, organizationId),
        ),
      );
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "opportunity.advance_stage",
      resourceType: "opportunity",
      resourceId: id,
      metadata: { stage },
    });

    // BL-13 — fire the rules engine. Maps the terminal stages to the
    // narrower closed-state events so rules can target won / lost /
    // no-bid independently of the general "advanced" event.
    const terminalKind =
      stage === "won"
        ? "opportunity_won"
        : stage === "lost"
          ? "opportunity_lost"
          : stage === "no_bid"
            ? "opportunity_no_bid"
            : null;
    await dispatchTriggerEvent({
      organizationId,
      kind: terminalKind ?? "opportunity_advanced",
      payload: { opportunityId: id, stage },
      subject: `Opportunity advanced to ${stage}`,
      linkPath: `/opportunities/${id}`,
      actorUserId: actor.id,
    });

    revalidatePath("/opportunities");
    revalidatePath(`/opportunities/${id}`);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    log.error("[setOpportunityStageAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Stage change failed.",
    };
  }
}

export async function deleteOpportunityAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  try {
    await db
      .delete(opportunities)
      .where(
        and(
          eq(opportunities.id, id),
          eq(opportunities.organizationId, organizationId),
        ),
      );
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "opportunity.delete",
      resourceType: "opportunity",
      resourceId: id,
    });
    revalidatePath("/opportunities");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    log.error("[deleteOpportunityAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Delete failed.",
    };
  }
}

export async function listOpportunityOwners(): Promise<
  { id: string; name: string | null; email: string }[]
> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.status, "active"),
      ),
    )
    .orderBy(asc(users.name), asc(users.email));
  void desc;
  return rows;
}
