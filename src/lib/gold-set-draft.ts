/**
 * BL-AIX Phase 1e-2 — AI drafts of a gold document's annotations.
 *
 * The model reads the document a window at a time with the gold-annotation
 * prompt (exhaustive, quoted, nothing invented), and each window's results
 * become `proposed` annotations for the proposal expert to review. Progress
 * is saved after every window, so one call drafts as many windows as fit
 * in its time budget and the next call carries on; text appended later is
 * drafted too.
 *
 * The gold set belongs to the platform, but the gateway meters every call
 * to an organisation, so a draft runs on the acting admin's own
 * organisation (its AI usage, telemetry and token cap). Only public RFP
 * text is sent. Server-only; the caller has checked requireSuperadmin().
 */
import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { extractionGoldDocs, extractionGoldItems, type GoldAiDraftState } from "@/db/schema";
import { completeStructuredForTenant } from "@/lib/ai";
import { buildGoldAnnotatePrompt, goldAnnotateSchema } from "@/lib/ai-prompts";
import { PROMPT_VERSIONS } from "@/lib/ai-prompt-versions";
import { mergeDraftedItems, nextGoldWindow } from "@/lib/gold-set-logic";
import { log } from "@/lib/log";
import { isSameRequirement } from "@/lib/requirements-text";

/** Stop starting new windows after this long, so a call ends well inside the function limit. */
export const GOLD_DRAFT_BUDGET_MS = 120_000;

export type GoldDraftResult =
  | { ok: true; state: GoldAiDraftState; windowsThisRun: number; done: boolean; totalWindows: number }
  | { ok: false; error: string };

export async function draftGoldAnnotations(input: {
  docId: string;
  organizationId: string;
  budgetMs?: number;
  now?: () => number;
}): Promise<GoldDraftResult> {
  const now = input.now ?? Date.now;
  const started = now();
  const budget = input.budgetMs ?? GOLD_DRAFT_BUDGET_MS;

  const [doc] = await db
    .select({ title: extractionGoldDocs.title, rawText: extractionGoldDocs.rawText, status: extractionGoldDocs.status, aiDraft: extractionGoldDocs.aiDraft })
    .from(extractionGoldDocs)
    .where(eq(extractionGoldDocs.id, input.docId))
    .limit(1);
  if (!doc) return { ok: false, error: "Document not found." };
  if (doc.status === "approved") return { ok: false, error: "Reopen the document before drafting more annotations." };

  const state: GoldAiDraftState = { ...doc.aiDraft };
  let windowsThisRun = 0;
  let totalWindows = 0;

  for (;;) {
    const next = nextGoldWindow(doc.rawText, state.doneChars ?? 0);
    if (!next) {
      return { ok: true, state, windowsThisRun, done: true, totalWindows: totalWindows || (state.windowsDone ?? 0) };
    }
    totalWindows = next.count;
    if (windowsThisRun > 0 && now() - started > budget) {
      return { ok: true, state, windowsThisRun, done: false, totalWindows };
    }

    const prompt = buildGoldAnnotatePrompt({
      title: doc.title,
      windowText: doc.rawText.slice(next.window.start, next.window.end),
      windowIndex: next.window.index,
      windowCount: next.count,
    });
    const res = await completeStructuredForTenant({
      organizationId: input.organizationId,
      feature: "gold_annotate",
      schema: goldAnnotateSchema,
      toolName: "record_gold_annotations",
      toolDescription: "Record every requirement, page or format limit and evaluation factor in this window.",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 8000,
      temperature: 0,
      cacheSystem: true,
    });
    if (res.stubbed) return { ok: false, error: "AI is in stub mode, so nothing was drafted. Configure a provider first." };

    if (res.data) {
      const existing = await db
        .select({ kind: extractionGoldItems.kind, text: extractionGoldItems.text, position: extractionGoldItems.position })
        .from(extractionGoldItems)
        .where(eq(extractionGoldItems.docId, input.docId));
      const merged = mergeDraftedItems(res.data, existing, isSameRequirement);
      if (merged.items.length > 0) {
        await db.insert(extractionGoldItems).values(merged.items.map((i) => ({ docId: input.docId, ...i, origin: "ai", status: "proposed" })));
      }
      state.proposed = (state.proposed ?? 0) + merged.items.length;
      state.duplicates = (state.duplicates ?? 0) + merged.duplicates;
    } else {
      // A window whose answer did not validate is counted, not retried: the expert sees it and can redraft.
      log.warn("[draftGoldAnnotations]", "window did not validate", { docId: input.docId, window: next.window.index, parseError: res.parseError });
      state.windowsFailed = (state.windowsFailed ?? 0) + 1;
    }

    windowsThisRun += 1;
    state.doneChars = next.window.end;
    state.windowsDone = (state.windowsDone ?? 0) + 1;
    state.model = res.model;
    state.promptVersion = PROMPT_VERSIONS.gold_annotate;
    state.updatedAt = new Date(now()).toISOString();
    await db
      .update(extractionGoldDocs)
      .set({ aiDraft: state, ...(doc.status === "draft" ? { status: "in_review" } : {}), updatedAt: new Date() })
      .where(eq(extractionGoldDocs.id, input.docId));
  }
}

/** Start the draft over from the beginning; annotations already proposed or reviewed stay. */
export async function resetGoldDraft(docId: string): Promise<void> {
  await db.update(extractionGoldDocs).set({ aiDraft: {}, updatedAt: new Date() }).where(eq(extractionGoldDocs.id, docId));
}
