/**
 * BL-AIX Phase 2a — split a solicitation into its parts by rules, before
 * any model reads it.
 *
 * The requirement sweep used to cut the text every 60k characters
 * wherever a paragraph happened to end, so a window could start halfway
 * through Section H and end in Section L, and the model was told only
 * "window 4 of 9". This module finds the parts a contracting officer
 * wrote:
 *
 *   - the Uniform Contract Format sections B to M ("SECTION C -
 *     DESCRIPTION/SPECIFICATIONS/STATEMENT OF WORK");
 *   - attachments, exhibits and appendices ("ATTACHMENT J-1 PERFORMANCE
 *     WORK STATEMENT");
 *   - numbered paragraph headings ("C.3.2", "3.2.1 Transition", "PWS
 *     2.1"), used to say which paragraph a requirement sits in.
 *
 * The rules are deliberately conservative: a heading must start a line,
 * look like a heading rather than a sentence, and not sit in a table of
 * contents or a list of attachments; each part starts at its first such
 * heading, in document order, so running page headers do not move it.
 * A document without that structure is one segment, read as before.
 *
 * Pure: no DB, unit-tested.
 */
import { chunkText, DEFAULT_CHUNK_OPTIONS, MAX_CHUNKS_PER_DOCUMENT, type ChunkOptions } from "@/lib/requirements-text";

export type SegmentKind = "front" | "section" | "attachment";

export type Segment = {
  kind: SegmentKind;
  /** "C", "L", "Attachment J-1"; "" for the front matter. */
  key: string;
  label: string;
  /** Character offsets in the source text; segments tile it end to end. */
  start: number;
  end: number;
};

const UCF_TITLES: Record<string, string> = {
  B: "Supplies or services and prices/costs",
  C: "Description/specifications/statement of work",
  D: "Packaging and marking",
  E: "Inspection and acceptance",
  F: "Deliveries or performance",
  G: "Contract administration data",
  H: "Special contract requirements",
  I: "Contract clauses",
  J: "List of attachments",
  K: "Representations, certifications and statements of offerors",
  L: "Instructions, conditions and notices to offerors",
  M: "Evaluation factors for award",
};
const UCF_ORDER = Object.keys(UCF_TITLES);

/** Section L and M are often headed by their title alone. */
const TITLE_ONLY: Record<string, RegExp> = {
  L: /^instructions,?\s+conditions,?\s+and\s+notices\s+to\s+(?:offerors|bidders|quoters|respondents)\b/i,
  M: /^evaluation\s+factors\s+for\s+award\b/i,
};

const SECTION_HEADING = /^(?:part\s+[ivx]+\s*[-–—:.]?\s*)?section\s+([b-m])(?!\w|[.\-–]\d)(.*)$/i;
const ATTACHMENT_HEADING = /^(attachment|exhibit|appendix|annex|enclosure)\s+(no\.?\s*)?([a-z]{0,2}-?\d{1,3}[a-z]?|[a-z])(?!\w|\.\w)(.*)$/i;
const MAX_HEADING_LINE = 150;

type Line = { start: number; text: string };

function linesOf(text: string): Line[] {
  const out: Line[] = [];
  let at = 0;
  for (const raw of text.split("\n")) {
    const lead = raw.length - raw.trimStart().length;
    out.push({ start: at + lead, text: raw.trim() });
    at += raw.length + 1;
  }
  return out;
}

/**
 * The rest of a heading line after "SECTION C" / "ATTACHMENT J-1": empty,
 * a separator and a title, or a title in capitals. A sentence that merely
 * begins with "Section L of this solicitation …" is not a heading.
 */
function headingRest(rest: string): string | null {
  const r = rest.trim();
  if (!r) return "";
  if (/\b(shall|will|must|should|may|refer|in accordance)\b/i.test(r)) return null;
  if (/^[-–—:.|]/.test(r)) {
    const title = r.replace(/^[-–—:.|\s]+/, "");
    if (/[.,;]$/.test(title) && !/\.{3,}\s*\d*$/.test(title)) return null;
    return title;
  }
  const letters = r.replace(/[^a-z]/gi, "");
  if (!letters) return r;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length >= 0.7 ? r : null;
}


/** A contents entry ends in a page number ("........ 12"). */
const CONTENTS_ENTRY = /(?:\.{3,}|\s{2,}|\t)\s*\d{1,3}\s*$/;

function neighbour(lines: Line[], i: number, step: 1 | -1): Line | null {
  for (let j = i + step; j >= 0 && j < lines.length; j += step) if (lines[j]!.text) return lines[j]!;
  return null;
}

