/**
 * BL-FB-X-COLOR-TEAM — colour-team review workflow, pure parts.
 *
 * A review round is a colour, a due date, reviewers and comments
 * (`proposal_review*`). This adds what a review lead otherwise runs in
 * email and Word: the checklist each colour starts from, reviewers
 * scoped to several sections with the uncovered ones visible, and the
 * consolidated comment report handed to the writers when the round
 * closes. No I/O here; the server side is `review-workflow.ts`.
 */
import type { ReviewAiSummary, ReviewChecklistItem, ReviewColor } from "@/db/schema";

export const CHECKLIST_LIMITS = {
  maxItems: 20,
  maxLabelChars: 140,
  maxHintChars: 240,
  maxNoteChars: 500,
  maxInstructionsChars: 2000,
} as const;

/** What an experienced lead asks each colour team to check. The round copies this at start. */
export const REVIEW_CHECKLIST_TEMPLATES: Record<ReviewColor, ReviewChecklistItem[]> = {
  pink: [
    { key: "outline_matches_l", label: "Outline follows Section L order and headings", hint: "Every required volume and section is present, in the order the RFP asks for." },
    { key: "themes_per_section", label: "Each section states a win theme", hint: "The theme is the customer's benefit, not our feature." },
    { key: "discriminators", label: "Discriminators named, not implied", hint: "What we do that the competition cannot, with proof." },
    { key: "requirements_mapped", label: "Every requirement has a home section", hint: "No compliance row left unmapped." },
    { key: "graphics_planned", label: "Key graphics planned with action captions" },
    { key: "page_budget", label: "Page budget allocated per section" },
  ],
  red: [
    { key: "m_factors", label: "Every Section M factor is addressed where the evaluator will look" },
    { key: "compliance_complete", label: "Compliance matrix shows no open gaps", hint: "Cross-reference the rows to the text, not the outline." },
    { key: "claims_substantiated", label: "Claims carry proof: past performance, metrics, named contracts" },
    { key: "customer_voice", label: "Written to the customer's mission, in their words" },
    { key: "risks_mitigated", label: "Risks named with mitigations" },
    { key: "page_limits", label: "Within page limits with the formatting rules met" },
    { key: "score_as_evaluator", label: "Scored as the evaluator would: strengths, weaknesses, deficiencies" },
  ],
  gold: [
    { key: "exec_summary", label: "Executive summary tells the whole story on one page" },
    { key: "consistency", label: "Consistent across volumes: names, numbers, staffing, dates" },
    { key: "themes_land", label: "Win themes open and close each section" },
    { key: "pricing_aligned", label: "Technical and price volumes tell the same story" },
    { key: "exec_signoff", label: "Executive sign-off recorded" },
  ],
  white_gloves: [
    { key: "spelling_grammar", label: "Spelling, grammar and the acronym list clean" },
    { key: "formatting", label: "Fonts, margins, headers and footers match Section L" },
    { key: "figures_tables", label: "Figures and tables numbered, captioned and referenced" },
    { key: "cross_refs", label: "Cross-references and page numbers correct" },
    { key: "submission_pack", label: "File names, formats and signatures ready for submission" },
  ],
  green: [
    { key: "boe_traceable", label: "Basis of estimate traces to the technical approach", hint: "Labour categories, hours and materials match what the technical volume promises." },
    { key: "assumptions", label: "Assumptions and exclusions stated" },
    { key: "l_pricing_rules", label: "Section L pricing instructions and templates followed" },
    { key: "realism", label: "Rates and hours realistic for the work and the market" },
    { key: "arithmetic", label: "Totals, option years and escalation check out" },
  ],
};

/** `slugKey("Claims carry proof!", 2)` → `"claims_carry_proof_2"`. */
export function slugKey(label: string, i: number): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return `${base || "item"}_${i}`;
}

/**
 * Clean a checklist as the start form (or an old round) hands it over:
 * strings or `{ key?, label, hint? }` objects; trimmed, capped, keys
 * unique; blank lines dropped. Null for anything that is not a list.
 */
