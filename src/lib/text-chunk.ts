/**
 * Paragraph-aware text chunker for the embeddings pipeline.
 *
 * Strategy:
 *   1. Split on paragraph breaks (double newline) and bullet/list lines.
 *   2. Greedy-pack paragraphs into chunks until we hit `targetChars`.
 *   3. Add `overlapChars` of trailing context from each chunk into the
 *      next so semantic search can match across the seam.
 *   4. If a single paragraph is larger than `targetChars`, hard-split
 *      on sentence boundaries (then on whitespace as a last resort).
 *
 * Chunk size targets ~2000 chars (~500 tokens) — enough context for
 * relevance, small enough to avoid burying the signal in noise.
 */

export type Chunk = {
  index: number;
  content: string;
  charStart: number;
  charEnd: number;
};

export type ChunkOptions = {
  targetChars?: number;
  overlapChars?: number;
  /** Hard cap on a single chunk before sentence/word splitting. */
  maxChars?: number;
};

const DEFAULT_TARGET = 2000;
const DEFAULT_OVERLAP = 200;
const DEFAULT_MAX = 4000;

export function chunkText(
  raw: string,
  opts: ChunkOptions = {},
): Chunk[] {
  const target = opts.targetChars ?? DEFAULT_TARGET;
  const overlap = opts.overlapChars ?? DEFAULT_OVERLAP;
  const max = opts.maxChars ?? DEFAULT_MAX;

  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (text.length === 0) return [];

  // Split into paragraphs while preserving offsets so we can record
  // char_start / char_end per chunk.
  const paragraphs = splitParagraphs(text);

  const chunks: Chunk[] = [];
  let pending: { content: string; start: number; end: number } | null = null;
  let chunkIndex = 0;

  function emit() {
    if (!pending) return;
    chunks.push({
      index: chunkIndex++,
      content: pending.content.trim(),
      charStart: pending.start,
      charEnd: pending.end,
    });
    pending = null;
  }

  for (const p of paragraphs) {
    // Hard-split paragraphs that are themselves too big.
    if (p.content.length > max) {
      emit();
      const subs = hardSplit(p.content, target);
      let cursor = p.start;
      for (const s of subs) {
        chunks.push({
          index: chunkIndex++,
          content: s.trim(),
          charStart: cursor,
          charEnd: cursor + s.length,
        });
        cursor += s.length;
      }
      continue;
    }

    const projectedLength =
      (pending?.content.length ?? 0) + (pending ? 2 : 0) + p.content.length;

    if (pending && projectedLength > target) {
      emit();
    }

    if (!pending) {
      pending = { content: p.content, start: p.start, end: p.end };
    } else {
      pending.content += "\n\n" + p.content;
      pending.end = p.end;
    }
  }
  emit();

  // Apply overlap by prepending the tail of each previous chunk.
  if (overlap > 0 && chunks.length > 1) {
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]!;
      const tail = prev.content.slice(-overlap).trim();
      if (tail) {
        chunks[i] = {
          ...chunks[i]!,
          content: `${tail}\n\n${chunks[i]!.content}`,
        };
      }
    }
  }

  return chunks;
}

function splitParagraphs(
  text: string,
): { content: string; start: number; end: number }[] {
  const out: { content: string; start: number; end: number }[] = [];
  const re = /\n\s*\n/g; // paragraph breaks
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const piece = text.slice(cursor, m.index);
    if (piece.trim().length > 0) {
      out.push({ content: piece.trim(), start: cursor, end: m.index });
    }
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) {
    const piece = text.slice(cursor).trim();
    if (piece.length > 0) {
      out.push({ content: piece, start: cursor, end: text.length });
    }
  }
  return out;
}

/**
 * Split a too-large block on sentence boundaries first, falling back
 * to whitespace + hard cuts. Each output piece is roughly `target`
 * chars.
 */
function hardSplit(content: string, target: number): string[] {
  const sentences = content
    .split(/(?<=[.!?])\s+/g)
    .filter((s) => s.length > 0);
  const out: string[] = [];
  let acc = "";
  for (const s of sentences) {
    if (acc.length + s.length + 1 > target) {
      if (acc) out.push(acc);
      if (s.length > target) {
        // Sentence itself is too big — fall back to whitespace cuts.
        out.push(...wordCut(s, target));
        acc = "";
      } else {
        acc = s;
      }
    } else {
      acc = acc ? acc + " " + s : s;
    }
  }
  if (acc) out.push(acc);
  if (out.length === 0) return [content];
  return out;
}

function wordCut(s: string, target: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += target) {
    out.push(s.slice(i, i + target));
  }
  return out;
}

/**
 * Estimate token count cheaply: ~4 chars per token for English. Used
 * for the chunk row's `token_count` column and rate-limit signaling;
 * we don't need OpenAI's exact tokenizer for that.
 */
export function approxTokenCount(s: string): number {
  return Math.ceil(s.length / 4);
}
