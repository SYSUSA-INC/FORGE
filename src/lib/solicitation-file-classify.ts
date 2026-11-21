/**
 * BL-STAB-3 — what each file in a New Solicitation batch is, by rule.
 *
 * Several files are dropped at once: the solicitation itself, its
 * amendments, the contracting officer's Q&A, a PWS or SOW, pricing
 * sheets, forms and other attachments. This module labels one file from
 * its name and from signals in its text (Section L/M and SF 1449 / SF 33
 * headers, the SF 30 amendment header, question/answer markers, price
 * columns, form numbers), and keeps the line each signal was read from as
 * the evidence the person sees. It also settles a batch: one file is the
 * base solicitation, and the rest are filed after it. Nothing here calls
 * AI; `weak` marks the labels an AI check may look at again. Pure
 * (client-safe); unit-tested.
 */
import { amendmentNumberFromName } from "@/lib/amendment-name";
import { documentTypeFromName, type CompanionDocumentType } from "@/lib/document-type-name";
import { parseQaPairs } from "@/lib/solicitation-qa-logic";

export const FILE_LABELS = ["base", "amendment", "qa", "pws", "sow", "cdrl", "j_attachment", "rfp", "pricing", "form", "other"] as const;
export type FileLabel = (typeof FILE_LABELS)[number];

export const FILE_LABEL_NAMES: Record<FileLabel, string> = {
  base: "Base solicitation",
  amendment: "Amendment",
  qa: "Q&A",
  pws: "PWS",
  sow: "SOW",
  cdrl: "CDRL",
  j_attachment: "J attachment",
  rfp: "RFP (additional volume)",
  pricing: "Pricing sheet",
  form: "Form",
  other: "Other attachment",
};

export function isFileLabel(value: unknown): value is FileLabel {
  return typeof value === "string" && (FILE_LABELS as readonly string[]).includes(value);
}

/** Files one batch may hold. */
export const MAX_BATCH_FILES = 25;
/** How much of a file's text the rules read. */
export const CLASSIFY_TEXT_CHARS = 60_000;
/** Below this the label is weak: the person should look, and an AI check may run. */
export const WEAK_CONFIDENCE = 0.6;

export type LabelEvidence = {
  /** Where the signal was read: the file's name, a line of its text, or the rest of the batch. */
  from: "name" | "text" | "batch";
  quote: string;
};

export type FileClassification = {
  label: FileLabel;
  /** 0 to 1. */
  confidence: number;
  /** Rules only here; an AI check, when one runs, says so. */
  basis: "rules" | "ai";
  evidence: LabelEvidence[];
  /** For an amendment: its number, from the name or the SF 30 header ("" when neither states one). */
  amendmentNumber: string;
  /** The rules were thin, or the name and the text point at different things. */
  weak: boolean;
};

type TextRule = { label: FileLabel; weight: number; where: "head" | "any"; pattern: RegExp };

/** The solicitation cover forms and the amendment form are not "forms" to file apart. */
const NOT_A_SEPARATE_FORM = "(?!(?:30|33|18|1449|1442|1423)\\b)";

