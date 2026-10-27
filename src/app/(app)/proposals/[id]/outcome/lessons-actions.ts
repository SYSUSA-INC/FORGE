"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { opportunities, opportunityLessons, proposals, type Role } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { sanitizeLessonInput } from "@/lib/lessons";
import { draftLessonsForProposal } from "@/lib/lessons-draft";

/**
 * BL-LESSONS-LOOP phase 4a — draft, write, confirm, edit and retire
 * lessons. Confirming is for Capture and Admin roles (the owner's
 * decision 1); anyone on the organization may write one, which lands as
 * proposed unless the writer may confirm.
 */
type Result = { ok: true } | { ok: false; error: string };
const CONFIRM_ROLES: Role[] = ["admin", "capture"];

function mayConfirm(user: { role: Role | null; isSuperadmin: boolean }): boolean {
  return user.isSuperadmin || (!!user.role && CONFIRM_ROLES.includes(user.role));
}

function paths(proposalId: string | null) {
  const out = ["/intelligence/lessons", "/"];
  if (proposalId) out.push(`/proposals/${proposalId}/outcome`);
  return out;
}

export async function draftLessonsAction(input: { proposalId: string }): Promise<{ ok: true; drafted: number; skipped: number } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!mayConfirm(user)) return { ok: false, error: "Capture or Admin role needed to draft lessons." };
  const res = await draftLessonsForProposal({ organizationId, proposalId: input.proposalId, actor: { userId: user.id, email: user.email } });
  if (res.ok) for (const p of paths(input.proposalId)) revalidatePath(p);
  return res;
}

export async function createLessonAction(input: { proposalId: string; text: string; kind: string; appliesTo?: unknown }): Promise<Result> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const clean = sanitizeLessonInput({ text: input.text, kind: input.kind, appliesTo: input.appliesTo });
  if (!clean) return { ok: false, error: "Write the lesson out (at least a short sentence)." };
  const [row] = await db
    .select({ opportunityId: proposals.opportunityId })
    .from(proposals)
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .where(and(eq(proposals.id, input.proposalId), eq(proposals.organizationId, organizationId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!row) return { ok: false, error: "Proposal not found." };
  const confirmed = mayConfirm(user);
  const now = new Date();
  const [inserted] = await db
    .insert(opportunityLessons)
    .values({
      organizationId,
      opportunityId: row.opportunityId,
      proposalId: input.proposalId,
      source: "manual",
      kind: clean.kind,
      text: clean.text,
      appliesTo: clean.appliesTo,
      evidence: [],
      status: confirmed ? "confirmed" : "proposed",
      confirmedByUserId: confirmed ? user.id : null,
      confirmedAt: confirmed ? now : null,
      createdByUserId: user.id,
    })
    .returning({ id: opportunityLessons.id });
  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "opportunity.lesson.create",
    resourceType: "opportunity",
    resourceId: row.opportunityId,
    metadata: { lessonId: inserted?.id, proposalId: input.proposalId, kind: clean.kind, confirmed },
  });
  for (const p of paths(input.proposalId)) revalidatePath(p);
  return { ok: true };
}

async function loadLesson(lessonId: string, organizationId: string) {
  const [row] = await db
    .select()
    .from(opportunityLessons)
    .where(and(eq(opportunityLessons.id, lessonId), eq(opportunityLessons.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function confirmLessonAction(input: { lessonId: string; text?: string; kind?: string; appliesTo?: unknown }): Promise<Result> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!mayConfirm(user)) return { ok: false, error: "Capture or Admin role needed to confirm a lesson." };
  const row = await loadLesson(input.lessonId, organizationId);
  if (!row) return { ok: false, error: "Lesson not found." };
  const clean = sanitizeLessonInput({ text: input.text ?? row.text, kind: input.kind ?? row.kind, appliesTo: input.appliesTo ?? row.appliesTo });
  if (!clean) return { ok: false, error: "Write the lesson out (at least a short sentence)." };
  const now = new Date();
  await db
    .update(opportunityLessons)
    .set({ text: clean.text, kind: clean.kind, appliesTo: clean.appliesTo, status: "confirmed", confirmedByUserId: user.id, confirmedAt: now, updatedAt: now })
    .where(and(eq(opportunityLessons.id, row.id), eq(opportunityLessons.organizationId, organizationId)));
  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "opportunity.lesson.confirm",
    resourceType: "opportunity",
    resourceId: row.opportunityId,
    metadata: { lessonId: row.id, edited: clean.text !== row.text || clean.kind !== row.kind },
  });
  for (const p of paths(row.proposalId)) revalidatePath(p);
  return { ok: true };
}

export async function updateLessonAction(input: { lessonId: string; text: string; kind: string; appliesTo?: unknown }): Promise<Result> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!mayConfirm(user)) return { ok: false, error: "Capture or Admin role needed to edit a lesson." };
  const row = await loadLesson(input.lessonId, organizationId);
  if (!row) return { ok: false, error: "Lesson not found." };
  const clean = sanitizeLessonInput({ text: input.text, kind: input.kind, appliesTo: input.appliesTo ?? row.appliesTo });
  if (!clean) return { ok: false, error: "Write the lesson out (at least a short sentence)." };
  await db
    .update(opportunityLessons)
    .set({ text: clean.text, kind: clean.kind, appliesTo: clean.appliesTo, updatedAt: new Date() })
    .where(and(eq(opportunityLessons.id, row.id), eq(opportunityLessons.organizationId, organizationId)));
  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "opportunity.lesson.edit",
    resourceType: "opportunity",
    resourceId: row.opportunityId,
    metadata: { lessonId: row.id },
  });
  for (const p of paths(row.proposalId)) revalidatePath(p);
  return { ok: true };
}

export async function retireLessonAction(input: { lessonId: string }): Promise<Result> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!mayConfirm(user)) return { ok: false, error: "Capture or Admin role needed to retire a lesson." };
  const row = await loadLesson(input.lessonId, organizationId);
  if (!row) return { ok: false, error: "Lesson not found." };
  await db
    .update(opportunityLessons)
    .set({ status: "retired", updatedAt: new Date() })
    .where(and(eq(opportunityLessons.id, row.id), eq(opportunityLessons.organizationId, organizationId)));
  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "opportunity.lesson.retire",
    resourceType: "opportunity",
    resourceId: row.opportunityId,
    metadata: { lessonId: row.id, wasStatus: row.status },
  });
  for (const p of paths(row.proposalId)) revalidatePath(p);
  return { ok: true };
}