/** Capitals only: a heading's title on its own line, not body text. */
function titleLine(text: string): boolean {
  return /[A-Z]/.test(text) && !/[a-z]/.test(text);
}

/**
 * A contents entry, not a heading: it ends in a page number, or the next
 * line (after a title line in capitals) is another section heading
 * rather than the section's text.
 */
function inContents(lines: Line[], i: number): boolean {
  if (CONTENTS_ENTRY.test(lines[i]!.text)) return true;
  let next = neighbour(lines, i, 1);
  if (next && titleLine(next.text) && !SECTION_HEADING.test(next.text)) next = neighbour(lines, lines.indexOf(next), 1);
  return next !== null && SECTION_HEADING.test(next.text);
}

/** Section J and cover letters list attachments one per line. */
function inAttachmentList(lines: Line[], i: number): boolean {
  if (CONTENTS_ENTRY.test(lines[i]!.text)) return true;
  const isEntry = (l: Line | null) => l !== null && ATTACHMENT_HEADING.test(l.text);
  return isEntry(neighbour(lines, i, -1)) || isEntry(neighbour(lines, i, 1));
}

type Candidate = { start: number; key: string; kind: SegmentKind; title: string };

function sectionCandidates(lines: Line[]): Map<string, Candidate[]> {
  const byLetter = new Map<string, Candidate[]>();
  for (const [i, line] of lines.entries()) {
    if (!line.text || line.text.length > MAX_HEADING_LINE) continue;
    let letter: string | null = null;
    let title = "";
    const m = SECTION_HEADING.exec(line.text);
    if (m) {
      const rest = headingRest(m[2] ?? "");
      if (rest === null) continue;
      letter = m[1]!.toUpperCase();
      title = rest;
    } else {
      for (const [l, re] of Object.entries(TITLE_ONLY)) {
        if (re.test(line.text)) {
          letter = l;
          title = line.text;
        }
      }
    }
    if (!letter || inContents(lines, i)) continue;
    const list = byLetter.get(letter) ?? [];
    list.push({ start: line.start, key: letter, kind: "section", title });
    byLetter.set(letter, list);
  }
  return byLetter;
}

/** One start per UCF letter, increasing through B to M, each the first heading after the previous part. */
function chooseSections(byLetter: Map<string, Candidate[]>): Candidate[] {
  const chosen: Candidate[] = [];
  let after = -1;
  for (const letter of UCF_ORDER) {
    const next = (byLetter.get(letter) ?? []).find((c) => c.start > after);
    if (!next) continue;
    chosen.push(next);
    after = next.start;
  }
  return chosen;
}

function attachmentCandidates(lines: Line[], notBefore: number): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const [i, line] of lines.entries()) {
    if (line.start < notBefore || !line.text || line.text.length > MAX_HEADING_LINE) continue;
    const m = ATTACHMENT_HEADING.exec(line.text);
    if (!m) continue;
    const rest = headingRest(m[4] ?? "");
    if (rest === null) continue;
    const word = m[1]![0]!.toUpperCase() + m[1]!.slice(1).toLowerCase();
    const key = `${word} ${m[3]!.toUpperCase()}`;
    if (seen.has(key) || inAttachmentList(lines, i)) continue;
    seen.add(key);
    out.push({ start: line.start, key, kind: "attachment", title: rest });
  }
  return out;
}

