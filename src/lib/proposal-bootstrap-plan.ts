/**
 * BL-AIP-5b — proposal bootstrap from Section L, pure parts.
 *
 * The model reads the solicitation's instructions to offerors and
 * returns the outline the offeror must submit. Everything here is the
 * deterministic half: cleaning that answer into a plan the app can
 * apply, deciding how a plan merges into an existing proposal without
 * touching written sections, finding the Section L text in a long
 * document, and picking the requirements worth showing the model.
 * Pure; unit-tested.
 */
import type { ProposalSectionKind } from "@/db/schema";

export const BOOTSTRAP_MAX_SECTIONS = 20;
export const BOOTSTRAP_MAX_THEMES = 3;
export const BOOTSTRAP_TITLE_MAX = 160;
export const BOOTSTRAP_INSTRUCTIONS_MAX = 600;
export const BOOTSTRAP_THEME_TITLE_MAX = 80;
export const BOOTSTRAP_THEME_STATEMENT_MAX = 360;
export const BOOTSTRAP_THEME_RATIONALE_MAX = 240;
export const BOOTSTRAP_NOTES_MAX = 1000;

export const SECTION_KINDS: ProposalSectionKind[] = [
  "executive_summary",
  "technical",
  "management",
  "past_performance",
  "pricing",
  "compliance",
];

export type BootstrapPlanSection = {
  title: string;
  kind: ProposalSectionKind;
  pageLimit: number | null;
  instructions: string;
  sourceRef: string;
};

export type BootstrapPlanTheme = { title: string; statement: string; rationale: string };

export type BootstrapPlan = {
  sections: BootstrapPlanSection[];
  dueDate: string | null;
  proposedThemes: BootstrapPlanTheme[];
  notes: string;
};

/** Loose shape of the model's answer; everything is checked below. */
export type RawBootstrapPlan = {
  sections?: {
    title?: unknown;
    kind?: unknown;
    pageLimit?: unknown;
    instructions?: unknown;
    sourceRef?: unknown;
  }[];
  dueDate?: unknown;
  proposedThemes?: { title?: unknown; statement?: unknown; rationale?: unknown }[];
  notes?: unknown;
};

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

/** Title key for matching: lower-cased, alphanumerics only. */
export function sectionTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/^(volume|vol\.?|section|tab|part|factor)\s+[a-z0-9]+[.:)\s-]*/i, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/** Best-effort section kind from a title the model did not classify. */
export function inferSectionKind(title: string): ProposalSectionKind {
  const t = title.toLowerCase();
  if (/executive|summary|overview|introduction|cover letter/.test(t)) return "executive_summary";
  if (/compliance|matrix|cross[- ]?reference|representation|certification|attachments?|forms?\b/.test(t))
    return "compliance";
  if (/past performance|experience|\breferences?\b|cpars|relevant contracts?/.test(t)) return "past_performance";
  if (/pric|cost|business volume|rates?\b|budget/.test(t)) return "pricing";
  if (/management|staffing|transition|quality|key personnel|organization|schedule|risk/.test(t))
    return "management";
  return "technical";
}

function isSectionKind(v: unknown): v is ProposalSectionKind {
  return typeof v === "string" && (SECTION_KINDS as string[]).includes(v);
}