export function sanitizeChecklist(raw: unknown): ReviewChecklistItem[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ReviewChecklistItem[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, i) => {
    if (out.length >= CHECKLIST_LIMITS.maxItems) return;
    const obj = typeof entry === "string" ? { label: entry } : entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    if (!obj) return;
    const label = typeof obj.label === "string" ? obj.label.trim().slice(0, CHECKLIST_LIMITS.maxLabelChars) : "";
    if (!label) return;
    let key = typeof obj.key === "string" ? obj.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 48) : "";
    if (!key || seen.has(key)) key = slugKey(label, i + 1);
    if (seen.has(key)) return;
    seen.add(key);
    const hint = typeof obj.hint === "string" ? obj.hint.trim().slice(0, CHECKLIST_LIMITS.maxHintChars) : "";
    out.push(hint ? { key, label, hint } : { key, label });
  });
  return out;
}

export type ChecklistState = { userId: string; itemKey: string; checked: boolean; note?: string };

export type ChecklistProgress = {
  total: number;
  /** Ticks across all reviewers over items × reviewers. */
  done: number;
  of: number;
  perReviewer: { userId: string; done: number; total: number }[];
};

/** How far each reviewer is through the round's checklist; stray keys from an edited list are ignored. */
export function checklistProgress(items: readonly ReviewChecklistItem[], states: readonly ChecklistState[], reviewerIds: readonly string[]): ChecklistProgress {
  const keys = new Set(items.map((i) => i.key));
  const perReviewer = reviewerIds.map((userId) => ({
    userId,
    done: states.filter((s) => s.userId === userId && s.checked && keys.has(s.itemKey)).length,
    total: items.length,
  }));
  return {
    total: items.length,
    done: perReviewer.reduce((n, r) => n + r.done, 0),
    of: items.length * reviewerIds.length,
    perReviewer,
  };
}

export type SectionRef = { id: string; title: string; ordering: number };
export type SectionAssignment = { userId: string; sectionId: string };

export type Coverage = {
  /** Every section, with who reads it (whole-proposal reviewers included). */
  bySection: { sectionId: string; reviewerIds: string[] }[];
  /** Sections nobody is scoped to and no whole-proposal reviewer covers. */
  uncovered: string[];
  /** Reviewers with no section rows: they read everything. */
  wholeProposalReviewerIds: string[];
};

/** Who covers which section once scoped and whole-proposal reviewers are combined. */
export function sectionCoverage(input: {
  sections: readonly SectionRef[];
  reviewerIds: readonly string[];
  sectionAssignments: readonly SectionAssignment[];
}): Coverage {
  const scoped = new Set(input.sectionAssignments.map((a) => a.userId));
  const whole = input.reviewerIds.filter((id) => !scoped.has(id));
  const bySection = [...input.sections]
    .sort((a, b) => a.ordering - b.ordering)
    .map((s) => {
      const ids = new Set<string>(whole);
      for (const a of input.sectionAssignments) if (a.sectionId === s.id && input.reviewerIds.includes(a.userId)) ids.add(a.userId);
      return { sectionId: s.id, reviewerIds: Array.from(ids) };
    });
  return {
    bySection,
    uncovered: bySection.filter((b) => b.reviewerIds.length === 0).map((b) => b.sectionId),
    wholeProposalReviewerIds: whole,
  };
}

/** "All 6 sections covered" / "2 of 6 sections have no reviewer" / "No sections yet". */
export function describeCoverage(cov: Coverage): string {
  const n = cov.bySection.length;
  if (n === 0) return "No sections yet";
  if (cov.uncovered.length === 0) return `All ${n} section${n === 1 ? "" : "s"} covered`;
  return `${cov.uncovered.length} of ${n} section${n === 1 ? "" : "s"} ${cov.uncovered.length === 1 ? "has" : "have"} no reviewer`;
}

export type ConsolidatedComment = {
  id: string;
  sectionId: string | null;
  body: string;
  resolved: boolean;
  /** null = FORGE AI pre-review. */
  authorName: string | null;
  createdAt: string;
};

