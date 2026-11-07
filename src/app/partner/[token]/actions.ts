"use server";

import { loadPartnerMatrixByToken, savePartnerAnswersByToken, type PartnerMatrixView } from "@/lib/partner-invite-store";
import type { InviteState } from "@/lib/partner-invite-logic";

/**
 * BL-NAV-LIFECYCLE phase 3c — the partner's side of the matrix, reached by
 * a personal emailed link with no FORGE account. The unguessable token is
 * the credential: it finds one invite, whose organization scopes every
 * read and write behind it.
 */
export async function loadPartnerMatrixAction(token: string): Promise<{ ok: true; view: PartnerMatrixView } | { ok: false; error: string }> {
  return loadPartnerMatrixByToken(String(token ?? ""));
}

export async function savePartnerAnswersAction(input: { token: string; answers: unknown; certifications: unknown; submit: boolean }): Promise<{ ok: true; state: InviteState } | { ok: false; error: string }> {
  return savePartnerAnswersByToken({ token: String(input?.token ?? ""), answers: input?.answers, certifications: input?.certifications, submit: input?.submit === true });
}