function tidyTitle(title: string): string {
  const t = title.replace(/\.{3,}\s*\d*$/, "").replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

/**
 * The document's parts, tiling it from start to end. Text before the
 * first heading is the front matter (cover page, Section A, any letter).
 * Attachments are looked for after the last UCF section begins, since
 * that is where they are appended; with no UCF structure, anywhere.
 */
export function segmentSolicitation(rawText: string): Segment[] {
  const text = rawText ?? "";
  if (!text) return [];
  const lines = linesOf(text);
  const sections = chooseSections(sectionCandidates(lines));
  const lastSection = sections.length > 0 ? sections[sections.length - 1]!.start + 1 : 0;
  const attachments = attachmentCandidates(lines, lastSection);
  const starts = [...sections, ...attachments].sort((a, b) => a.start - b.start);

  const out: Segment[] = [];
  if (starts.length === 0 || starts[0]!.start > 0) {
    out.push({ kind: "front", key: "", label: "Front matter", start: 0, end: starts[0]?.start ?? text.length });
  }
  starts.forEach((c, i) => {
    const end = starts[i + 1]?.start ?? text.length;
    const title =
      c.kind === "section" ? UCF_TITLES[c.key]! : tidyTitle(c.title) || "";
    out.push({
      kind: c.kind,
      key: c.key,
      label: c.kind === "section" ? `Section ${c.key} — ${title}` : title ? `${c.key} — ${title}` : c.key,
      start: c.start,
      end,
    });
  });
  return out;
}

/** The segment holding character `at`, or null. */
export function segmentAt(segments: Segment[], at: number): Segment | null {
  for (const s of segments) if (at >= s.start && at < s.end) return s;
  return null;
}

// Case-sensitive on purpose: "1.5 Million" is a heading only before a capital.
const PARAGRAPH_HEADING =
  /^(?:(?:PWS|SOW|SOO|[Pp]ws|[Ss]ow|[Ss]oo)\s+\d{1,3}(?:\.\d{1,3})*|[A-Ma-m][.-]\d{1,3}(?:\.\d{1,3})*|\d{1,3}(?:\.\d{1,3}){2,}|\d{1,3}\.0|\d{1,3}\.\d{1,3}(?=\.?\s+[A-Z]))(?=[\s.)]|$)/;

export type ParagraphMark = { start: number; label: string };

/**
 * Numbered paragraph starts ("C.3.2", "L-5", "3.2.1", "2.0", "PWS 4.1",
 * "1.3 Scope", "1.3. Scope"): the label is written as in the document,
 * without a trailing dot. A bare "1.5" needs a capitalised word after it,
 * so "1.5 million" is not a heading.
 */
export function paragraphMarks(rawText: string): ParagraphMark[] {
  const out: ParagraphMark[] = [];
  for (const line of linesOf(rawText ?? "")) {
    const m = PARAGRAPH_HEADING.exec(line.text);
    if (!m) continue;
    out.push({ start: line.start, label: m[0].replace(/\s+/g, " ").toUpperCase() });
  }
  return out;
}

/** The last paragraph mark at or before `at`, within the same segment. */
export function paragraphAt(marks: ParagraphMark[], at: number, segment: Segment | null): string | null {
  let lo = 0;
  let hi = marks.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (marks[mid]!.start <= at) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return null;
  const mark = marks[found]!;
  return segment && mark.start < segment.start ? null : mark.label;
}

export type SweepWindow = {
  index: number;
  start: number;
  end: number;
  text: string;
  /** Which part(s) of the document the window holds, for the prompt; "" for an unstructured document. */
  label: string;
};

function labelFor(segments: Segment[], start: number, end: number): string {
  if (segments.length <= 1) return "";
  const parts = segments.filter((s) => s.start < end && s.end > start);
  if (parts.length === 1) return parts[0]!.label;
  return `Several parts: ${parts.map((s) => s.key || "front matter").join(", ")}`;
}

/**
 * The requirement sweep's windows. With a structure, windows follow it:
 * a part that fits a window is never cut, consecutive small parts share
 * one, and a part longer than a window is cut inside itself. When that
 * would need more windows than the per-document cap, the plain cut is
 * used instead, so following the structure never reads less of the
 * document. Every window says which part(s) it holds.
 */
export function planSweepWindows(
  rawText: string,
  segments: Segment[] = segmentSolicitation(rawText),
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): SweepWindow[] {
  const text = rawText ?? "";
  if (!text.trim()) return [];
  const plain = () => chunkText(text, options).map((c) => ({ ...c, label: labelFor(segments, c.start, c.end) }));
  if (segments.length <= 1) return plain();

  const size = options.chunkChars;
  const units: { start: number; end: number }[] = [];
  for (const seg of segments) {
    if (seg.end - seg.start <= size) units.push({ start: seg.start, end: seg.end });
    else for (const c of chunkText(text.slice(seg.start, seg.end), options)) units.push({ start: seg.start + c.start, end: seg.start + c.end });
  }
  const packed: { start: number; end: number }[] = [];
  for (const u of units) {
    const last = packed[packed.length - 1];
    const fits = last && last.end === u.start && (u.end - last.start <= size || (u.end - u.start < size * 0.05 && u.end - last.start <= size * 1.1));
    if (fits) last.end = u.end;
    else packed.push({ ...u });
  }
  if (packed.length > MAX_CHUNKS_PER_DOCUMENT) return plain();
  return packed.map((w, index) => ({ index, start: w.start, end: w.end, text: text.slice(w.start, w.end), label: labelFor(segments, w.start, w.end) }));
}
