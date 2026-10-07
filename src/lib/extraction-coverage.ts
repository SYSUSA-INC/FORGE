/**
 * BL-AIX Phase 0d — how much of a solicitation the requirement sweep
 * actually read, and the plain-words warning when it fell short.
 *
 * The sweep reads at most 12 windows and keeps at most 400 requirements;
 * a window can also fail twice and be skipped. All of that used to be
 * logged and never shown, so a team could build a matrix from the first
 * two-thirds of an RFP without knowing. Pure, unit-tested.
 */

export type ExtractionCoverage = {
  /** Characters of extracted text in the document. */
  totalChars?: number;
  /** Characters the sweep's windows covered (from the start). */
  readChars?: number;
  windows?: number;
  failedWindows?: number;
  /** Requirements found across windows, and how many were kept after the cap. */
  requirementsFound?: number;
  requirementsKept?: number;
  /** Scanned document: one vision pass, no full-text sweep. */
  vision?: boolean;
  /** BL-AIX Phase 2a — requirements found in the text word for word, in part, or not at all. */
  quotes?: { exact: number; partial: number; none: number };
  /** BL-AIX Phase 2a — the parts found by their headings ("B" … "M", "Attachment J-1"). */
  parts?: string[];
};

export function coverageFromSweep(input: {
  totalChars: number;
  readChars: number;
  windows: number;
  failedWindows: number;
  requirementsFound: number;
  requirementsKept: number;
}): ExtractionCoverage {
  return { ...input };
}

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * What a team should know about how this document was read, or null
 * when it was read in full. One sentence per shortfall.
 */
export function describeCoverage(c: ExtractionCoverage | null | undefined): string[] | null {
  if (!c) return null;
  if (c.vision) {
    return [
      "This is a scanned document, so it was read in one image pass of up to 50 requirements rather than the full-text sweep. Upload a text-based PDF or the Word file to read every clause.",
    ];
  }
  const out: string[] = [];
  const total = c.totalChars ?? 0;
  const read = c.readChars ?? total;
  if (total > 0 && read < total) {
    const pct = Math.max(1, Math.floor((read / total) * 100));
    out.push(
      `Only the first ${pct}% of the text was read (${fmt(read)} of ${fmt(total)} characters), so requirements after that point are missing. Upload long parts — the PWS, Sections L and M, attachments — as separate companion documents so each is read in full.`,
    );
  }
  if ((c.failedWindows ?? 0) > 0) {
    const n = c.failedWindows!;
    out.push(`${n} part${n === 1 ? "" : "s"} of the document couldn't be read. Re-parse to try again.`);
  }
  if ((c.requirementsFound ?? 0) > (c.requirementsKept ?? Infinity)) {
    out.push(`${fmt(c.requirementsFound!)} requirements were found and the first ${fmt(c.requirementsKept!)} were kept.`);
  }
  return out.length > 0 ? out : null;
}