const TEXT_RULES: TextRule[] = [
  { label: "amendment", weight: 4, where: "head", pattern: /amendment of solicitation\s*\/\s*modification of contract/i },
  { label: "amendment", weight: 3, where: "head", pattern: /\bstandard form 30\b|\bsf[- ]?30\b/i },
  { label: "amendment", weight: 3, where: "any", pattern: /solicitation is (?:hereby )?amended/i },
  { label: "amendment", weight: 2, where: "head", pattern: /\bamendment(?:\s*\/\s*modification)?\s*(?:no\.?|number|#)\s*:?\s*[a-z]?\d{1,6}\b/i },
  { label: "base", weight: 4, where: "head", pattern: /solicitation\s*\/\s*contract\s*\/\s*order for commercial/i },
  { label: "base", weight: 4, where: "head", pattern: /\bsolicitation,? offer,? and award\b/i },
  { label: "base", weight: 3, where: "any", pattern: /\bsection\s+l\b.{0,80}(?:instructions|conditions|notices)|instructions,? conditions,? and notices to offerors/i },
  { label: "base", weight: 3, where: "any", pattern: /\bsection\s+m\b.{0,60}evaluation|evaluation factors for award/i },
  { label: "base", weight: 2, where: "head", pattern: /\brequest for (?:proposals?|quotations?|quotes?)\b/i },
  { label: "base", weight: 2, where: "head", pattern: /\bstandard form (?:1449|33|1442|18)\b|\bsf[- ]?(?:1449|33|1442|18)\b/i },
  { label: "qa", weight: 3, where: "head", pattern: /\bquestions?\s*(?:and|&)\s*(?:answers?|responses?)\b|\bq\s*&\s*a\b|\bresponses? to (?:industry |offeror |vendor )?questions\b/i },
  { label: "pws", weight: 3, where: "head", pattern: /\bperformance work statement\b/i },
  { label: "sow", weight: 3, where: "head", pattern: /\bstatement of (?:work|objectives)\b/i },
  { label: "cdrl", weight: 3, where: "head", pattern: /\bcontract data requirements list\b|\bdd form 1423\b/i },
  { label: "pricing", weight: 2, where: "head", pattern: /\bpric(?:e|ing)\s+(?:schedule|sheet|template|proposal|worksheet|matrix|table)\b/i },
  {
    label: "form",
    weight: 2,
    where: "head",
    pattern: new RegExp(`\\b(?:standard form|optional form|dd form|sf|dd)[- ]?${NOT_A_SEPARATE_FORM}\\d{2,4}[a-z]?\\b|\\bomb (?:control )?(?:no\\.?|number)\\b`, "i"),
  },
];

const PRICE_TERMS = [/\bunit price\b/i, /\bextended (?:price|amount)\b/i, /\btotal (?:price|amount|cost)\b/i, /\bclin\b/i, /\blabor categor/i, /\b(?:hourly|labor|loaded) rate\b/i, /\b(?:quantity|qty)\b/i, /\bunit of (?:issue|measure)\b/i];

const HEAD_CHARS = 4_000;
const QUOTE_CHARS = 160;

function quote(line: string): string {
  const t = line.replace(/\s+/g, " ").trim();
  return t.length > QUOTE_CHARS ? `${t.slice(0, QUOTE_CHARS - 1)}…` : t;
}

/** The label a file's name suggests (null when the name says nothing). */
function labelFromName(fileName: string): { label: FileLabel; weight: number } | null {
  const type = documentTypeFromName(fileName);
  if (type === "other") return null;
  // "RFP", "Solicitation", "Volume": probably the solicitation, but so is every volume of it.
  if (type === "rfp") return { label: "base", weight: 2 };
  return { label: type, weight: 3 };
}

export function classifySolicitationFile(input: { fileName: string; text: string; format?: string | null }): FileClassification {
  const fileName = input.fileName || "";
  const text = (input.text || "").slice(0, CLASSIFY_TEXT_CHARS);
  const scores = new Map<FileLabel, number>();
  const evidence = new Map<FileLabel, LabelEvidence[]>();
  const add = (label: FileLabel, weight: number, ev: LabelEvidence) => {
    scores.set(label, (scores.get(label) ?? 0) + weight);
    evidence.set(label, [...(evidence.get(label) ?? []), ev]);
  };

  const named = labelFromName(fileName);
  if (named) add(named.label, named.weight, { from: "name", quote: quote(fileName) });

  // Each line with where it starts, so a "head" rule reads only the first page or so.
  const lines: { text: string; head: boolean }[] = [];
  let offset = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim()) lines.push({ text: raw, head: offset < HEAD_CHARS });
    offset += raw.length + 1;
    if (lines.length >= 2_000) break;
  }
  for (const rule of TEXT_RULES) {
    const hit = lines.find((l) => (rule.where === "any" || l.head) && rule.pattern.test(l.text));
    if (hit) add(rule.label, rule.weight, { from: "text", quote: quote(hit.text) });
  }
  // A header row of price columns (two or more of them on one line).
  const priceRow = lines.slice(0, 200).find((l) => PRICE_TERMS.filter((t) => t.test(l.text)).length >= 2);
  if (priceRow) add("pricing", input.format === "xlsx" ? 4 : 3, { from: "text", quote: quote(priceRow.text) });
  // Answered questions, as today's Q&A reader finds them.
  const pairs = text.trim() ? parseQaPairs(text) : [];
  if (pairs.length >= 2) {
    add("qa", pairs.length >= 5 ? 4 : 3, { from: "text", quote: quote(`${pairs.length} answered questions, the first: ${pairs[0]!.question}`) });
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const amendmentFromName = amendmentNumberFromName(fileName);
  if (ranked.length === 0) {
    return { label: "other", confidence: 0.3, basis: "rules", evidence: [], amendmentNumber: amendmentFromName, weak: true };
  }
  const [label, top] = ranked[0]!;
  const second = ranked[1]?.[1] ?? 0;
  const confidence = Math.round(Math.min(0.95, Math.max(0.2, 0.3 + 0.1 * top - 0.08 * second)) * 100) / 100;
  // The text's own best label, without the name's weight.
  const textTop = [...evidence.entries()]
    .map(([l, evs]) => ({ l, n: evs.filter((e) => e.from === "text").length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => (scores.get(b.l) ?? 0) - (scores.get(a.l) ?? 0))[0]?.l;
  const disagree = Boolean(named && textTop && named.label !== textTop);
  let amendmentNumber = amendmentFromName;
  if (!amendmentNumber && label === "amendment") {
    const m = /\bamendment(?:\s*\/\s*modification)?\s*(?:no\.?|number|#)\s*:?\s*([a-z]?\d{1,6})\b/i.exec(text.slice(0, HEAD_CHARS));
    if (m) amendmentNumber = m[1]!.toUpperCase();
  }
  return { label, confidence, basis: "rules", evidence: (evidence.get(label) ?? []).slice(0, 3), amendmentNumber, weak: confidence < WEAK_CONFIDENCE || disagree };
}

/**
 * One batch has one base solicitation. Where several files read as it,
 * the surest stays (the first on a tie) and the others become additional
 * volumes, with the reason added to their evidence. Order is kept.
 */
export function settleBatch<T extends { fileName: string; classification: FileClassification }>(files: readonly T[]): T[] {
  const bases = files.filter((f) => f.classification.label === "base");
  if (bases.length < 2) return [...files];
  const keep = bases.reduce((best, f) => (f.classification.confidence > best.classification.confidence ? f : best));
  return files.map((f) =>
    f === keep || f.classification.label !== "base"
      ? f
      : {
          ...f,
          classification: {
            ...f.classification,
            label: "rfp" as const,
            evidence: [...f.classification.evidence, { from: "batch" as const, quote: `"${quote(keep.fileName)}" reads as the solicitation itself, so this is filed as another volume of it.` }].slice(-3),
          },
        },
  );
}

/** Why this set of confirmed labels cannot be filed (null when it can). */
export function batchProblem(files: readonly { label: FileLabel }[]): string | null {
  if (files.length === 0) return "No files to file.";
  if (files.length > MAX_BATCH_FILES) return `At most ${MAX_BATCH_FILES} files at once; file the rest from the solicitation's page.`;
  const bases = files.filter((f) => f.label === "base").length;
  if (bases === 0) return "Mark one file as the base solicitation: the others are filed under it.";
  if (bases > 1) return "Only one file can be the base solicitation. Mark the others as RFP (additional volume) or what they are.";
  return null;
}

/** Amendments in number order ("0001" before "0002" before "P00003"; unnumbered last, by name). */
export function inAmendmentOrder<T extends { fileName: string; amendmentNumber: string }>(files: readonly T[]): T[] {
  const key = (n: string) => {
    const digits = /\d+/.exec(n);
    return digits ? Number(digits[0]) : Number.POSITIVE_INFINITY;
  };
  return [...files].sort(
    (a, b) => key(a.amendmentNumber) - key(b.amendmentNumber) || a.amendmentNumber.localeCompare(b.amendmentNumber) || a.fileName.localeCompare(b.fileName),
  );
}

/** The companion-document type a label is filed as (the base and amendments are solicitations, not companions). */
export function companionTypeFor(label: Exclude<FileLabel, "base" | "amendment">): CompanionDocumentType {
  return label;
}
