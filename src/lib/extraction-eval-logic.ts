/**
 * BL-AIX Phase 1e-3 — scoring FORGE's live extraction against the gold
 * set, kept pure so the measures are unit-tested and stable across runs.
 *
 * For each approved gold document:
 *   requirements  recall = gold requirements the extraction found ÷ gold
 *                 requirements; precision = extracted requirements that
 *                 match a gold one ÷ extracted. One-to-one, greedy.
 *   page limits   share of gold page/format limits captured by an
 *                 extracted requirement or Section L instruction stating
 *                 the same figures.
 *   factors       share of gold Section M factors the review found, and
 *                 how often a pair of found factors keeps the gold order.
 *
 * A match is the Phase 0a requirement matcher, or wording close enough
 * that most of the gold text's content words appear in the extracted text
 * (extraction may trim or lightly reword; it must not lose the substance).
 */

const STOP = new Set(
  "the and for with that this shall must will are its their offeror offerors contractor government proposal section any all from into upon each such been have has may not per".split(" "),
);

export function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9.%$]+/)
      .map((w) => w.replace(/^\.+|\.+$/g, ""))
      .filter((w) => (/\d/.test(w) ? w.length > 0 : w.length >= 3 && !STOP.has(w))),
  );
}

function share(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n += 1;
  return n / a.size;
}

/** Numbers in a text (page counts, font sizes, percentages), normalised. */
export function figures(text: string): string[] {
  return [...new Set((text.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n))))];
}

export function requirementMatches(gold: string, extracted: string, isSame: (a: string, b: string) => boolean): boolean {
  if (isSame(gold, extracted)) return true;
  const g = contentWords(gold);
  const e = contentWords(extracted);
  const goldFigures = figures(gold);
  if (goldFigures.some((f) => !figures(extracted).includes(f))) return false;
  return share(g, e) >= 0.7 && share(e, g) >= 0.4;
}

/** Greedy one-to-one matching: each gold item takes the first unused extracted item it matches. */
export function matchOneToOne(gold: string[], extracted: string[], matches: (g: string, e: string) => boolean): { matchedGold: boolean[]; used: Set<number> } {
  const used = new Set<number>();
  const matchedGold = gold.map((g) => {
    const i = extracted.findIndex((e, j) => !used.has(j) && matches(g, e));
    if (i === -1) return false;
    used.add(i);
    return true;
  });
  return { matchedGold, used };
}

export function pageLimitCaptured(gold: { text: string; value: string }, candidates: string[]): boolean {
  const want = figures(`${gold.value} ${gold.text}`);
  const g = contentWords(gold.text);
  return candidates.some((c) => {
    const have = figures(c);
    return want.every((f) => have.includes(f)) && share(g, contentWords(c)) >= 0.5;
  });
}

export function factorMatches(gold: string, extracted: string): boolean {
  const g = contentWords(gold);
  const e = contentWords(extracted);
  return g.size > 0 && (share(g, e) >= 0.6 || share(e, g) >= 0.8);
}

/** Share of pairs of matched factors whose extracted order agrees with the gold order; null with fewer than two. */
export function orderAgreement(extractedPositions: number[]): number | null {
  let pairs = 0;
  let agree = 0;
  for (let i = 0; i < extractedPositions.length; i++) {
    for (let j = i + 1; j < extractedPositions.length; j++) {
      pairs += 1;
      if (extractedPositions[i]! < extractedPositions[j]!) agree += 1;
    }
  }
  return pairs === 0 ? null : agree / pairs;
}

export type GoldForScoring = {
  requirements: string[];
  pageLimits: { text: string; value: string }[];
  /** In gold order (position ascending). */
  factors: string[];
};

export type ExtractedForScoring = {
  requirements: string[];
  sectionL: string[];
  /** In the order the review listed them. */
  factors: string[];
};

export const MAX_MISSES_KEPT = 40;

