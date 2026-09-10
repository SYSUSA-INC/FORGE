import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { sectionDraftSignals } from "@/db/schema";

function wordTokenize(text: string): string[] {
  return text.toLowerCase().match(/\b\w+\b/g) ?? [];
}

export function computeWordOverlap(
  aiText: string,
  savedText: string,
): { fraction: number; acceptedWordCount: number } {
  const aiWords = wordTokenize(aiText);
  if (aiWords.length === 0) return { fraction: 0, acceptedWordCount: 0 };
  const savedSet = new Set(wordTokenize(savedText));
  const kept = aiWords.filter((w) => savedSet.has(w)).length;
  return { fraction: kept / aiWords.length, acceptedWordCount: kept };
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

export async function resolveDraftSignal(input: {
  sectionId: string;
  organizationId: string;
  savedText: string;
}): Promise<void> {
  const [signal] = await db
    .select({
      id: sectionDraftSignals.id,
      draftText: sectionDraftSignals.draftText,
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

  const { fraction, acceptedWordCount } = computeWordOverlap(
    signal.draftText,
    input.savedText,
  );
  await db
    .update(sectionDraftSignals)
    .set({ acceptedFraction: fraction, acceptedWordCount, resolvedAt: new Date() })
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
