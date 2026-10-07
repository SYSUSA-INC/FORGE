/**
 * BL-AIX Phase 2b — Sections L and M as structured data.
 *
 * Section L (instructions to offerors) and Section M (evaluation
 * factors) decide how a proposal is built and scored, yet intake kept
 * them as two prose summaries and a flat bullet list. Two dedicated
 * passes now read each located section and return:
 *
 *   L — the volumes to submit with their page limits and contents, the
 *       format rules (font, margins, spacing, page size, file type) and
 *       the submission rules (deadline, method, copies);
 *   M — the award basis (tradeoff or lowest price technically
 *       acceptable), the factors in the order the section lists them,
 *       each with its stated importance and subfactors, and the sentence
 *       that ranks them.
 *
 * Every item carries the clause it came from, located in the document
 * (page, paragraph) the way requirements are (Phase 2a).
 *
 * Pure: types, normalisation, excerpts and merging. Unit-tested.
 */
import type { RequirementSource } from "@/lib/requirement-provenance";
import { locateSection } from "@/lib/solicitation-sections";
import type { Segment } from "@/lib/solicitation-segments";

export type LmRule = { rule: string; quote: string; source?: RequirementSource };

export type LmVolume = {
  name: string;
  /** Pages allowed, when the instructions state a number. */
  pageLimit: number | null;
  pageLimitText: string;
  contents: string;
  quote: string;
  source?: RequirementSource;
};

export type LmFactor = {
  name: string;
  /** As stated: "most important", "equal to Factor 2", "40%". */
  importance: string;
  subfactors: { name: string; importance: string }[];
  quote: string;
  source?: RequirementSource;
};

export type LmBasis = "tradeoff" | "lpta" | "other" | "unstated";

export type SectionLStructure = { volumes: LmVolume[]; formatRules: LmRule[]; submission: LmRule[] };
export type SectionMStructure = {
  basis: LmBasis;
  basisQuote: string;
  /** The sentence that ranks the factors, word for word. */
  relativeImportance: string;
  factors: LmFactor[];
};

/** Stored on solicitation / solicitation_document.lm_structure (drizzle/0123). */
export type LmStructure = {
  sectionL?: SectionLStructure | null;
  sectionM?: SectionMStructure | null;
  promptVersion?: string;
  model?: string;
};

const MAX_VOLUMES = 12;
const MAX_RULES = 25;
const MAX_FACTORS = 12;
const MAX_SUBFACTORS = 10;

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** A page count from a number or from text such as "25 pages" / "twenty-five (25) pages". */
export function parsePageLimit(value: unknown, text = ""): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[^\d.]/g, "")) : NaN;
  if (Number.isFinite(n) && n > 0 && n <= 1000) return Math.round(n);
  const m = /(?:\(|\b)(\d{1,3})\)?\s*(?:total\s+)?pages?\b/i.exec(text);
  return m ? Number(m[1]) : null;
}

function rules(raw: unknown): LmRule[] {
  if (!Array.isArray(raw)) return [];
  const out: LmRule[] = [];
  for (const r of raw) {
    const rec = (r ?? {}) as Record<string, unknown>;
    const rule = str(rec.rule, 300);
    if (rule) out.push({ rule, quote: str(rec.quote, 600) });
    if (out.length >= MAX_RULES) break;
  }
  return out;
}

export function normalizeSectionL(raw: unknown): SectionLStructure | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const volumes: LmVolume[] = [];
  for (const v of Array.isArray(rec.volumes) ? rec.volumes : []) {
    const vr = (v ?? {}) as Record<string, unknown>;
    const name = str(vr.name, 160);
    if (!name) continue;
    const pageLimitText = str(vr.pageLimitText, 200);
    volumes.push({
      name,
      pageLimit: parsePageLimit(vr.pageLimit, pageLimitText),
      pageLimitText,
      contents: str(vr.contents, 600),
      quote: str(vr.quote, 600),
    });
    if (volumes.length >= MAX_VOLUMES) break;
  }
  const out = { volumes, formatRules: rules(rec.formatRules), submission: rules(rec.submission) };
  return out.volumes.length + out.formatRules.length + out.submission.length > 0 ? out : null;
}

const BASES: readonly LmBasis[] = ["tradeoff", "lpta", "other", "unstated"];

export function normalizeSectionM(raw: unknown): SectionMStructure | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const factors: LmFactor[] = [];
  for (const f of Array.isArray(rec.factors) ? rec.factors : []) {
    const fr = (f ?? {}) as Record<string, unknown>;
    const name = str(fr.name, 160);
    if (!name) continue;
    const subfactors = (Array.isArray(fr.subfactors) ? fr.subfactors : [])
      .map((s) => {
        const sr = (s ?? {}) as Record<string, unknown>;
        return { name: str(sr.name, 160), importance: str(sr.importance, 160) };
      })
      .filter((s) => s.name)
      .slice(0, MAX_SUBFACTORS);
    factors.push({ name, importance: str(fr.importance, 200), subfactors, quote: str(fr.quote, 600) });
    if (factors.length >= MAX_FACTORS) break;
  }
  const basis = BASES.includes(rec.basis as LmBasis) ? (rec.basis as LmBasis) : "unstated";
  const out: SectionMStructure = {
    basis,
    basisQuote: str(rec.basisQuote, 600),
    relativeImportance: str(rec.relativeImportance, 800),
    factors,
  };
  return factors.length > 0 || basis !== "unstated" ? out : null;
}

