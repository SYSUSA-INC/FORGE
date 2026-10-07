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

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { requirementCorrections, solicitations } from "@/db/schema";
import { PROMPT_VERSIONS } from "@/lib/ai-prompt-versions";
import { recordAudit } from "@/lib/audit-log";
import {
  cleanClause,
  docKeyOf,
  originalOf,
  reviewKeyOf,
  type ReviewAction,
  type ReviewedRequirement,
} from "@/lib/requirement-review";
import { requirementKey } from "@/lib/requirements-text";
import { mergeSolicitationRequirements } from "@/lib/solicitation-requirements";

type Actor = { userId: string | null; email?: string | null };
type Result = { ok: true } | { ok: false; error: string };

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
  const target = list.find((r) => docKeyOf(r) === input.docKey && reviewKeyOf(r) === input.originalKey);
  if (!target) return { ok: false, error: "That requirement is no longer on this solicitation." };
  if (target.review?.status === "added") return { ok: false, error: "An added requirement can only be removed." };

  const original = originalOf(target);
  let corrected: Partial<ReviewedRequirement> = {};
  if (input.action === "edited") {
    const clean = cleanClause(input.corrected ?? {});
    if (!clean) return { ok: false, error: "The requirement text can't be empty." };
    corrected = clean;
  }
  await upsert({ organizationId, solicitationId, docKey: input.docKey, originalKey: input.originalKey, action: input.action, original, corrected, userId: input.actor.userId });
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
  if (list.some((r) => docKeyOf(r) === "" && reviewKeyOf(r) === originalKey)) {
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
        eq(requirementCorrections.docKey, input.docKey),
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
  const targets = list.filter((r) => !r.review && r.source?.quote === "exact");
  for (const r of targets) {
    await upsert({ organizationId, solicitationId, docKey: docKeyOf(r), originalKey: reviewKeyOf(r), action: "confirmed", original: originalOf(r), corrected: {}, userId: input.actor.userId });
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
