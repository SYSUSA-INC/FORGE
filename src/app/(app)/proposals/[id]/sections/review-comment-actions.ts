"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { setReviewCommentResolved } from "@/lib/section-review-comments";

/**
 * BL-AIP-6b — resolve a colour-team review comment from the editor.
 * Same write and audit as the review page's toggle, recorded as coming
 * from the editor.
 */
export async function resolveSectionReviewCommentAction(
  commentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await setReviewCommentResolved({
    organizationId,
    commentId: String(commentId ?? ""),
    resolved: true,
    actor: { userId: actor.id, email: actor.email },
    via: "editor",
  });
  if (!res.ok) return res;
  revalidatePath(`/proposals/${res.proposalId}/sections`);
  revalidatePath(`/proposals/${res.proposalId}/reviews/${res.reviewId}`);
  return { ok: true };
}