function isoDate(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

/**
 * Clean the model's answer into a plan: titles de-duplicated, kinds
 * valid (inferred from the title when the model left them out), page
 * limits integers, everything capped. An empty answer yields no
 * sections, which callers treat as "keep the template".
 */
export function normalizeBootstrapPlan(raw: RawBootstrapPlan | null | undefined): BootstrapPlan {
  const sections: BootstrapPlanSection[] = [];
  const seen = new Set<string>();
  for (const s of raw?.sections ?? []) {
    const title = str(s?.title, BOOTSTRAP_TITLE_MAX);
    if (!title) continue;
    const key = sectionTitleKey(title) || title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const pageRaw = typeof s.pageLimit === "number" ? s.pageLimit : Number.NaN;
    const pageLimit =
      Number.isFinite(pageRaw) && pageRaw >= 1 && pageRaw <= 999 ? Math.round(pageRaw) : null;
    sections.push({
      title,
      kind: isSectionKind(s.kind) ? s.kind : inferSectionKind(title),
      pageLimit,
      instructions: str(s.instructions, BOOTSTRAP_INSTRUCTIONS_MAX),
      sourceRef: str(s.sourceRef, 64),
    });
    if (sections.length >= BOOTSTRAP_MAX_SECTIONS) break;
  }

  const proposedThemes: BootstrapPlanTheme[] = [];
  for (const t of raw?.proposedThemes ?? []) {
    const title = str(t?.title, BOOTSTRAP_THEME_TITLE_MAX);
    const statement = str(t?.statement, BOOTSTRAP_THEME_STATEMENT_MAX);
    if (!title || !statement) continue;
    proposedThemes.push({ title, statement, rationale: str(t?.rationale, BOOTSTRAP_THEME_RATIONALE_MAX) });
    if (proposedThemes.length >= BOOTSTRAP_MAX_THEMES) break;
  }

  return {
    sections,
    dueDate: isoDate(raw?.dueDate),
    proposedThemes,
    notes: str(raw?.notes, BOOTSTRAP_NOTES_MAX),
  };
}

export type ExistingSection = {
  id: string;
  title: string;
  wordCount: number;
  pageLimit: number | null;
  instructions: string;
};

export type RebuildDiff = {
  /** Planned sections with no counterpart: insert with this ordering. */
  insert: (BootstrapPlanSection & { ordering: number })[];
  /** Existing sections matched by title: refresh cap / brief / order. */
  update: { id: string; pageLimit: number | null; instructions: string; ordering: number }[];
  /** Empty existing sections the plan does not ask for. */
  remove: string[];
  /** Written sections the plan does not ask for: kept, ordered after the plan. */
  keep: { id: string; ordering: number }[];
};

/**
 * How a plan merges into a proposal that already has sections. Written
 * text is never removed; an empty section the instructions do not ask
 * for is dropped; a section with the same title takes the plan's page
 * cap and brief (the cap is kept when the plan has none).
 */
export function planSectionsForRebuild(
  existing: ExistingSection[],
  planned: BootstrapPlanSection[],
): RebuildDiff {
  const byKey = new Map<string, ExistingSection>();
  for (const e of existing) {
    const key = sectionTitleKey(e.title) || e.title.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, e);
  }
  const matched = new Set<string>();
  const diff: RebuildDiff = { insert: [], update: [], remove: [], keep: [] };
  planned.forEach((p, i) => {
    const key = sectionTitleKey(p.title) || p.title.toLowerCase();
    const hit = byKey.get(key);
    if (hit && !matched.has(hit.id)) {
      matched.add(hit.id);
      diff.update.push({
        id: hit.id,
        pageLimit: p.pageLimit ?? hit.pageLimit,
        instructions: p.instructions || hit.instructions,
        ordering: i + 1,
      });
    } else {
      diff.insert.push({ ...p, ordering: i + 1 });
    }
  });
  let next = planned.length + 1;
  for (const e of existing) {
    if (matched.has(e.id)) continue;
    if (e.wordCount > 0) diff.keep.push({ id: e.id, ordering: next++ });
    else diff.remove.push(e.id);
  }
  return diff;
}

const SECTION_L_MARKERS =
  /section\s+l\b[^\n]{0,80}|instructions?(,\s*conditions,?\s*and\s*notices)?\s+to\s+(the\s+)?offerors?|proposal\s+(submission|preparation)\s+(instructions|requirements)|submission\s+of\s+(proposals?|quotes?|quotations?)|volume\s+(i|1)\b[^\n]{0,40}/gi;

/**
 * The stretch of the document that carries the instructions to
 * offerors. Tables of contents mention Section L early with nothing
 * behind it, so the last marker with enough text after it wins; an
 * empty string means "not found — rely on the summaries".
 */
export function sectionLWindow(rawText: string, max = 14_000): string {
  if (!rawText) return "";
  const text = rawText.replace(/\r/g, "");
  let best = -1;
  let m: RegExpExecArray | null;
  SECTION_L_MARKERS.lastIndex = 0;
  while ((m = SECTION_L_MARKERS.exec(text)) !== null) {
    if (text.length - m.index >= 2_000) best = m.index;
    if (m.index === SECTION_L_MARKERS.lastIndex) SECTION_L_MARKERS.lastIndex++;
  }
  if (best === -1) {
    SECTION_L_MARKERS.lastIndex = 0;
    const first = SECTION_L_MARKERS.exec(text);
    SECTION_L_MARKERS.lastIndex = 0;
    if (!first) return "";
    best = first.index;
  }
  const lead = Math.min(300, Math.floor(max / 10));
  const start = Math.max(0, best - lead);
  return text.slice(start, start + max);
}

const FORMAT_TERMS =
  /\b(page|pages|font|margin|volume|volumes|format|formatting|submission|submit|due|deadline|copies|electronic|section|tab|table of contents|cover letter|limit|binder|file|attachment|oral|slides|sam\.gov|email|portal)\b/i;

/**
 * Requirements worth showing the outline model: submission and format
 * clauses first, then the rest until the cap.
 */
export function outlineRequirements<T extends { text: string }>(reqs: T[], max = 60): T[] {
  const format = reqs.filter((r) => FORMAT_TERMS.test(r.text));
  const rest = reqs.filter((r) => !FORMAT_TERMS.test(r.text));
  return [...format, ...rest].slice(0, max);
}
