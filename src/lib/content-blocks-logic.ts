/**
 * BL-FB-GEN-BLOCKS — reusable content blocks, pure parts.
 *
 * A content block is a boilerplate knowledge entry: the company
 * overview, the security posture statement, the transition risk
 * methodology — anything the team used to copy out of a shared
 * "boilerplate.docx". The library makes them insertable into any
 * section by tag and version-controlled with a changelog. This module
 * holds the version delta, the changelog line and the picker's filter,
 * so all three are unit-tested.
 */

export type EntryState = { title: string; body: string; tags: string[] };

export type VersionDelta = {
  wordsAdded: number;
  wordsRemoved: number;
  titleChanged: boolean;
  bodyChanged: boolean;
  tagsChanged: boolean;
  changed: boolean;
};

function wordCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []) {
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return counts;
}

export function countWords(text: string): number {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []).length;
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  const norm = (list: readonly string[]) => [...new Set(list.map((t) => t.trim().toLowerCase()).filter(Boolean))].sort();
  const x = norm(a);
  const y = norm(b);
  return x.length === y.length && x.every((t, i) => t === y[i]);
}

/** Words added and removed between two bodies (multiset difference), plus what else changed. */
export function versionDelta(previous: EntryState, next: EntryState): VersionDelta {
  const before = wordCounts(previous.body);
  const after = wordCounts(next.body);
  let wordsAdded = 0;
  let wordsRemoved = 0;
  for (const [w, n] of after) wordsAdded += Math.max(0, n - (before.get(w) ?? 0));
  for (const [w, n] of before) wordsRemoved += Math.max(0, n - (after.get(w) ?? 0));
  const titleChanged = previous.title.trim() !== next.title.trim();
  const bodyChanged = previous.body.trim() !== next.body.trim();
  const tagsChanged = !sameTags(previous.tags, next.tags);
  return { wordsAdded, wordsRemoved, titleChanged, bodyChanged, tagsChanged, changed: titleChanged || bodyChanged || tagsChanged };
}

/** "+12 / −4 words · title · tags" for the changelog row. */
export function describeDelta(d: Pick<VersionDelta, "wordsAdded" | "wordsRemoved" | "titleChanged" | "tagsChanged">): string {
  const parts: string[] = [];
  if (d.wordsAdded || d.wordsRemoved) parts.push(`+${d.wordsAdded} / −${d.wordsRemoved} words`);
  if (d.titleChanged) parts.push("title");
  if (d.tagsChanged) parts.push("tags");
  return parts.join(" · ");
}

export type ContentBlockView = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  reuseCount: number;
  /** Latest version number, 0 when the entry predates version history. */
  version: number;
  updatedAt: string;
};

/** Blocks whose title, body or tags contain every query token, optionally carrying `tag`. */
export function filterBlocks<T extends { title: string; body: string; tags: string[] }>(
  blocks: readonly T[],
  filter: { query?: string; tag?: string | null },
): T[] {
  const tokens = (filter.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const tag = (filter.tag ?? "").trim().toLowerCase();
  return blocks.filter((b) => {
    if (tag && !b.tags.some((t) => t.trim().toLowerCase() === tag)) return false;
    if (tokens.length === 0) return true;
    const hay = `${b.title} ${b.tags.join(" ")} ${b.body}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

/** Distinct tags across the blocks, most used first, then alphabetical; capped. */
export function collectTags(blocks: readonly { tags: string[] }[], max = 20): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const b of blocks) {
    for (const raw of b.tags) {
      const label = raw.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      const cur = counts.get(key);
      if (cur) cur.n += 1;
      else counts.set(key, { label, n: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .slice(0, max)
    .map((c) => c.label);
}

export const CHANGE_NOTE_MAX = 500;
