/**
 * BL-AIX Phase 2c — a person's verdict on each extracted requirement.
 *
 * The team confirms, edits or rejects what intake extracted, or adds a
 * clause it missed. Each verdict is kept twice:
 *
 *   - on the requirement itself (`review`), so every reader sees the
 *     corrected list and a rejected clause drops out of the matrix seed,
 *     the drafter and the scan (`activeRequirements`);
 *   - as a row in `requirement_correction`, keyed by the wording intake
 *     produced, so it is re-applied when the document is parsed again
 *     and stays as labelled data for this organization alone.
 *
 * Applying is idempotent and reversible: a requirement is matched by its
 * original wording (kept in `review.original` once edited), and one whose
 * correction was removed returns to what intake extracted.
 *
 * Pure: no DB, unit-tested.
 */
import type { SolicitationRequirement } from "@/db/schema";
import type { SourcedRequirement } from "@/lib/requirement-provenance";
import { dedupeRequirements, requirementKey } from "@/lib/requirements-text";

export type ReviewAction = "confirmed" | "edited" | "rejected" | "added";
export const REVIEW_ACTIONS: readonly ReviewAction[] = ["confirmed", "edited", "rejected", "added"];

type Clause = Pick<SolicitationRequirement, "kind" | "text" | "ref">;

export type RequirementReview = {
  status: ReviewAction;
  /** What intake extracted, kept once a person edits or rejects it. */
  original?: Clause;
  by?: string | null;
  at?: string;
  /** Carried from another solicitation on the same opportunity (an amendment's base), not decided here. */
  carried?: boolean;
};

export type ReviewedRequirement = SourcedRequirement & { review?: RequirementReview };

/** A stored correction, as `applyCorrections` needs it. */
export type Correction = {
  /** Where the verdict was recorded ("" for the solicitation itself); matching uses the wording only. */
  docKey: string;
  originalKey: string;
  action: ReviewAction;
  corrected: Partial<Clause>;
  original: Partial<Clause>;
  userId: string | null;
  updatedAt: Date;
};

/** The wording intake produced for this requirement. */
export function originalOf(r: ReviewedRequirement): Clause {
  return r.review?.original ?? { kind: r.kind, text: r.text, ref: r.ref };
}

export function reviewKeyOf(r: ReviewedRequirement): string {
  return requirementKey(originalOf(r).text);
}

export function docKeyOf(r: { sourceDocId?: string }): string {
  return r.sourceDocId ?? "";
}

const KINDS = new Set(["shall", "should", "may"]);

/** A clause as typed by a person: trimmed, bounded, with a valid kind. Null when there is no text. */
export function cleanClause(input: { kind?: unknown; text?: unknown; ref?: unknown }): Clause | null {
  const text = typeof input.text === "string" ? input.text.replace(/\s+/g, " ").trim().slice(0, 1_000) : "";
  if (!text) return null;
  const kind = typeof input.kind === "string" && KINDS.has(input.kind) ? (input.kind as Clause["kind"]) : "shall";
  const ref = typeof input.ref === "string" ? input.ref.trim().slice(0, 64) : "";
  return { kind, text, ref };
}

/**
 * The list as the team has verified it. A verdict follows the extracted
 * wording, whichever document of the solicitation states it, so it holds
 * when another copy of the clause wins the merge or its document is
 * re-parsed or removed. Requirements keep their order; an added clause
 * goes at the end. A requirement whose correction no longer exists
 * returns to its extracted wording, and an added one without its
 * correction is dropped.
 */
export function applyCorrections<T extends ReviewedRequirement>(list: T[], corrections: Correction[]): T[] {
  // One verdict per wording; older rows recorded per document defer to the newest.
  const byKey = new Map<string, Correction>();
  for (const c of corrections) {
    const prev = byKey.get(c.originalKey);
    if (!prev || prev.updatedAt < c.updatedAt) byKey.set(c.originalKey, c);
  }
  const used = new Set<string>();
  const out: T[] = [];
  for (const r of list) {
    const k = reviewKeyOf(r);
    const c = byKey.get(k);
    const original = originalOf(r);
    const { review: _review, ...rest } = r;
    const base = { ...rest, ...original } as T;
    if (!c) {
      if (r.review?.status !== "added") out.push(base);
      continue;
    }
    used.add(k);
    const review: RequirementReview = { status: c.action, by: c.userId, at: c.updatedAt.toISOString() };
    if (c.action === "edited") {
      out.push({ ...base, ...c.corrected, review: { ...review, original } });
    } else if (c.action === "rejected") {
      out.push({ ...base, review: { ...review, original } });
    } else if (c.action === "added" && r.review?.status !== "added") {
      // Extraction now finds the clause a person added: it stays extracted,
      // vouched for, so removing the addition never removes the clause.
      out.push({ ...base, review: { ...review, status: "confirmed" } });
    } else {
      out.push({ ...base, review });
    }
  }
  for (const [k, c] of byKey) {
    if (used.has(k) || c.action !== "added") continue;
    const clause = cleanClause(c.corrected);
    if (!clause) continue;
    out.push({ ...clause, review: { status: "added", by: c.userId, at: c.updatedAt.toISOString() } } as T);
  }
  return out;
}

