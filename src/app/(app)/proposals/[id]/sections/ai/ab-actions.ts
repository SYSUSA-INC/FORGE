"use server";

import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { markABVariantSelected } from "@/lib/draft-signal";
import type { TipTapDoc } from "@/db/schema";
import { generateSectionDraftAction } from "./actions";

// BL-11 — A/B variant comparison. Generates two drafts for the same
// section (standard approach vs. alternative lead-with-strength approach),
// scores them with a lightweight heuristic, and returns both so the user
// can compare and pick one. Sharing the same ab_pair_id in both signal rows
// lets the insights panel compute variant B win rates over time.

export type ABVariant = {
  text: string;
  bodyDoc: TipTapDoc;
  wordCount: number;
  score: number;
  signalId?: string;
};

export type ABDraftResult =
  | {
      ok: true;
      abPairId: string;
      variantA: ABVariant;
      variantB: ABVariant;
      recommended: "a" | "b";
    }
  | { ok: false; error: string };

function scoreVariant(text: string, targetWords: number): number {
  const words = text.match(/\b\w+\b/g) ?? [];
  const wc = words.length;
  if (wc === 0) return 0;
  const uniqueFraction =
    new Set(words.map((w) => w.toLowerCase())).size / wc;
  const lengthFit =
    targetWords > 0
      ? Math.max(0, 1 - Math.abs(wc - targetWords) / targetWords)
      : 0.5;
  return uniqueFraction * 0.45 + lengthFit * 0.35 + (wc > 40 ? 0.2 : 0);
}

export async function generateSectionDraftABAction(input: {
  sectionId: string;
}): Promise<ABDraftResult> {
  await requireAuth();
  await requireCurrentOrg();

  // Stable pair id generated server-side so both signal rows share it.
  const abPairId = crypto.randomUUID();

  const [draftA, draftB] = await Promise.all([
    generateSectionDraftAction({
      sectionId: input.sectionId,
      mode: "draft",
      abPairId,
      abVariant: "a",
    }),
    generateSectionDraftAction({
      sectionId: input.sectionId,
      mode: "draft_alt",
      abPairId,
      abVariant: "b",
    }),
  ]);

  if (!draftA.ok) return { ok: false, error: draftA.error };
  if (!draftB.ok) return { ok: false, error: draftB.error };

  const wordsA = (draftA.text.match(/\b\w+\b/g) ?? []).length;
  const wordsB = (draftB.text.match(/\b\w+\b/g) ?? []).length;
  const targetWords = Math.round((wordsA + wordsB) / 2);

  const scoreA = scoreVariant(draftA.text, targetWords);
  const scoreB = scoreVariant(draftB.text, targetWords);

  return {
    ok: true,
    abPairId,
    variantA: {
      text: draftA.text,
      bodyDoc: draftA.bodyDoc,
      wordCount: wordsA,
      score: scoreA,
      signalId: draftA.signalId,
    },
    variantB: {
      text: draftB.text,
      bodyDoc: draftB.bodyDoc,
      wordCount: wordsB,
      score: scoreB,
      signalId: draftB.signalId,
    },
    recommended: scoreA >= scoreB ? "a" : "b",
  };
}

export async function selectABVariantAction(input: {
  abPairId: string;
  selectedVariant: "a" | "b";
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  try {
    await markABVariantSelected({
      abPairId: input.abPairId,
      organizationId,
      selectedVariant: input.selectedVariant,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to record variant selection.",
    };
  }
}
