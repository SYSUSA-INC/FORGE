/**
 * BL-AIX Phase 1e-3 — run FORGE's live extraction over the approved gold
 * documents and score it (src/lib/extraction-eval-logic.ts).
 *
 * Each document is read exactly as intake reads a solicitation: the same
 * windows through the same requirement-sweep reader, then the solicitation
 * AI review for Section L instructions and Section M factors. A run moves
 * one step (one window, or the review) at a time and saves after each, so
 * a call works inside its time budget and the next call carries on.
 *
 * Measures the full-text sweep, which is what intake keeps whenever it
 * finds at least as many requirements as the front pass. The gold set is
 * a platform asset; the calls are metered to the acting admin's own
 * organisation. Server-only; callers have checked requireSuperadmin().
 */
import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { extractionEvalRuns, extractionGoldDocs, extractionGoldItems, type ExtractionEvalRun } from "@/db/schema";
import { PROMPT_VERSIONS } from "@/lib/ai-prompt-versions";
import { scoreDocument, stepsFor, summarizeRun, type DocScore } from "@/lib/extraction-eval-logic";
import { chunkText, isSameRequirement, mergeRequirementLists, type RequirementLike } from "@/lib/requirements-text";
import { aiRunSolicitationReview } from "@/lib/solicitation-ai-review";
import { MAX_REQUIREMENTS_PER_DOCUMENT, readRequirementsWindow } from "@/lib/solicitation-extract";

export const EVAL_STEP_BUDGET_MS = 120_000;

type Cursor = {
  doc: number;
  step: number;
  lists: RequirementLike[][];
  windowsFailed: number;
};

const freshCursor = (doc: number): Cursor => ({ doc, step: 0, lists: [], windowsFailed: 0 });

export async function listEvalRuns(limit = 10): Promise<ExtractionEvalRun[]> {
  return db.select().from(extractionEvalRuns).orderBy(desc(extractionEvalRuns.createdAt)).limit(limit);
}

/** Start a run over every approved gold document, or return the one still running. */
export async function startExtractionEval(userId: string): Promise<{ ok: true; runId: string; resumed: boolean } | { ok: false; error: string }> {
  const [running] = await db.select({ id: extractionEvalRuns.id }).from(extractionEvalRuns).where(eq(extractionEvalRuns.status, "running")).limit(1);
  if (running) return { ok: true, runId: running.id, resumed: true };
  const docs = await db
    .select({ id: extractionGoldDocs.id })
    .from(extractionGoldDocs)
    .where(eq(extractionGoldDocs.status, "approved"))
    .orderBy(asc(extractionGoldDocs.createdAt));
  if (docs.length === 0) return { ok: false, error: "Approve at least one gold document first." };
  const [row] = await db
    .insert(extractionEvalRuns)
    .values({
      docIds: docs.map((d) => d.id),
      promptVersions: { solicitation_extract: PROMPT_VERSIONS.solicitation_extract, solicitation_review: PROMPT_VERSIONS.solicitation_review },
      cursor: freshCursor(0),
      startedByUserId: userId,
    })
    .returning({ id: extractionEvalRuns.id });
  return row ? { ok: true, runId: row.id, resumed: false } : { ok: false, error: "Could not start the run." };
}

async function goldFor(docId: string) {
  const items = await db
    .select({ kind: extractionGoldItems.kind, text: extractionGoldItems.text, value: extractionGoldItems.value, position: extractionGoldItems.position })
    .from(extractionGoldItems)
    .where(and(eq(extractionGoldItems.docId, docId), eq(extractionGoldItems.status, "approved")))
    .orderBy(asc(extractionGoldItems.position));
  return {
    requirements: items.filter((i) => i.kind === "requirement").map((i) => i.text),
    pageLimits: items.filter((i) => i.kind === "page_limit").map((i) => ({ text: i.text, value: i.value })),
    factors: items.filter((i) => i.kind === "eval_factor").map((i) => i.text),
  };
}

