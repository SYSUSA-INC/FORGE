"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { log } from "@/lib/log";
import { draftCharter } from "@/lib/plan-charter-draft";
import { isAgreementStatus } from "@/lib/plan-charter-logic";
import { reopenCharter, saveBudgetAndCutoffs, saveCharter, saveRisks, setAgreement, setAgreementFile, signCharter } from "@/lib/plan-charter-store";
import { listPlanMembers } from "@/lib/plan-store";
import { claimUpload, finishClaim, releaseClaim, releaseStoredFile } from "@/lib/uploads";

type Result = { ok: true; note?: string } | { ok: false; error: string };

function refresh(opportunityId: string) {
  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath(`/opportunities/${opportunityId}/plan`);
  revalidatePath("/pipeline/plan");
}

async function who() {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return { organizationId, actor: { userId: actor.id, email: actor.email, name: actor.name } };
}

/** BL-NAV-LIFECYCLE 4c-1 — save the manager's charter words. */
export async function saveCharterAction(input: { opportunityId: string; charter: unknown }): Promise<Result> {
  const { organizationId, actor } = await who();
  const res = await saveCharter({ organizationId, opportunityId: String(input?.opportunityId ?? ""), charter: input?.charter, actor });
  if (!res.ok) return res;
  refresh(input.opportunityId);
  return { ok: true, note: res.unsigned ? "Saved. The sign-off was withdrawn because the charter changed." : undefined };
}

export async function draftCharterAction(input: { opportunityId: string }): Promise<Result> {
  const { organizationId, actor } = await who();
  const res = await draftCharter({ organizationId, opportunityId: String(input?.opportunityId ?? ""), actor: { userId: actor.userId, email: actor.email } });
  if (!res.ok) return res;
  refresh(input.opportunityId);
  return { ok: true, note: res.dropped > 0 ? `${res.dropped} claim${res.dropped === 1 ? "" : "s"} did not rest on the records and ${res.dropped === 1 ? "was" : "were"} left out.` : undefined };
}

export async function signCharterAction(input: { opportunityId: string }): Promise<Result> {
  const { organizationId, actor } = await who();
  const res = await signCharter({ organizationId, opportunityId: String(input?.opportunityId ?? ""), actor });
  if (!res.ok) return res;
  refresh(input.opportunityId);
  return { ok: true, note: res.wroteThemes ? `Signed. ${res.wroteThemes} win theme${res.wroteThemes === 1 ? "" : "s"} written to the proposal.` : undefined };
}

export async function reopenCharterAction(input: { opportunityId: string }): Promise<Result> {
  const { organizationId, actor } = await who();
  const res = await reopenCharter({ organizationId, opportunityId: String(input?.opportunityId ?? ""), actor });
  if (res.ok) refresh(input.opportunityId);
  return res;
}

export async function setAgreementAction(input: { opportunityId: string; status: string; date: string | null }): Promise<Result> {
  const { organizationId, actor } = await who();
  const status = String(input?.status ?? "");
  if (!isAgreementStatus(status)) return { ok: false, error: "Choose to do, in negotiation or signed." };
  const res = await setAgreement({ organizationId, opportunityId: String(input?.opportunityId ?? ""), status, date: input?.date ? String(input.date) : null, actor });
  if (res.ok) refresh(input.opportunityId);
  return res;
}

/** The agreement's file, uploaded straight to storage with uploadFile() and filed here by its upload id (convention 11). */
export async function attachAgreementFileAction(input: { opportunityId: string; uploadId: string }): Promise<Result> {
  const { organizationId, actor } = await who();
  const opportunityId = String(input?.opportunityId ?? "");
  const claim = await claimUpload({ organizationId, userId: actor.userId, uploadId: String(input?.uploadId ?? ""), resourceType: "plan_agreement" });
  if (!claim.ok) return { ok: false, error: claim.error };
  if ("alreadyClaimed" in claim) return { ok: true };
  const file = claim.claim;
  try {
    const res = await setAgreementFile({ organizationId, opportunityId, fileName: file.fileName, storageKey: file.storageKey, size: file.size, actor });
    if (!res.ok) {
      await releaseClaim({ organizationId, uploadId: file.uploadId, claimedAt: file.claimedAt });
      return res;
    }
    await finishClaim({ organizationId, uploadId: file.uploadId, claimedAt: file.claimedAt });
    if (res.replacedKey && res.replacedKey !== file.storageKey) await releaseStoredFile({ organizationId, storagePath: res.replacedKey, reason: "replaced" });
  } catch (err) {
    log.error("[attachAgreementFileAction]", "filing failed", { error: err });
    await releaseClaim({ organizationId, uploadId: file.uploadId, claimedAt: file.claimedAt });
    return { ok: false, error: "Could not record the file; try again." };
  }
  refresh(opportunityId);
  return { ok: true };
}

export async function saveBudgetAction(input: { opportunityId: string; hours: string; dollars: string; qaCutoff: string | null; amendmentCutoff: string | null }): Promise<Result> {
  const { organizationId, actor } = await who();
  const res = await saveBudgetAndCutoffs({
    organizationId,
    opportunityId: String(input?.opportunityId ?? ""),
    hours: input?.hours ?? "",
    dollars: input?.dollars ?? "",
    qaCutoff: input?.qaCutoff ? String(input.qaCutoff) : null,
    amendmentCutoff: input?.amendmentCutoff ? String(input.amendmentCutoff) : null,
    actor,
  });
  if (res.ok) refresh(input.opportunityId);
  return res;
}

export async function saveRisksAction(input: { opportunityId: string; risks: unknown }): Promise<Result> {
  const { organizationId, actor } = await who();
  const members = await listPlanMembers(organizationId);
  const res = await saveRisks({ organizationId, opportunityId: String(input?.opportunityId ?? ""), risks: input?.risks, memberIds: new Set(members.map((m) => m.id)), actor });
  if (res.ok) refresh(input.opportunityId);
  return res;
}