/** A requirement as intake extracted it: its original wording and provenance, no verdict. */
function asExtracted<T extends ReviewedRequirement>(r: T): T {
  const { review: _review, ...rest } = r;
  return { ...rest, ...originalOf(r) } as T;
}

/**
 * The solicitation's list from what intake extracted and the team's
 * verdicts. The extracted clauses (the solicitation's own first, then
 * the companion documents in a fixed order) are merged on their
 * extracted wording, then the verdicts are applied by that wording. So
 * an edit never lets another copy of the old wording back in, undoing an
 * addition never removes a clause a document states, and a verdict holds
 * whichever copy survives the merge.
 */
export function mergeWithCorrections(input: {
  /** The solicitation's stored list; its own entries are those without `sourceDocId`. */
  own: ReviewedRequirement[];
  /** Each parsed companion document's extracted clauses, in a fixed order. */
  docs: { id: string; requirements: SourcedRequirement[] }[];
  corrections: Correction[];
}): ReviewedRequirement[] {
  // An added row is rebuilt from its correction; one that carries
  // provenance was in fact extracted (stored that way before this fix).
  const own = input.own.filter((r) => !r.sourceDocId && !(r.review?.status === "added" && !r.source)).map(asExtracted);
  const companions = input.docs.flatMap((d) =>
    d.requirements.map((r) => ({ ...asExtracted(r as ReviewedRequirement), sourceDocId: d.id })),
  );
  const wrap = (r: ReviewedRequirement) => ({ text: r.text, item: r });
  const merged = dedupeRequirements(own.map(wrap), companions.map(wrap)).map((w) => w.item);
  return applyCorrections(merged, input.corrections);
}

/**
 * Verdicts across an opportunity's solicitations (newest first), matched
 * on the extracted wording, for clauses an amendment repeats:
 *   - a rejection anywhere wins: it applies to every copy not rejected
 *     or edited on its own solicitation (unreviewed or merely confirmed);
 *   - an edit applies to unreviewed copies, changing only what the edit
 *     changed, so the copy keeps its own reference when only the wording
 *     was corrected.
 * A carried verdict is marked `carried`.
 */
export function applyOpportunityVerdicts(lists: ReviewedRequirement[][]): ReviewedRequirement[][] {
  const rejected = new Map<string, ReviewedRequirement>();
  const edited = new Map<string, ReviewedRequirement>();
  for (const list of lists) {
    for (const r of list) {
      if (r.review?.carried) continue;
      const key = reviewKeyOf(r);
      if (r.review?.status === "rejected" && !rejected.has(key)) rejected.set(key, r);
      if (r.review?.status === "edited" && !edited.has(key)) edited.set(key, r);
    }
  }
  if (rejected.size === 0 && edited.size === 0) return lists;
  return lists.map((list) =>
    list.map((r) => {
      const status = r.review?.status;
      if (status === "rejected" || status === "edited" || status === "added") return r;
      const key = reviewKeyOf(r);
      const original = originalOf(r);
      const no = rejected.get(key);
      if (no) return { ...r, ...original, review: { ...no.review!, original, carried: true } };
      const ed = status ? undefined : edited.get(key);
      if (!ed) return r;
      const from = ed.review!.original ?? originalOf(ed);
      return {
        ...r,
        text: ed.text,
        kind: ed.kind !== from.kind ? ed.kind : r.kind,
        ref: ed.ref !== from.ref ? ed.ref : r.ref,
        review: { ...ed.review!, original, carried: true },
      };
    }),
  );
}

/** What the matrix seed, the drafter and the scan should use: everything not rejected. */
export function activeRequirements<T extends ReviewedRequirement>(list: T[]): T[] {
  return list.filter((r) => r.review?.status !== "rejected");
}

export type ReviewCounts = Record<ReviewAction | "unreviewed" | "notFound", number>;

export function reviewCounts(list: ReviewedRequirement[]): ReviewCounts {
  const counts: ReviewCounts = { confirmed: 0, edited: 0, rejected: 0, added: 0, unreviewed: 0, notFound: 0 };
  for (const r of list) {
    counts[r.review?.status ?? "unreviewed"] += 1;
    if (!r.review && r.source?.quote === "none") counts.notFound += 1;
  }
  return counts;
}

/**
 * Order for the verify screen: what most needs a person first (not
 * found in the source, then found only in part, then the rest), then
 * reviewed items. Stable within each group.
 */
export function verifyOrder<T extends ReviewedRequirement>(list: T[]): T[] {
  const rank = (r: T) => (r.review ? 3 : r.source?.quote === "none" ? 0 : r.source?.quote === "partial" ? 1 : 2);
  return list
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.r);
}

/** Up to `radius` characters either side of the located clause, on word boundaries. */
export function sourceSnippet(rawText: string, at: number | undefined, length: number, radius = 220): string {
  if (at === undefined || at < 0 || at >= rawText.length) return "";
  let start = Math.max(0, at - radius);
  let end = Math.min(rawText.length, at + length + radius);
  while (start > 0 && /\S/.test(rawText[start - 1]!)) start -= 1;
  while (end < rawText.length && /\S/.test(rawText[end]!)) end += 1;
  return `${start > 0 ? "… " : ""}${rawText.slice(start, end).replace(/\s+/g, " ").trim()}${end < rawText.length ? " …" : ""}`;
}
