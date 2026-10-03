"use server";

import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { suggestSectionGraphics, type GraphicSuggestion, type SuggestGraphicsResult } from "@/lib/graphics";

export type { GraphicSuggestion, SuggestGraphicsResult };

/** BL-FB-GEN-GRAPHICS — diagrams this section would benefit from. */
export async function suggestSectionGraphicsAction(input: {
  sectionId: string;
  currentBodyPlain?: string;
}): Promise<SuggestGraphicsResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return suggestSectionGraphics({
    organizationId,
    sectionId: String(input.sectionId ?? ""),
    currentBodyPlain: typeof input.currentBodyPlain === "string" ? input.currentBodyPlain.slice(0, 60_000) : undefined,
    actor: { userId: user.id, email: user.email },
  });
}
