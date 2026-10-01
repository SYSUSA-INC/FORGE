"use server";

import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { listContentBlocks, recordBlockUse, type ContentBlockView } from "@/lib/content-blocks";

/**
 * BL-FB-GEN-BLOCKS — the editor's content-block picker. Any member may
 * list and insert; an insertion bumps the block's reuse counter.
 */
export async function listContentBlocksAction(): Promise<
  { ok: true; blocks: ContentBlockView[] } | { ok: false; error: string }
> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  try {
    return { ok: true, blocks: await listContentBlocks({ organizationId }) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not load content blocks." };
  }
}

export async function recordBlockUseAction(input: {
  entryId: string;
  proposalId: string;
  sectionId: string;
}): Promise<{ ok: true; reuseCount: number } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  try {
    return await recordBlockUse({
      organizationId,
      entryId: String(input.entryId ?? ""),
      proposalId: String(input.proposalId ?? ""),
      sectionId: String(input.sectionId ?? ""),
      actor: { userId: actor.id, email: actor.email },
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not record the insertion." };
  }
}
