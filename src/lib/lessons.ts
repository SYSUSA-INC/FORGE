import { z } from "zod";

/**
 * BL-LESSONS-LOOP — lessons from every outcome. Pure types and logic:
 * the record's shape, the schema FORGE's draft answers with, the
 * acceptance pass that keeps only evidence the prompt showed, and the
 * matching rule the readers (phase 4b) use. Nothing here reads a database.
 *
 * A proposed lesson is read by nothing; a person confirms it.
 */
export const LESSON_KINDS = ["do", "avoid", "watch"] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export const LESSON_SOURCES = ["outcome", "debrief", "winner_analysis", "review", "questionnaire", "manual"] as const;
export type LessonSource = (typeof LESSON_SOURCES)[number];

export const LESSON_STATUSES = ["proposed", "confirmed", "retired"] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export const SECTION_KINDS = ["executive_summary", "technical", "management", "past_performance", "pricing", "compliance"] as const;

export const LESSON_LIMITS = { text: 300, perDraft: 8, evidence: 6, applies: 8, term: 60 } as const;

export const LESSON_KIND_LABELS: Record<LessonKind, string> = { do: "Do", avoid: "Avoid", watch: "Watch" };
export const LESSON_SOURCE_LABELS: Record<LessonSource, string> = {
  outcome: "Outcome",
  debrief: "Debrief",
  winner_analysis: "Winner analysis",
  review: "Review",
  questionnaire: "Questionnaire",
  manual: "Written by hand",
};

export type LessonAppliesTo = {
  agencies: string[];
  naicsCodes: string[];
  sectionKinds: string[];
  capabilities: string[];
};

export const emptyAppliesTo = (): LessonAppliesTo => ({ agencies: [], naicsCodes: [], sectionKinds: [], capabilities: [] });

const term = z.string().trim().max(LESSON_LIMITS.term);
const appliesToSchema = z.object({
  agencies: z.array(term).max(LESSON_LIMITS.applies),
  naicsCodes: z.array(term).max(LESSON_LIMITS.applies),
  sectionKinds: z.array(z.string().trim().max(40)).max(LESSON_LIMITS.applies),
  capabilities: z.array(term).max(LESSON_LIMITS.applies),
});

/** What the model returns. Evidence ids are "outcome:<id>", "debrief:<id>", "winner:<id>", "comment:<id>" or "pattern:<id>". */
export const draftedLessonsSchema = z.object({
  lessons: z
    .array(
      z.object({
        text: z.string().trim().min(8).max(LESSON_LIMITS.text),
        kind: z.enum(LESSON_KINDS),
        source: z.enum(["outcome", "debrief", "winner_analysis", "review"]),
        appliesTo: appliesToSchema,
        evidence: z.array(z.string().trim().max(80)).max(LESSON_LIMITS.evidence),
      }),
    )
    .max(LESSON_LIMITS.perDraft),
});
export type DraftedLessons = z.infer<typeof draftedLessonsSchema>;

export type AcceptedLesson = {
  text: string;
  kind: LessonKind;
  source: LessonSource;
  appliesTo: LessonAppliesTo;
  evidence: string[];
};

export function normaliseLessonText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanAppliesTo(a: LessonAppliesTo): LessonAppliesTo {
  const dedupe = (xs: string[]) => Array.from(new Set(xs.map((x) => x.trim()).filter(Boolean)));
  return {
    agencies: dedupe(a.agencies),
    naicsCodes: dedupe(a.naicsCodes.map((c) => c.replace(/\D/g, ""))),
    sectionKinds: dedupe(a.sectionKinds).filter((k) => (SECTION_KINDS as readonly string[]).includes(k)),
    capabilities: dedupe(a.capabilities),
  };
}

/**
 * Keep the draft honest: evidence must be an id the prompt showed, a
 * lesson that repeats an existing one (by wording) is dropped, and a
 * lesson that applies to nothing is pinned to the bid's agency and NAICS
 * so it does not match every future bid.
 */
export function acceptDraftedLessons(input: {
  parsed: DraftedLessons;
  allowedEvidence: ReadonlySet<string>;
  existingTexts: string[];
  agency: string;
  naicsCode: string;
}): AcceptedLesson[] {
  const seen = new Set(input.existingTexts.map(normaliseLessonText));
  const out: AcceptedLesson[] = [];
  for (const l of input.parsed.lessons) {
    const key = normaliseLessonText(l.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    let appliesTo = cleanAppliesTo(l.appliesTo);
    if (!appliesTo.agencies.length && !appliesTo.naicsCodes.length && !appliesTo.sectionKinds.length && !appliesTo.capabilities.length) {
      appliesTo = { ...appliesTo, agencies: input.agency ? [input.agency] : [], naicsCodes: input.naicsCode ? [input.naicsCode.replace(/\D/g, "")] : [] };
    }
    out.push({
      text: l.text,
      kind: l.kind,
      source: l.source,
      appliesTo,
      evidence: Array.from(new Set(l.evidence.filter((e) => input.allowedEvidence.has(e)))),
    });
    if (out.length >= LESSON_LIMITS.perDraft) break;
  }
  return out;
}

/** A person's lesson or edit: the same shape, blanks dropped. */
export function sanitizeLessonInput(raw: { text: unknown; kind: unknown; appliesTo?: unknown }): { text: string; kind: LessonKind; appliesTo: LessonAppliesTo } | null {
  const text = typeof raw.text === "string" ? raw.text.trim().slice(0, LESSON_LIMITS.text) : "";
  if (text.length < 8) return null;
  const kind = LESSON_KINDS.includes(raw.kind as LessonKind) ? (raw.kind as LessonKind) : "do";
  const parsed = appliesToSchema.safeParse(raw.appliesTo ?? emptyAppliesTo());
  return { text, kind, appliesTo: cleanAppliesTo(parsed.success ? parsed.data : emptyAppliesTo()) };
}

export type LessonMatchContext = { agency?: string; naicsCode?: string; sectionKind?: string; capabilities?: string[] };

/**
 * The lessons that bear on a bid or a section: any field of `appliesTo`
 * intersects the context (agency by name, NAICS by digits, section kind
 * exactly, capability by name); a lesson that applies to nothing at all
 * matches everything. Case does not matter.
 */
export function lessonsMatching<T extends { appliesTo: LessonAppliesTo }>(lessons: T[], ctx: LessonMatchContext): T[] {
  const agency = (ctx.agency ?? "").trim().toLowerCase();
  const naics = (ctx.naicsCode ?? "").replace(/\D/g, "");
  const kind = (ctx.sectionKind ?? "").trim();
  const caps = new Set((ctx.capabilities ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean));
  return lessons.filter((l) => {
    const a = l.appliesTo;
    const empty = !a.agencies.length && !a.naicsCodes.length && !a.sectionKinds.length && !a.capabilities.length;
    if (empty) return true;
    if (agency && a.agencies.some((x) => x.toLowerCase() === agency)) return true;
    if (naics && a.naicsCodes.some((x) => x.replace(/\D/g, "") === naics)) return true;
    if (kind && a.sectionKinds.includes(kind)) return true;
    if (caps.size && a.capabilities.some((x) => caps.has(x.toLowerCase()))) return true;
    return false;
  });
}

/** Comma-separated terms from a form field, for the applies-to editor. */
export function termsFrom(text: string, max: number = LESSON_LIMITS.applies): string[] {
  return Array.from(new Set(text.split(",").map((s) => s.trim()).filter(Boolean))).slice(0, max);
}
