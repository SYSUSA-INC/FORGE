/**
 * BL-AIP-4 — de-duplication key for Brain extraction candidates.
 *
 * The extraction prompt is re-run on the same artifact (manually, or by
 * the brain-index cron after a re-parse) and the same capability or
 * past-performance item comes back with slightly different punctuation
 * or casing. Comparing a normalised `kind::title` key against the
 * candidates already proposed for the artifact and the entries the
 * tenant already curated keeps the review queue from filling with
 * repeats. Pure; unit-tested.
 */

const KEY_MAX = 120;

export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, KEY_MAX);
}

export function candidateKey(kind: string, title: string): string {
  return `${kind.trim().toLowerCase()}::${normalizeTitle(title)}`;
}

/**
 * Drop incoming candidates whose key is already present (in `existing`
 * or earlier in the same batch). Returns the survivors and the count
 * dropped so the run can report it.
 */
export function dedupCandidates<T extends { kind: string; title: string }>(
  incoming: readonly T[],
  existing: Iterable<string>,
): { kept: T[]; skipped: number } {
  const seen = new Set(existing);
  const kept: T[] = [];
  let skipped = 0;
  for (const c of incoming) {
    const key = candidateKey(c.kind, c.title);
    if (!normalizeTitle(c.title) || seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    kept.push(c);
  }
  return { kept, skipped };
}
