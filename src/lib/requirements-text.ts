/**
 * BL-AIP-5 — requirements-first pipeline, the pure parts.
 *
 * The intake prompt used to ask for "the 25 most important" requirements
 * from the first 80k characters; the drafter got those 25 for the whole
 * proposal, the scan saw 20 at 200 characters. Everything downstream was
 * reasoning about a sample. This module holds the text mechanics that
 * let the pipeline see the whole document:
 *
 *   - chunkText: split a long document into overlapping windows the
 *     model can read in full, one call per window.
 *   - dedupeRequirements / jaccard: merge requirement lists from several
 *     windows (and several companion documents) without repeating the
 *     same clause. Moved here from the document actions so every merge
 *     uses one rule.
 *   - categoryFromRef: map an RFP reference to a compliance category.
 *
 * Pure: no DB, no server-only, unit-tested.
 */

export type RequirementKind = "shall" | "should" | "may";

export type RequirementLike = {
  kind: RequirementKind;
  text: string;
  ref: string;
  sourceDocId?: string;
};

export type TextChunk = {
  index: number;
  /** 0-based character offset of the chunk in the source text. */
  start: number;
  end: number;
  text: string;
};

export type ChunkOptions = {
  /** Target characters per chunk. */
  chunkChars: number;
  /** Characters repeated from the previous chunk so a clause split at the boundary is seen whole once. */
  overlapChars: number;
};

/** ~60k characters is ~15k tokens: one window a standard model reads in full with room to answer. */
export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { chunkChars: 60_000, overlapChars: 2_000 };

/** Hard ceiling on windows per document so a 2 MB text dump cannot fan out into hundreds of calls. */
export const MAX_CHUNKS_PER_DOCUMENT = 12;

/**
 * Split `text` into windows. Boundaries prefer a paragraph break, then a
 * line break, then a sentence end inside the last 15% of the window so a
 * requirement is not cut mid-sentence. Never returns an empty chunk.
 */
export function chunkText(text: string, options: ChunkOptions = DEFAULT_CHUNK_OPTIONS): TextChunk[] {
  const src = text ?? "";
  if (!src.trim()) return [];
  const size = Math.max(1_000, Math.floor(options.chunkChars));
  const overlap = Math.min(Math.max(0, Math.floor(options.overlapChars)), Math.floor(size / 4));
  if (src.length <= size) return [{ index: 0, start: 0, end: src.length, text: src }];

  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < src.length && chunks.length < MAX_CHUNKS_PER_DOCUMENT) {
    let end = Math.min(src.length, start + size);
    if (end < src.length) {
      const windowStart = start + Math.floor(size * 0.85);
      const slice = src.slice(windowStart, end);
      const cut =
        lastIndexOfAny(slice, ["\n\n"]) ??
        lastIndexOfAny(slice, ["\n"]) ??
        lastIndexOfAny(slice, [". ", "; "]);
      if (cut !== null) end = windowStart + cut + 1;
    }
    chunks.push({ index: chunks.length, start, end, text: src.slice(start, end) });
    if (end >= src.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

function lastIndexOfAny(haystack: string, needles: string[]): number | null {
  let best = -1;
  for (const n of needles) {
    const i = haystack.lastIndexOf(n);
    if (i > best) best = i + n.length - 1;
  }
  return best >= 0 ? best : null;
}

const JACCARD_THRESHOLD = 0.6;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2),
  );
}

/** Token-set similarity of two requirement texts, 0..1. */
export function jaccard(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Append `incoming` to `base`, dropping any candidate whose text is a
 * near-duplicate (Jaccard ≥ 0.6) of something already kept. Order is
 * preserved so the first sighting of a clause wins.
 */
export function dedupeRequirements<T extends { text: string }>(base: T[], incoming: T[]): T[] {
  const result = [...base];
  for (const candidate of incoming) {
    const isDup = result.some((existing) => jaccard(existing.text, candidate.text) >= JACCARD_THRESHOLD);
    if (!isDup) result.push(candidate);
  }
  return result;
}

/** Merge several lists (e.g. one per chunk) into one de-duplicated list. */
export function mergeRequirementLists<T extends { text: string }>(lists: T[][]): T[] {
  let out: T[] = [];
  for (const list of lists) out = dedupeRequirements(out, list);
  return out;
}

const KINDS: readonly RequirementKind[] = ["shall", "should", "may"];

/** Coerce a model-returned requirement list into the stored shape; drops empties and caps length. */
export function normalizeRequirementList(
  raw: unknown,
  limits: { maxItems: number; maxTextChars?: number } = { maxItems: 200 },
): RequirementLike[] {
  if (!Array.isArray(raw)) return [];
  const maxText = limits.maxTextChars ?? 1_000;
  const out: RequirementLike[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    const text = typeof rec.text === "string" ? rec.text.replace(/\s+/g, " ").trim().slice(0, maxText) : "";
    if (!text) continue;
    const kindRaw = typeof rec.kind === "string" ? rec.kind.toLowerCase() : "";
    const kind = (KINDS as readonly string[]).includes(kindRaw)
      ? (kindRaw as RequirementKind)
      : kindRaw === "must" || kindRaw === "will"
        ? "shall"
        : "shall";
    const ref = typeof rec.ref === "string" ? rec.ref.trim().slice(0, 64) : "";
    out.push({ kind, text, ref });
    if (out.length >= limits.maxItems) break;
  }
  return out;
}

export type RequirementCategory = "section_l" | "section_m" | "section_c" | "far_clause" | "other";

/**
 * Where an RFP reference points: "L.5.2.1" → Section L, "M-3" → Section M,
 * "C.3" / "PWS 2.1" / "SOW" → Section C, "52.204-21" / "FAR" → FAR clause.
 */
export function categoryFromRef(ref: string, text = ""): RequirementCategory {
  const r = (ref ?? "").trim().toUpperCase();
  if (/^(SECTION\s*)?L\b/.test(r) || /^L[.\-\s]/.test(r)) return "section_l";
  if (/^(SECTION\s*)?M\b/.test(r) || /^M[.\-\s]/.test(r)) return "section_m";
  if (/^(SECTION\s*)?C\b/.test(r) || /^C[.\-\s]/.test(r) || /^(PWS|SOW|SOO)\b/.test(r)) return "section_c";
  if (/^(FAR|DFARS)\b/.test(r) || /^\d{1,2}\.\d{3}(-\d+)?/.test(r)) return "far_clause";
  const t = (text ?? "").toLowerCase();
  if (/\bevaluat(ed|ion)\b|\bfactor\b|\bweight/.test(t)) return "section_m";
  if (/\bsubmit|\bpage limit|\bfont\b|\bvolume\b|\bformat\b/.test(t)) return "section_l";
  return "other";
}

/** Build the stable key used to spot a requirement that is already a compliance item. */
export function requirementKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
