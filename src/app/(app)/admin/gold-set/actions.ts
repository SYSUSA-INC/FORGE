"use server";

import { revalidatePath } from "next/cache";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import {
  addGoldItem,
  appendGoldDocText,
  createGoldDocFromNotice,
  createGoldDocFromText,
  decideGoldItem,
  deleteGoldDoc,
  searchGoldDocText,
  setGoldDocApproved,
  updateGoldItem,
} from "@/lib/gold-set";
import { startExtractionEval, stepExtractionEval } from "@/lib/extraction-eval";
import { draftGoldAnnotations, resetGoldDraft } from "@/lib/gold-set-draft";
import { isGoldItemStatus, type TextHit } from "@/lib/gold-set-logic";
import { cleanModelChoice } from "@/lib/model-choice";
import { log } from "@/lib/log";

/**
 * BL-AIX Phase 1e — managing the extraction gold set. Platform admins
 * only: the gold set is a platform asset (public RFPs, no tenant data).
 * Each change is audited under the acting admin's own organisation when
 * they have one, and logged otherwise (the promo-code pattern).
 */

type Actor = Awaited<ReturnType<typeof requireSuperadmin>>;
type Done = { ok: true } | { ok: false; error: string };

async function audit(
  actor: Actor,
  action: string,
  resourceId: string,
  metadata: Record<string, unknown> = {},
  resourceType = "extraction_gold_doc",
) {
  if (actor.organizationId) {
    await recordAudit({
      organizationId: actor.organizationId,
      actor: { userId: actor.id, email: actor.email },
      action,
      resourceType,
      resourceId,
      metadata,
    });
  } else {
    log.info("[gold-set]", action, { actorUserId: actor.id, resourceId, ...metadata });
  }
}

function refresh(docId?: string) {
  revalidatePath("/admin/gold-set");
  if (docId) revalidatePath(`/admin/gold-set/${docId}`);
}

export async function createGoldDocFromNoticeAction(noticeId: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  if (!noticeId.trim()) return { ok: false, error: "Enter a SAM.gov notice ID." };
  const res = await createGoldDocFromNotice({ noticeId, userId: actor.id });
  if (!res.ok) return res;
  await audit(actor, "gold_set.doc.create", res.id, { source: "samgov", noticeId: noticeId.trim(), files: res.files.length });
  refresh();
  return { ok: true, id: res.id };
}