export type DocScore = {
  docId: string;
  title: string;
  goldRequirements: number;
  extractedRequirements: number;
  requirementRecall: number | null;
  requirementPrecision: number | null;
  goldPageLimits: number;
  pageLimitCapture: number | null;
  goldFactors: number;
  factorRecall: number | null;
  factorOrder: number | null;
  /** Gold items the extraction missed, for the expert to look at (bounded). */
  missed: { kind: "requirement" | "page_limit" | "eval_factor"; text: string }[];
  windows: number;
  windowsFailed: number;
};

export function scoreDocument(
  doc: { docId: string; title: string; windows: number; windowsFailed: number },
  gold: GoldForScoring,
  got: ExtractedForScoring,
  isSame: (a: string, b: string) => boolean,
): DocScore {
  const req = matchOneToOne(gold.requirements, got.requirements, (g, e) => requirementMatches(g, e, isSame));
  const limits = gold.pageLimits.map((l) => pageLimitCaptured(l, [...got.requirements, ...got.sectionL]));
  const factorHits = gold.factors.map((f) => got.factors.findIndex((e) => factorMatches(f, e)));
  const ratio = (n: number, d: number) => (d === 0 ? null : n / d);

  const missed: DocScore["missed"] = [
    ...gold.requirements.filter((_, i) => !req.matchedGold[i]).map((text) => ({ kind: "requirement" as const, text })),
    ...gold.pageLimits.filter((_, i) => !limits[i]).map((l) => ({ kind: "page_limit" as const, text: l.text })),
    ...gold.factors.filter((_, i) => factorHits[i] === -1).map((text) => ({ kind: "eval_factor" as const, text })),
  ].slice(0, MAX_MISSES_KEPT);

  return {
    docId: doc.docId,
    title: doc.title,
    goldRequirements: gold.requirements.length,
    extractedRequirements: got.requirements.length,
    requirementRecall: ratio(req.matchedGold.filter(Boolean).length, gold.requirements.length),
    requirementPrecision: ratio(req.used.size, got.requirements.length),
    goldPageLimits: gold.pageLimits.length,
    pageLimitCapture: ratio(limits.filter(Boolean).length, gold.pageLimits.length),
    goldFactors: gold.factors.length,
    factorRecall: ratio(factorHits.filter((h) => h !== -1).length, gold.factors.length),
    factorOrder: orderAgreement(factorHits.filter((h) => h !== -1)),
    missed,
    windows: doc.windows,
    windowsFailed: doc.windowsFailed,
  };
}

export type RunSummary = {
  docs: number;
  requirementRecall: number | null;
  requirementPrecision: number | null;
  pageLimitCapture: number | null;
  factorRecall: number | null;
  factorOrder: number | null;
};

/**
 * Pooled over documents: recall and precision count items across all
 * documents (a 400-requirement RFP weighs more than an RFI); the factor
 * order is the mean over documents that have one.
 */
export function summarizeRun(scores: DocScore[]): RunSummary {
  const pooled = (num: (s: DocScore) => number, den: (s: DocScore) => number) => {
    const d = scores.reduce((n, s) => n + den(s), 0);
    return d === 0 ? null : scores.reduce((n, s) => n + num(s), 0) / d;
  };
  const orders = scores.map((s) => s.factorOrder).filter((o): o is number => o !== null);
  return {
    docs: scores.length,
    requirementRecall: pooled((s) => (s.requirementRecall ?? 0) * s.goldRequirements, (s) => s.goldRequirements),
    requirementPrecision: pooled((s) => (s.requirementPrecision ?? 0) * s.extractedRequirements, (s) => s.extractedRequirements),
    pageLimitCapture: pooled((s) => (s.pageLimitCapture ?? 0) * s.goldPageLimits, (s) => s.goldPageLimits),
    factorRecall: pooled((s) => (s.factorRecall ?? 0) * s.goldFactors, (s) => s.goldFactors),
    factorOrder: orders.length === 0 ? null : orders.reduce((a, b) => a + b, 0) / orders.length,
  };
}

/** The steps that read one document: each sweep window, then the review. */
export type EvalStep = { kind: "window"; index: number } | { kind: "review" };

export function stepsFor(windowCount: number): EvalStep[] {
  return [...Array.from({ length: windowCount }, (_, index) => ({ kind: "window" as const, index })), { kind: "review" as const }];
}
