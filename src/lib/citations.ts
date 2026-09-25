/**
 * BL-FB-GEN-CITE — citation markers in generated drafts.
 *
 * In citation mode the drafter is given numbered sources and asked to
 * follow every supported concrete claim with its marker, "[S3]", and
 * every unsupported concrete claim with "[NEEDS CITATION]". This module
 * is the one place that knows the marker syntax, so the prompt, the
 * route, the panel and the tests agree. Pure: no server-only.
 */

export const NEEDS_CITATION_MARKER = "[NEEDS CITATION]";

const SOURCE_MARKER_RE = /\[S(\d{1,2})\]/g;
const NEEDS_CITATION_RE = /\[NEEDS CITATION\]/gi;

export type CitationStats = {
  /** Distinct source indices referenced, ascending. */
  citedSources: number[];
  /** Total source markers in the text (a source may be cited many times). */
  citationCount: number;
  /** Number of [NEEDS CITATION] flags the author must resolve. */
  needsCitation: number;
};

export function extractCitationStats(text: string): CitationStats {
  const cited = new Set<number>();
  let citationCount = 0;
  for (const m of text.matchAll(SOURCE_MARKER_RE)) {
    cited.add(Number(m[1]));
    citationCount += 1;
  }
  const needsCitation = text.match(NEEDS_CITATION_RE)?.length ?? 0;
  return {
    citedSources: [...cited].sort((a, b) => a - b),
    citationCount,
    needsCitation,
  };
}

export function sourceMarker(index: number): string {
  return `[S${index}]`;
}

/**
 * BL-AIP-5 — a marker that names no listed source is an invention. Turn
 * it into [NEEDS CITATION] so the author sees a gap instead of a
 * confident-looking reference to nothing.
 */
export function dropInvalidMarkers(
  text: string,
  sourceCount: number,
): { text: string; dropped: number } {
  let dropped = 0;
  const out = text.replace(SOURCE_MARKER_RE, (m, n: string) => {
    const idx = Number(n);
    if (idx >= 1 && idx <= sourceCount) return m;
    dropped += 1;
    return NEEDS_CITATION_MARKER;
  });
  // Several inventions in a row collapse to one flag.
  return {
    text: out.replace(/(\[NEEDS CITATION\])(\s*\[NEEDS CITATION\])+/g, "$1"),
    dropped,
  };
}

export type CitedClaim = {
  id: number;
  /** The sentence as it appears in the text, markers included. */
  claim: string;
  sourceIndexes: number[];
};

/** Sentences carrying at least one source marker, in order of appearance. */
export function citedClaims(text: string): CitedClaim[] {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  const out: CitedClaim[] = [];
  for (const s of sentences) {
    const idxs = new Set<number>();
    for (const m of s.matchAll(SOURCE_MARKER_RE)) idxs.add(Number(m[1]));
    if (idxs.size === 0) continue;
    out.push({ id: out.length + 1, claim: s.trim(), sourceIndexes: [...idxs].sort((a, b) => a - b) });
  }
  return out;
}

/**
 * Replace the markers of the given claims with a single [NEEDS CITATION]
 * so an unsupported sentence is flagged rather than falsely sourced.
 */
export function demoteClaims(text: string, claims: CitedClaim[]): string {
  let out = text;
  for (const c of claims) {
    const flagged = `${c.claim.replace(/\s*\[S\d{1,2}\]/g, "")} ${NEEDS_CITATION_MARKER}`;
    out = out.split(c.claim).join(flagged);
  }
  return out;
}

/**
 * A source the drafter may cite. `index` is 1-based and stable for the
 * life of one draft. `href` points at the Brain record for the legend.
 */
export type DraftSource = {
  index: number;
  kind: "corpus" | "entry" | "past_performance";
  label: string;
  excerpt: string;
  outcomeLabel?: "none" | "won" | "lost" | "no_bid" | "withdrawn";
  href?: string;
};

/** Cap on sources sent to the model; keeps the prompt bounded. */
export const MAX_DRAFT_SOURCES = 10;
export const SOURCE_EXCERPT_CHARS = 600;

/** BL-AIP-5 — what the verifier pass did to a cited draft (pure shape; the pass itself is server-only). */
export type CitationVerification = {
  /** Sentences the verifier looked at. */
  checked: number;
  /** Sentences demoted to [NEEDS CITATION]. */
  unsupported: number;
  /** Markers that named no listed source (replaced before the model ran). */
  invalidMarkers: number;
  stubbed: boolean;
  /** Present when the model pass did not run or did not validate. */
  skipped?: string;
};
