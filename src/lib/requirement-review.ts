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
import { requirementKey } from "@/lib/requirements-text";

export type ReviewAction = "confirmed" | "edited" | "rejected" | "added";
export const REVIEW_ACTIONS: readonly ReviewAction[] = ["confirmed", "edited", "rejected", "added"];

type Clause = Pick<SolicitationRequirement, "kind" | "text" | "ref">;

export type RequirementReview = {
  status: ReviewAction;
  /** What intake extracted, kept once a person edits or rejects it. */
  original?: Clause;
  by?: string | null;
  at?: string;
};

export type ReviewedRequirement = SourcedRequirement & { review?: RequirementReview };

/** A stored correction, as `applyCorrections` needs it. */
export type Correction = {
  /** "" for the solicitation's own clauses, else the companion document's id. */
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
 * The list as the team has verified it. Requirements keep their order;
 * an added clause goes at the end. A requirement whose correction no
 * longer exists returns to its extracted wording, and an added one
 * without its correction is dropped.
 */
export function applyCorrections<T extends ReviewedRequirement>(list: T[], corrections: Correction[]): T[] {
  const byKey = new Map(corrections.map((c) => [`${c.docKey}\u0000${c.originalKey}`, c]));
  const used = new Set<string>();
  const out: T[] = [];
  for (const r of list) {
    const k = `${docKeyOf(r)}\u0000${reviewKeyOf(r)}`;
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
    } else {
      out.push({ ...base, review });
    }
  }
  for (const [k, c] of byKey) {
    if (used.has(k) || c.action !== "added") continue;
    const clause = cleanClause(c.corrected);
    if (!clause) continue;
    out.push({
      ...clause,
      ...(c.docKey ? { sourceDocId: c.docKey } : {}),
      review: { status: "added", by: c.userId, at: c.updatedAt.toISOString() },
    } as T);
  }
  return out;
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
