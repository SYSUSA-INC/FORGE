"use server";

import { revalidatePath } from "next/cache";
import { PASTE_MAX_CHARS, pasteRefusal } from "@/lib/action-body";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import {
  addManualQa,
  listSolicitationQa,
  pollSolicitationQa,
  type QaIngestResult,
  type QaPollResult,
  type SolicitationQaView,
} from "@/lib/solicitation-qa";

export type { QaIngestResult, QaPollResult, SolicitationQaView };

/** BL-FB-SOL-QA — the solicitation's contracting-officer answers. */
export async function listSolicitationQaAction(solicitationId: string): Promise<SolicitationQaView[]> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return listSolicitationQa({ organizationId, solicitationId: String(solicitationId ?? "") });
}

/** Read the SAM.gov notice now for new Q&A attachments. */
export async function pollSolicitationQaAction(solicitationId: string): Promise<QaPollResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const id = String(solicitationId ?? "");
  const res = await pollSolicitationQa({ organizationId, solicitationId: id, actor: { userId: user.id, email: user.email } });
  // A notice SAM.gov doesn't have is stamped checked: show the new date too.
  if (res.ok || res.cls === "not_found") revalidatePath(`/solicitations/${id}`);
  return res;
}

const QA_PASTE_ADVICE = "Paste the questions and answers in parts.";

/** Paste Q&A received outside SAM.gov. */
export async function addManualQaAction(solicitationId: string, text: string): Promise<QaIngestResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const id = String(solicitationId ?? "");
  const pasted = String(text ?? "");
  // BL-STAB-2f — refused, not cut: answers past the cut were dropped without a word.
  const refusal = pasteRefusal(pasted, PASTE_MAX_CHARS, QA_PASTE_ADVICE);
  if (refusal) return { ok: false, error: refusal };
  const res = await addManualQa({
    organizationId,
    solicitationId: id,
    text: pasted,
    actor: { userId: user.id, email: user.email },
  });
  if (res.ok) revalidatePath(`/solicitations/${id}`);
  return res;
}
