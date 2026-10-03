"use server";

import { revalidatePath } from "next/cache";
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
  if (res.ok) revalidatePath(`/solicitations/${id}`);
  return res;
}

/** Paste Q&A received outside SAM.gov. */
export async function addManualQaAction(solicitationId: string, text: string): Promise<QaIngestResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const id = String(solicitationId ?? "");
  const res = await addManualQa({
    organizationId,
    solicitationId: id,
    text: String(text ?? "").slice(0, 200_000),
    actor: { userId: user.id, email: user.email },
  });
  if (res.ok) revalidatePath(`/solicitations/${id}`);
  return res;
}
