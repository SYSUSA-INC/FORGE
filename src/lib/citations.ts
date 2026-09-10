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
