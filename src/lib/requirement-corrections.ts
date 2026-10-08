/**
 * BL-AIX Phase 2c — store a person's verdict on an extracted requirement
 * and apply it to the solicitation's list.
 *
 * A verdict is one `requirement_correction` row per (solicitation,
 * document, extracted wording); a new verdict replaces the old and an
 * undo deletes it. After every change the solicitation's list is rebuilt
 * by `mergeSolicitationRequirements`, which applies all the
 * solicitation's corrections, so the same happens after any re-parse.
 *
 * Server-only. Every read and write is scoped by organizationId; callers
 * own auth.
 */
import "server-only";

import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { requirementCorrections, solicitations } from "@/db/schema";
import { PROMPT_VERSIONS } from "@/lib/ai-prompt-versions";
import { recordAudit } from "@/lib/audit-log";
import {
  applyOpportunityVerdicts,
  cleanClause,
  originalOf,
  reviewKeyOf,
  type ReviewAction,
  type ReviewedRequirement,
} from "@/lib/requirement-review";
import { requirementKey } from "@/lib/requirements-text";
import { mergeSolicitationRequirements } from "@/lib/solicitation-requirements";

type Actor = { userId: string | null; email?: string | null };
type Result = { ok: true } | { ok: false; error: string };

/**
 * The solicitation's list with the verdicts of the other solicitations on
 * its opportunity carried onto it (`review.carried`), as every reader sees
 * it. The verify screen shows carried verdicts and the bulk confirm skips
 * them, so an amendment cannot quietly undo a rejection made on its base.
 */
export async function opportunityView(input: {
  organizationId: string;
  solicitationId: string;
  list: ReviewedRequirement[];
}): Promise<ReviewedRequirement[]> {
  const [row] = await db
    .select({ opportunityId: solicitations.opportunityId })
    .from(solicitations)
    .where(and(eq(solicitations.organizationId, input.organizationId), eq(solicitations.id, input.solicitationId)))
    .limit(1);
  if (!row?.opportunityId) return input.list;
  const others = await db
    .select({ list: solicitations.extractedRequirements })
    .from(solicitations)
    .where(
      and(
        eq(solicitations.organizationId, input.organizationId),
        eq(solicitations.opportunityId, row.opportunityId),
        ne(solicitations.id, input.solicitationId),
      ),
    )
    .orderBy(desc(solicitations.createdAt));
  if (others.length === 0) return input.list;
  return applyOpportunityVerdicts([input.list, ...others.map((o) => (o.list ?? []) as ReviewedRequirement[])])[0]!;
}

async function currentList(organizationId: string, solicitationId: string): Promise<ReviewedRequirement[] | null> {
  const [row] = await db
    .select({ list: solicitations.extractedRequirements })
    .from(solicitations)
    .where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.id, solicitationId)))
    .limit(1);
  return row ? ((row.list ?? []) as ReviewedRequirement[]) : null;
}

async function upsert(input: {
  organizationId: string;
  solicitationId: string;
  docKey: string;
  originalKey: string;
  action: ReviewAction;
  original: Partial<ReviewedRequirement>;
  corrected: Partial<ReviewedRequirement>;
  userId: string | null;
}): Promise<void> {
  // One verdict per wording: drop any recorded under a document by an earlier version.
  await db
    .delete(requirementCorrections)
    .where(
      and(
        eq(requirementCorrections.organizationId, input.organizationId),
        eq(requirementCorrections.solicitationId, input.solicitationId),
        eq(requirementCorrections.originalKey, input.originalKey),
        ne(requirementCorrections.docKey, input.docKey),
      ),
    );
  const values = {
    organizationId: input.organizationId,
    solicitationId: input.solicitationId,
    docKey: input.docKey,
    originalKey: input.originalKey,
    action: input.action,
    original: { kind: input.original.kind, text: input.original.text, ref: input.original.ref },
    corrected: { kind: input.corrected.kind, text: input.corrected.text, ref: input.corrected.ref },
    promptVersion: PROMPT_VERSIONS.solicitation_extract,
    userId: input.userId,
    updatedAt: new Date(),
  };
  await db
    .insert(requirementCorrections)
    .values(values)
    .onConflictDoUpdate({
      target: [
        requirementCorrections.organizationId,
        requirementCorrections.solicitationId,
        requirementCorrections.docKey,
        requirementCorrections.originalKey,
      ],
      set: { action: values.action, original: values.original, corrected: values.corrected, promptVersion: values.promptVersion, userId: values.userId, updatedAt: values.updatedAt },
    });
}

/**
 * Confirm, edit or reject one extracted requirement, found by its
 * document and extracted wording. An edit needs the corrected clause.
 */