export type EvalStepResult =
  | { ok: true; done: boolean; docsDone: number; docsTotal: number; run: ExtractionEvalRun }
  | { ok: false; error: string };

/** Take steps until the budget is spent (always at least one), saving after each. */
export async function stepExtractionEval(input: {
  runId: string;
  organizationId: string;
  budgetMs?: number;
  now?: () => number;
}): Promise<EvalStepResult> {
  const now = input.now ?? Date.now;
  const started = now();
  const budget = input.budgetMs ?? EVAL_STEP_BUDGET_MS;

  for (let steps = 0; ; steps++) {
    const [run] = await db.select().from(extractionEvalRuns).where(eq(extractionEvalRuns.id, input.runId)).limit(1);
    if (!run) return { ok: false, error: "Run not found." };
    const docsTotal = run.docIds.length;
    const cursor = run.cursor as Cursor;
    const results = run.results as DocScore[];
    const settle = () => ({ ok: true as const, done: run.status !== "running", docsDone: results.length, docsTotal, run });
    if (run.status !== "running") return settle();
    if (steps > 0 && now() - started > budget) return settle();

    const fail = async (error: string): Promise<EvalStepResult> => {
      await db.update(extractionEvalRuns).set({ status: "failed", error, finishedAt: new Date() }).where(eq(extractionEvalRuns.id, run.id));
      return { ok: false, error };
    };

    const docId = run.docIds[cursor.doc];
    if (!docId) {
      await db
        .update(extractionEvalRuns)
        .set({ status: "done", summary: summarizeRun(results), cursor: {}, finishedAt: new Date() })
        .where(eq(extractionEvalRuns.id, run.id));
      continue;
    }
    const [doc] = await db
      .select({ title: extractionGoldDocs.title, rawText: extractionGoldDocs.rawText })
      .from(extractionGoldDocs)
      .where(eq(extractionGoldDocs.id, docId))
      .limit(1);
    if (!doc) {
      // Deleted since the run started: skip it.
      await db.update(extractionEvalRuns).set({ cursor: freshCursor(cursor.doc + 1) }).where(eq(extractionEvalRuns.id, run.id));
      continue;
    }

    const windows = chunkText(doc.rawText);
    const step = stepsFor(windows.length)[cursor.step]!;
    if (step.kind === "window") {
      const w = windows[step.index]!;
      const read = await readRequirementsWindow({
        organizationId: input.organizationId,
        text: w.text,
        index: w.index,
        count: windows.length,
        documentLabel: doc.title,
      });
      if (read.stubbed) return fail("AI is in stub mode, so nothing can be measured. Configure a provider first.");
      const next: Cursor = {
        ...cursor,
        step: cursor.step + 1,
        lists: read.list ? [...cursor.lists, read.list] : cursor.lists,
        windowsFailed: cursor.windowsFailed + (read.list ? 0 : 1),
      };
      await db.update(extractionEvalRuns).set({ cursor: next }).where(eq(extractionEvalRuns.id, run.id));
      continue;
    }

    const review = await aiRunSolicitationReview({ organizationId: input.organizationId, title: doc.title, fileName: doc.title, rawText: doc.rawText });
    if (review.ok && review.stubbed) return fail("AI is in stub mode, so nothing can be measured. Configure a provider first.");
    const extracted = mergeRequirementLists(cursor.lists).slice(0, MAX_REQUIREMENTS_PER_DOCUMENT);
    const score = scoreDocument(
      { docId, title: doc.title, windows: windows.length, windowsFailed: cursor.windowsFailed + (review.ok ? 0 : 1) },
      await goldFor(docId),
      {
        requirements: extracted.map((r) => r.text),
        sectionL: review.ok ? review.data.sectionL : [],
        factors: review.ok ? review.data.evaluationFactors.map((f) => f.name) : [],
      },
      isSameRequirement,
    );
    await db
      .update(extractionEvalRuns)
      .set({ results: [...results, score], cursor: freshCursor(cursor.doc + 1), ...(review.ok ? { model: review.model } : {}) })
      .where(eq(extractionEvalRuns.id, run.id));
  }
}