export type CommentGroup = {
  sectionId: string | null;
  title: string;
  ordering: number;
  open: ConsolidatedComment[];
  resolved: ConsolidatedComment[];
  authors: string[];
};

/** Comments grouped by section in proposal order, general ones last; sections without comments are left out. */
export function consolidateComments(sections: readonly SectionRef[], comments: readonly ConsolidatedComment[]): CommentGroup[] {
  const groups = new Map<string | null, CommentGroup>();
  const ordered = [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const c of ordered) {
    const sec = c.sectionId ? sections.find((s) => s.id === c.sectionId) : undefined;
    const key = sec ? sec.id : null;
    let g = groups.get(key);
    if (!g) {
      g = { sectionId: key, title: sec ? sec.title : "General", ordering: sec ? sec.ordering : Number.MAX_SAFE_INTEGER, open: [], resolved: [], authors: [] };
      groups.set(key, g);
    }
    (c.resolved ? g.resolved : g.open).push(c);
    const author = c.authorName ?? "FORGE AI";
    if (!g.authors.includes(author)) g.authors.push(author);
  }
  return Array.from(groups.values()).sort((a, b) => a.ordering - b.ordering);
}

/**
 * The hand-off writers get when the round closes: open comments per
 * section with who said them, resolved ones counted, checklist progress
 * and the reviewers' verdicts. Plain Markdown so it pastes anywhere.
 */
export function consolidatedReport(input: {
  proposalTitle: string;
  colorLabel: string;
  dueDate?: string | null;
  instructions?: string;
  groups: readonly CommentGroup[];
  sectionNumbers?: ReadonlyMap<string, number>;
  verdicts?: readonly { name: string; verdict: string | null; summary?: string }[];
  checklist?: ChecklistProgress | null;
}): string {
  const lines: string[] = [`# ${input.colorLabel} — ${input.proposalTitle}`];
  if (input.dueDate) lines.push(`Due ${input.dueDate}`);
  if (input.instructions?.trim()) lines.push("", `> ${input.instructions.trim().replace(/\n+/g, "\n> ")}`);
  const open = input.groups.reduce((n, g) => n + g.open.length, 0);
  const resolved = input.groups.reduce((n, g) => n + g.resolved.length, 0);
  lines.push("", `**${open} open comment${open === 1 ? "" : "s"}** · ${resolved} resolved`);
  if (input.checklist && input.checklist.of > 0) lines.push(`Checklist: ${input.checklist.done}/${input.checklist.of} ticks across reviewers`);
  if (input.verdicts && input.verdicts.length > 0) {
    lines.push("", "## Verdicts");
    for (const v of input.verdicts) lines.push(`- ${v.name}: ${v.verdict ?? "pending"}${v.summary?.trim() ? ` — ${v.summary.trim()}` : ""}`);
  }
  for (const g of input.groups) {
    const num = g.sectionId ? input.sectionNumbers?.get(g.sectionId) : undefined;
    lines.push("", `## ${num !== undefined ? `§${num} ` : ""}${g.title}`, `${g.open.length} open · ${g.resolved.length} resolved · ${g.authors.join(", ")}`);
    for (const c of g.open) lines.push(`- [ ] ${c.body.replace(/\s+/g, " ").trim()} — ${c.authorName ?? "FORGE AI"}`);
    for (const c of g.resolved) lines.push(`- [x] ${c.body.replace(/\s+/g, " ").trim()} — ${c.authorName ?? "FORGE AI"}`);
  }
  return lines.join("\n");
}

// ── Slice 2 — round follow-ups ──────────────────────────────────────

export const SUMMARY_LIMITS = { maxThemes: 5, maxItems: 8, maxChars: 280, maxHeadlineChars: 200 } as const;

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");
const clipList = (v: unknown, n: number = SUMMARY_LIMITS.maxItems) =>
  Array.isArray(v) ? v.map((s) => clip(s, SUMMARY_LIMITS.maxChars)).filter(Boolean).slice(0, n) : [];