export async function reviewRequirement(input: {
  organizationId: string;
  solicitationId: string;
  actor: Actor;
  docKey: string;
  originalKey: string;
  action: "confirmed" | "edited" | "rejected";
  corrected?: { kind?: string; text?: string; ref?: string };
}): Promise<Result> {
  const { organizationId, solicitationId } = input;
  const list = await currentList(organizationId, solicitationId);
  if (!list) return { ok: false, error: "Solicitation not found." };
  // Verdicts follow the extracted wording, whichever document states it.
  const target = list.find((r) => reviewKeyOf(r) === input.originalKey);
  if (!target) return { ok: false, error: "That requirement is no longer on this solicitation." };
  if (target.review?.status === "added") return { ok: false, error: "An added requirement can only be removed." };

  const original = originalOf(target);
  let corrected: Partial<ReviewedRequirement> = {};
  if (input.action === "edited") {
    const clean = cleanClause(input.corrected ?? {});
    if (!clean) return { ok: false, error: "The requirement text can't be empty." };
    corrected = clean;
  }
  await upsert({ organizationId, solicitationId, docKey: "", originalKey: input.originalKey, action: input.action, original, corrected, userId: input.actor.userId });
  await mergeSolicitationRequirements(solicitationId, organizationId);
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "solicitation.requirement.review",
    resourceType: "solicitation",
    resourceId: solicitationId,
    metadata: { verdict: input.action, docKey: input.docKey, original: original.text.slice(0, 200), ...(input.action === "edited" ? { corrected: corrected.text?.slice(0, 200) } : {}) },
  });
  return { ok: true };
}

/** Add a clause the extraction missed to the solicitation's own list. */
export async function addRequirement(input: {
  organizationId: string;
  solicitationId: string;
  actor: Actor;
  clause: { kind?: string; text?: string; ref?: string };
}): Promise<Result> {
  const { organizationId, solicitationId } = input;
  const list = await currentList(organizationId, solicitationId);
  if (!list) return { ok: false, error: "Solicitation not found." };
  const clean = cleanClause(input.clause);
  if (!clean) return { ok: false, error: "The requirement text can't be empty." };
  const originalKey = requirementKey(clean.text);
  if (list.some((r) => reviewKeyOf(r) === originalKey)) {
    return { ok: false, error: "That requirement is already on the list." };
  }
  await upsert({ organizationId, solicitationId, docKey: "", originalKey, action: "added", original: {}, corrected: clean, userId: input.actor.userId });
  await mergeSolicitationRequirements(solicitationId, organizationId);
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "solicitation.requirement.add",
    resourceType: "solicitation",
    resourceId: solicitationId,
    metadata: { text: clean.text.slice(0, 200), ref: clean.ref },
  });
  return { ok: true };
}

/** Undo a verdict: the requirement returns to its extracted wording, or an added one is removed. */
export async function clearRequirementReview(input: {
  organizationId: string;
  solicitationId: string;
  actor: Actor;
  docKey: string;
  originalKey: string;
}): Promise<Result> {
  const { organizationId, solicitationId } = input;
  if (!(await currentList(organizationId, solicitationId))) return { ok: false, error: "Solicitation not found." };
  const removed = await db
    .delete(requirementCorrections)
    .where(
      and(
        eq(requirementCorrections.organizationId, organizationId),
        eq(requirementCorrections.solicitationId, solicitationId),
        eq(requirementCorrections.originalKey, input.originalKey),
      ),
    )
    .returning({ action: requirementCorrections.action });
  if (removed.length === 0) return { ok: false, error: "Nothing to undo." };
  await mergeSolicitationRequirements(solicitationId, organizationId);
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "solicitation.requirement.review_undo",
    resourceType: "solicitation",
    resourceId: solicitationId,
    metadata: { undone: removed[0]!.action, docKey: input.docKey },
  });
  return { ok: true };
}

/** Confirm every requirement not yet reviewed that the document states word for word. */
export async function confirmVerbatimRequirements(input: {
  organizationId: string;
  solicitationId: string;
  actor: Actor;
}): Promise<{ ok: true; confirmed: number } | { ok: false; error: string }> {
  const { organizationId, solicitationId } = input;
  const list = await currentList(organizationId, solicitationId);
  if (!list) return { ok: false, error: "Solicitation not found." };
  // A clause rejected or edited on another solicitation of the opportunity is not confirmed here.
  const view = await opportunityView({ organizationId, solicitationId, list });
  const targets = view.filter((r) => !r.review && r.source?.quote === "exact");
  for (const r of targets) {
    await upsert({ organizationId, solicitationId, docKey: "", originalKey: reviewKeyOf(r), action: "confirmed", original: originalOf(r), corrected: {}, userId: input.actor.userId });
  }
  if (targets.length > 0) {
    await mergeSolicitationRequirements(solicitationId, organizationId);
    await recordAudit({
      organizationId,
      actor: input.actor,
      action: "solicitation.requirement.review",
      resourceType: "solicitation",
      resourceId: solicitationId,
      metadata: { verdict: "confirmed", bulk: true, count: targets.length },
    });
  }
  return { ok: true, confirmed: targets.length };
}