export const L_EXCERPT_CHARS = 48_000;
export const M_EXCERPT_CHARS = 32_000;

export type LmExcerpt = { text: string; start: number; label: string; truncated: boolean };

/**
 * The text a pass reads for Section L or M: the segment its heading
 * opened (Phase 2a), else where `locateSection` finds it, up to the
 * other section or the budget. Null when the document has no such part.
 */
export function lmExcerpt(rawText: string, segments: Segment[], part: "L" | "M"): LmExcerpt | null {
  const text = rawText ?? "";
  const budget = part === "L" ? L_EXCERPT_CHARS : M_EXCERPT_CHARS;
  const seg = segments.find((s) => s.kind === "section" && s.key === part);
  let start: number;
  let end: number;
  let label: string;
  if (seg) {
    start = seg.start;
    end = seg.end;
    label = seg.label;
  } else {
    const at = locateSection(text, part);
    if (at === null) return null;
    const other = locateSection(text, part === "L" ? "M" : "L");
    start = at;
    end = other !== null && other > at ? other : text.length;
    label = part === "L" ? "Section L — Instructions to offerors" : "Section M — Evaluation factors for award";
  }
  const stop = Math.min(end, start + budget);
  const slice = text.slice(start, stop);
  return slice.trim() ? { text: slice, start, label, truncated: stop < end } : null;
}

/**
 * One L and one M for an opportunity from its documents, newest first:
 * the first document that has each wins, so an amendment's Section M
 * replaces the original's.
 */
export function mergeLmStructures(structures: (LmStructure | null | undefined)[]): LmStructure {
  const out: LmStructure = {};
  for (const s of structures) {
    if (!s) continue;
    if (!out.sectionL && s.sectionL) out.sectionL = s.sectionL;
    if (!out.sectionM && s.sectionM) out.sectionM = s.sectionM;
  }
  return out;
}

export function hasLm(s: LmStructure | null | undefined): boolean {
  return Boolean(s && (s.sectionL || s.sectionM));
}

const BASIS_LABEL: Record<LmBasis, string> = {
  tradeoff: "best-value tradeoff",
  lpta: "lowest price technically acceptable",
  other: "other basis",
  unstated: "basis not stated",
};

export function basisLabel(b: LmBasis): string {
  return BASIS_LABEL[b];
}

/** Locate every quoted item in its document (page, part, paragraph). */
export function locateLm(
  s: { sectionL: SectionLStructure | null; sectionM: SectionMStructure | null },
  locate: (text: string) => RequirementSource,
): { sectionL: SectionLStructure | null; sectionM: SectionMStructure | null } {
  const at = <T extends { quote: string }>(item: T): T => (item.quote ? { ...item, source: locate(item.quote) } : item);
  return {
    sectionL: s.sectionL
      ? { volumes: s.sectionL.volumes.map(at), formatRules: s.sectionL.formatRules.map(at), submission: s.sectionL.submission.map(at) }
      : null,
    sectionM: s.sectionM ? { ...s.sectionM, factors: s.sectionM.factors.map(at) } : null,
  };
}

/**
 * What the extraction accuracy check scores from L and M: every Section L
 * statement a page limit could be captured in, and the factor names in
 * Section M's order.
 */
export function lmScoringInputs(s: LmStructure | null | undefined): { sectionL: string[]; factors: string[] } {
  const l = s?.sectionL;
  return {
    sectionL: l
      ? [...l.volumes.flatMap((v) => [v.quote, v.pageLimitText]), ...l.formatRules.flatMap((r) => [r.quote, r.rule])].filter(Boolean)
      : [],
    factors: s?.sectionM?.factors.map((f) => f.name) ?? [],
  };
}

/**
 * Sections L and M as lines for the outline prompt (proposal bootstrap):
 * the volumes with their page limits first, so the outline takes its
 * page caps from what was read and located rather than re-reading
 * prose. "" when neither section was found.
 */
export function describeLmForOutline(s: LmStructure | null | undefined): string {
  const lines: string[] = [];
  const l = s?.sectionL;
  if (l) {
    if (l.volumes.length > 0) lines.push("Volumes Section L asks for:");
    for (const v of l.volumes) {
      const where = v.source?.page ? ` (p. ${v.source.page})` : "";
      lines.push(`- ${v.name}: ${v.pageLimit !== null ? `${v.pageLimit} pages` : "no page limit stated"}${v.contents ? ` — ${v.contents}` : ""}${where}`);
    }
    if (l.formatRules.length > 0) lines.push(`Format rules: ${l.formatRules.map((r) => r.rule).join("; ")}`);
  }
  const m = s?.sectionM;
  if (m && m.factors.length > 0) {
    lines.push(`Evaluation factors in Section M order (${basisLabel(m.basis)}):`);
    m.factors.forEach((f, i) => {
      const subs = f.subfactors.length > 0 ? `; subfactors: ${f.subfactors.map((x) => x.name).join(", ")}` : "";
      lines.push(`${i + 1}. ${f.name}${f.importance ? ` (${f.importance})` : ""}${subs}`);
    });
    if (m.relativeImportance) lines.push(`Relative importance: "${m.relativeImportance}"`);
  }
  return lines.join("\n");
}