export async function createGoldDocFromTextAction(input: {
  title: string;
  text: string;
  noticeId?: string;
  sourceUrl?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  const res = await createGoldDocFromText({ ...input, userId: actor.id });
  if (!res.ok) return res;
  await audit(actor, "gold_set.doc.create", res.id, { source: "pasted", chars: input.text.length });
  refresh();
  return { ok: true, id: res.id };
}

export async function appendGoldDocTextAction(input: { docId: string; name: string; text: string }): Promise<Done> {
  const actor = await requireSuperadmin();
  const res = await appendGoldDocText(input);
  if (!res.ok) return res;
  await audit(actor, "gold_set.doc.append_text", input.docId, { name: input.name, chars: res.chars });
  refresh(input.docId);
  return { ok: true };
}

export async function addGoldItemAction(input: {
  docId: string;
  kind: string;
  ref: string;
  text: string;
  value: string;
  position: number;
}): Promise<Done> {
  const actor = await requireSuperadmin();
  const { docId, ...item } = input;
  const res = await addGoldItem({ docId, item, userId: actor.id });
  if (!res.ok) return res;
  await audit(actor, "gold_set.item.add", docId, { itemId: res.id, kind: item.kind });
  refresh(docId);
  return { ok: true };
}

export async function updateGoldItemAction(input: {
  itemId: string;
  kind: string;
  ref: string;
  text: string;
  value: string;
  position: number;
}): Promise<Done> {
  const actor = await requireSuperadmin();
  const { itemId, ...item } = input;
  const res = await updateGoldItem({ itemId, item, userId: actor.id });
  if (!res.ok) return res;
  await audit(actor, "gold_set.item.edit", res.docId, { itemId, kind: item.kind });
  refresh(res.docId);
  return { ok: true };
}

export async function decideGoldItemAction(input: { itemId: string; status: string }): Promise<Done> {
  const actor = await requireSuperadmin();
  if (!isGoldItemStatus(input.status)) return { ok: false, error: "Unknown decision." };
  const res = await decideGoldItem({ itemId: input.itemId, status: input.status, userId: actor.id });
  if (!res.ok) return res;
  await audit(actor, "gold_set.item.decide", res.docId, { itemId: input.itemId, status: input.status });
  refresh(res.docId);
  return { ok: true };
}

export async function setGoldDocApprovedAction(input: { docId: string; approved: boolean }): Promise<Done> {
  const actor = await requireSuperadmin();
  const res = await setGoldDocApproved({ ...input, userId: actor.id });
  if (!res.ok) return res;
  await audit(actor, input.approved ? "gold_set.doc.approve" : "gold_set.doc.reopen", input.docId, {
    approved: res.progress.approved,
    rejected: res.progress.rejected,
  });
  refresh(input.docId);
  return { ok: true };
}

export async function deleteGoldDocAction(docId: string): Promise<Done> {
  const actor = await requireSuperadmin();
  const res = await deleteGoldDoc(docId);
  if (!res.ok) return res;
  await audit(actor, "gold_set.doc.delete", docId, { title: res.title });
  refresh();
  return { ok: true };
}

/** Read-only: find where a phrase appears in the document's text. */
export async function searchGoldDocTextAction(input: { docId: string; query: string }): Promise<TextHit[]> {
  await requireSuperadmin();
  return searchGoldDocText(input.docId, input.query);
}

/**
 * BL-AIX Phase 1e-2 — draft annotations with AI for as long as one call's
 * budget allows; the page calls again until the whole text is read. Usage
 * is metered to the acting admin's own organisation.
 */
export async function draftGoldAnnotationsAction(docId: string): Promise<
  { ok: true; done: boolean; windowsDone: number; totalWindows: number; proposed: number } | { ok: false; error: string }
> {
  const actor = await requireSuperadmin();
  if (!actor.organizationId) {
    return { ok: false, error: "AI calls are metered to an organisation and your account has none. Use a platform admin account that belongs to one." };
  }
  try {
    const res = await draftGoldAnnotations({ docId, organizationId: actor.organizationId });
    if (!res.ok) return res;
    if (res.windowsThisRun > 0) {
      await audit(actor, "gold_set.ai_draft", docId, {
        windows: res.windowsThisRun,
        windowsDone: res.state.windowsDone,
        totalWindows: res.totalWindows,
        proposed: res.state.proposed,
        model: res.state.model,
        promptVersion: res.state.promptVersion,
      });
    }
    refresh(docId);
    return { ok: true, done: res.done, windowsDone: res.state.windowsDone ?? 0, totalWindows: res.totalWindows, proposed: res.state.proposed ?? 0 };
  } catch (err) {
    log.warn("[draftGoldAnnotationsAction]", "draft failed", { docId, error: err });
    refresh(docId);
    return { ok: false, error: `The AI draft stopped: ${err instanceof Error ? err.message : String(err)}. Progress so far is kept; try again.` };
  }
}

export async function resetGoldDraftAction(docId: string): Promise<Done> {
  const actor = await requireSuperadmin();
  await resetGoldDraft(docId);
  await audit(actor, "gold_set.ai_draft_reset", docId);
  refresh(docId);
  return { ok: true };
}

/**
 * BL-AIX Phase 1e-3 — run the live extraction over the approved gold
 * documents. Start (or resume the running run), then step until done;
 * the page keeps calling. Metered to the acting admin's own organisation.
 */
export async function runExtractionEvalAction(candidateModel?: string): Promise<
  { ok: true; done: boolean; docsDone: number; docsTotal: number } | { ok: false; error: string }
> {
  const actor = await requireSuperadmin();
  if (!actor.organizationId) {
    return { ok: false, error: "AI calls are metered to an organisation and your account has none. Use a platform admin account that belongs to one." };
  }
  // BL-AIX Phase 1i-2 — a candidate model for this run only; defaults never change here.
  const model = cleanModelChoice(candidateModel);
  if (model === null) return { ok: false, error: "That is not a model id." };
  const started = await startExtractionEval(actor.id, model);
  if (!started.ok) return started;
  if (!started.resumed) await audit(actor, "gold_set.eval.start", started.runId, { requestedModel: model }, "extraction_eval_run");
  try {
    const res = await stepExtractionEval({ runId: started.runId, organizationId: actor.organizationId });
    if (!res.ok) return res;
    if (res.done && res.run.status === "done") {
      await audit(actor, "gold_set.eval.finish", started.runId, { summary: res.run.summary, promptVersions: res.run.promptVersions, model: res.run.model }, "extraction_eval_run");
    }
    refresh();
    return { ok: true, done: res.done, docsDone: res.docsDone, docsTotal: res.docsTotal };
  } catch (err) {
    log.warn("[runExtractionEvalAction]", "step failed", { runId: started.runId, error: err });
    return { ok: false, error: `The run paused: ${err instanceof Error ? err.message : String(err)}. Progress is kept; run it again to continue.` };
  }
}