/** Clean the model's summary; null when it carries nothing worth storing. */
export function sanitizeSummary(raw: unknown, meta: { fallback: boolean; model: string }): ReviewAiSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const headline = clip(o.headline, SUMMARY_LIMITS.maxHeadlineChars);
  const themes = Array.isArray(o.themes)
    ? o.themes
        .map((t) => {
          const x = t && typeof t === "object" ? (t as Record<string, unknown>) : {};
          return { title: clip(x.title, 120), detail: clip(x.detail, SUMMARY_LIMITS.maxChars), sections: clipList(x.sections, 6) };
        })
        .filter((t) => t.title)
        .slice(0, SUMMARY_LIMITS.maxThemes)
    : [];
  const summary: ReviewAiSummary = {
    headline,
    themes,
    mustFix: clipList(o.mustFix),
    strengths: clipList(o.strengths),
    nextSteps: clipList(o.nextSteps),
    fallback: meta.fallback,
    model: meta.model,
  };
  return headline || themes.length || summary.mustFix.length ? summary : null;
}

/**
 * The summary without a model: counts, the sections with most open
 * comments as themes, the open comments of the busiest sections as the
 * must-fix list, praise words as strengths, unticked checklist lines as
 * next steps.
 */
export function heuristicSummary(input: {
  colorLabel: string;
  groups: readonly CommentGroup[];
  verdicts: readonly { name: string; verdict: string | null }[];
  checklist: ChecklistProgress | null;
  uncheckedLabels?: readonly string[];
  sectionNumbers?: ReadonlyMap<string, number>;
}): ReviewAiSummary {
  const open = input.groups.reduce((n, g) => n + g.open.length, 0);
  const resolved = input.groups.reduce((n, g) => n + g.resolved.length, 0);
  const verdicts = input.verdicts.filter((v) => v.verdict);
  const fails = verdicts.filter((v) => /fail/i.test(v.verdict!)).length;
  const conds = verdicts.filter((v) => /conditional/i.test(v.verdict!)).length;
  const verdictPhrase = verdicts.length === 0 ? "no verdicts yet" : fails > 0 ? `${fails} fail${fails === 1 ? "" : "s"}` : conds > 0 ? `${conds} conditional` : "all pass";
  const busiest = [...input.groups].filter((g) => g.open.length > 0).sort((a, b) => b.open.length - a.open.length);
  const label = (g: CommentGroup) => {
    const n = g.sectionId ? input.sectionNumbers?.get(g.sectionId) : undefined;
    return n !== undefined ? `§${n} ${g.title}` : g.title;
  };
  const praise = /\b(strong|clear|compelling|well[- ]written|good|excellent|convincing)\b/i;
  return {
    headline: `${input.colorLabel}: ${open} open comment${open === 1 ? "" : "s"} across ${busiest.length} section${busiest.length === 1 ? "" : "s"}, ${resolved} resolved, ${verdictPhrase}.`,
    themes: busiest.slice(0, SUMMARY_LIMITS.maxThemes).map((g) => ({
      title: `${label(g)} needs the most work`,
      detail: `${g.open.length} open comment${g.open.length === 1 ? "" : "s"} from ${g.authors.join(", ")}.`,
      sections: [g.title],
    })),
    mustFix: busiest.flatMap((g) => g.open.map((c) => `${label(g)}: ${clip(c.body, SUMMARY_LIMITS.maxChars)}`)).slice(0, SUMMARY_LIMITS.maxItems),
    strengths: input.groups.flatMap((g) => [...g.open, ...g.resolved].filter((c) => praise.test(c.body)).map((c) => clip(c.body, SUMMARY_LIMITS.maxChars))).slice(0, 3),
    nextSteps: [
      ...(input.uncheckedLabels ?? []).slice(0, 4).map((l) => `Checklist still open: ${l}`),
      ...(input.checklist && input.checklist.of > 0 && input.checklist.done < input.checklist.of ? [`Finish the checklist (${input.checklist.done}/${input.checklist.of} ticks).`] : []),
      ...(verdicts.length < input.verdicts.length ? [`${input.verdicts.length - verdicts.length} reviewer${input.verdicts.length - verdicts.length === 1 ? "" : "s"} still to submit a verdict.`] : []),
    ].slice(0, SUMMARY_LIMITS.maxItems),
    fallback: true,
    model: "",
  };
}

