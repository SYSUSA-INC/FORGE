import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { sectionDraftSignals } from "@/db/schema";
import { shingleRetention, shouldResolveDraft } from "@/lib/ai-acceptance";

function wordTokenize(text: string): string[] {
  return text.toLowerCase().match(/\b\w+\b/g) ?? [];
}

export async function recordDraftSignal(input: {
  organizationId: string;
  proposalId: string;
  sectionId: string;
  createdByUserId: string;
  mode: string;
  sectionKind: string;
  draftText: string;
  stubbed: boolean;
  abPairId?: string;
  abVariant?: "a" | "b";
}): Promise<string> {
  const wordCount = wordTokenize(input.draftText).length;
  const [row] = await db
    .insert(sectionDraftSignals)
    .values({
      organizationId: input.organizationId,
      proposalId: input.proposalId,
      sectionId: input.sectionId,
      createdByUserId: input.createdByUserId,
      mode: input.mode,
      sectionKind: input.sectionKind,
      draftText: input.draftText,
      draftWordCount: wordCount,
      stubbed: input.stubbed,
      abPairId: input.abPairId ?? null,
      abVariant: input.abVariant ?? null,
    })
    .returning({ id: sectionDraftSignals.id });
  return row.id;
}

/**
 * BL-AIX Phase 0b — grade the newest pending AI draft against what was
 * saved, by four-word runs kept (`shingleRetention`), once the owner has
 * finished with it: no tracked suggestions still open and at least half
 * an hour after it was produced. Until then the draft stays pending and
 * a later save grades it.
 */
export async function resolveDraftSignal(input: {
  sectionId: string;
  organizationId: string;
  savedText: string;
  savedHasPendingChanges: boolean;
  now?: Date;
}): Promise<void> {
  const [signal] = await db
    .select({
      id: sectionDraftSignals.id,
      draftText: sectionDraftSignals.draftText,
      createdAt: sectionDraftSignals.createdAt,
    })
    .from(sectionDraftSignals)
    .where(
      and(
        eq(sectionDraftSignals.sectionId, input.sectionId),
        eq(sectionDraftSignals.organizationId, input.organizationId),
        isNull(sectionDraftSignals.acceptedFraction),
      ),
    )
    .orderBy(desc(sectionDraftSignals.createdAt))
    .limit(1);
  if (!signal) return;
  const now = input.now ?? new Date();
  if (!shouldResolveDraft({ draftCreatedAt: signal.createdAt, now, savedHasPendingChanges: input.savedHasPendingChanges })) return;

  const { fraction, keptWords } = shingleRetention(signal.draftText, input.savedText);
  await db
    .update(sectionDraftSignals)
    .set({ acceptedFraction: fraction, acceptedWordCount: keptWords, resolvedAt: now })
    .where(and(eq(sectionDraftSignals.organizationId, input.organizationId), eq(sectionDraftSignals.id, signal.id)));
}

export async function markABVariantSelected(input: {
  abPairId: string;
  organizationId: string;
  selectedVariant: "a" | "b";
}): Promise<void> {
  const rows = await db
    .select({ id: sectionDraftSignals.id, abVariant: sectionDraftSignals.abVariant })
    .from(sectionDraftSignals)
    .where(
      and(
        eq(sectionDraftSignals.abPairId, input.abPairId),
        eq(sectionDraftSignals.organizationId, input.organizationId),
      ),
    );
  for (const row of rows) {
    await db
      .update(sectionDraftSignals)
      .set({ selected: row.abVariant === input.selectedVariant })
      .where(and(eq(sectionDraftSignals.organizationId, input.organizationId), eq(sectionDraftSignals.id, row.id)));
  }
}