/** The summary as Markdown for the clipboard. */
export function summaryMarkdown(s: ReviewAiSummary): string {
  const lines = [`**${s.headline}**`];
  if (s.themes.length) lines.push("", "## Themes", ...s.themes.map((t) => `- **${t.title}** — ${t.detail}${t.sections.length ? ` (${t.sections.join(", ")})` : ""}`));
  if (s.mustFix.length) lines.push("", "## Must fix", ...s.mustFix.map((m) => `- [ ] ${m}`));
  if (s.strengths.length) lines.push("", "## Strengths", ...s.strengths.map((m) => `- ${m}`));
  if (s.nextSteps.length) lines.push("", "## Next steps", ...s.nextSteps.map((m) => `- ${m}`));
  return lines.join("\n");
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const DUE_REMINDER_HORIZON_MS = DAY_MS;

// ── Slice 3 — the tenant's reminder cadence ─────────────────────────

/** How a tenant wants review reminders paced: first reminder N days before the due date, then every M days while overdue (0 = once). */
export type ReminderCadence = { daysBefore: number; repeatDays: number };
export const REMINDER_CADENCE_LIMITS = { daysBefore: { min: 0, max: 14 }, repeatDays: { min: 0, max: 14 } } as const;
/** Slice 2's behaviour: the day before, once. */
export const DEFAULT_REMINDER_CADENCE: ReminderCadence = { daysBefore: 1, repeatDays: 0 };

/** Whole days inside the limits, or null when the input is not a cadence. */
export function sanitizeReminderCadence(raw: { daysBefore?: unknown; repeatDays?: unknown } | null | undefined): ReminderCadence | null {
  const whole = (v: unknown, lim: { min: number; max: number }) => (typeof v === "number" && Number.isInteger(v) && v >= lim.min && v <= lim.max ? v : null);
  const daysBefore = whole(raw?.daysBefore, REMINDER_CADENCE_LIMITS.daysBefore);
  const repeatDays = whole(raw?.repeatDays, REMINDER_CADENCE_LIMITS.repeatDays);
  if (daysBefore === null || repeatDays === null) return null;
  return { daysBefore, repeatDays };
}

/**
 * Whether a round's reviewers are owed a reminder now: the first once the
 * due date is within `daysBefore` days (or past) and none was sent; then,
 * only while the round is overdue and `repeatDays` is set, another every
 * `repeatDays` days after the last one.
 */
export function reviewReminderDue(now: Date, dueDate: Date | null | undefined, sentAt: Date | null | undefined, cadence: ReminderCadence = DEFAULT_REMINDER_CADENCE): boolean {
  if (!dueDate) return false;
  if (!sentAt) return dueDate.getTime() - now.getTime() <= cadence.daysBefore * DAY_MS;
  if (cadence.repeatDays <= 0) return false;
  if (dueDate.getTime() > now.getTime()) return false;
  return now.getTime() - sentAt.getTime() >= cadence.repeatDays * DAY_MS;
}

/** True once a round is within a day of its due date, or past it (the default cadence, nothing sent yet). */
export function dueReminderDue(now: Date, dueDate: Date | null | undefined): boolean {
  return reviewReminderDue(now, dueDate, null, DEFAULT_REMINDER_CADENCE);
}

export function dueReminderSubject(colorLabel: string, proposalTitle: string, dueDate: Date, now: Date): string {
  const diff = dueDate.getTime() - now.getTime();
  const days = Math.ceil(diff / DAY_MS);
  const when =
    diff < 0
      ? "is overdue"
      : dueDate.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)
        ? "is due today"
        : days <= 1
          ? "is due tomorrow"
          : `is due in ${days} days`;
  return `${colorLabel} review of ${proposalTitle} ${when} — your verdict is still open`;
}
