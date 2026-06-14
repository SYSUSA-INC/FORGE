import "server-only";

import type { KnowledgeKind } from "@/db/schema";

/**
 * BL-10 Phase D-1 — knowledge entry quality scoring.
 *
 * Computes a 0..1 score from cheap, deterministic heuristics. No AI
 * call — fast enough to run on every create/update and give the
 * editor immediate feedback. The signals are intentionally
 * conservative so a "good" score requires the author to actually
 * fill in the content, not just stub a title.
 *
 * Signal weights add up to 1.0:
 *   - bodyLength        0.30   long-enough body to be reusable
 *   - bodyStructure     0.15   paragraph breaks, bullets, headings
 *   - title             0.10   non-trivial title length
 *   - tags              0.10   at least one tag attached
 *   - metadata          0.10   any structured metadata keys
 *   - kindSpecific      0.25   kind-aware bonus (dates for past
 *                              performance, structure for capability,
 *                              etc.)
 *
 * Returns per-factor contributions so the editor can show authors
 * exactly which signals are weak. Phase D-2 surfaces the factors
 * in the entry editor UI.
 */

export type QualityFactors = {
  bodyLength: number;
  bodyStructure: number;
  title: number;
  tags: number;
  metadata: number;
  kindSpecific: number;
};

export type QualityScore = {
  score: number;
  factors: QualityFactors;
};

const WEIGHTS = {
  bodyLength: 0.3,
  bodyStructure: 0.15,
  title: 0.1,
  tags: 0.1,
  metadata: 0.1,
  kindSpecific: 0.25,
} as const;

export function scoreKnowledgeEntry(entry: {
  kind: KnowledgeKind;
  title: string;
  body: string;
  tags: string[];
  metadata: Record<string, unknown>;
}): QualityScore {
  const body = (entry.body ?? "").trim();
  const title = (entry.title ?? "").trim();
  const tags = entry.tags ?? [];
  const metadata = entry.metadata ?? {};

  const bodyLength = scoreBodyLength(body);
  const bodyStructure = scoreBodyStructure(body);
  const titleScore = scoreTitle(title);
  const tagScore = tags.length > 0 ? 1 : 0;
  const metadataScore = Object.keys(metadata).length > 0 ? 1 : 0;
  const kindSpecific = scoreKindSpecific(entry.kind, body, metadata);

  const factors: QualityFactors = {
    bodyLength: bodyLength * WEIGHTS.bodyLength,
    bodyStructure: bodyStructure * WEIGHTS.bodyStructure,
    title: titleScore * WEIGHTS.title,
    tags: tagScore * WEIGHTS.tags,
    metadata: metadataScore * WEIGHTS.metadata,
    kindSpecific: kindSpecific * WEIGHTS.kindSpecific,
  };

  const score = clamp01(
    factors.bodyLength +
      factors.bodyStructure +
      factors.title +
      factors.tags +
      factors.metadata +
      factors.kindSpecific,
  );

  return { score, factors };
}

function scoreBodyLength(body: string): number {
  // Curve: 200 chars = 0.3, 1000 = 0.7, 4000+ = 1.0.
  const n = body.length;
  if (n < 50) return 0;
  if (n < 200) return n / 200 * 0.3;
  if (n < 1000) return 0.3 + ((n - 200) / 800) * 0.4;
  if (n < 4000) return 0.7 + ((n - 1000) / 3000) * 0.3;
  return 1;
}

function scoreBodyStructure(body: string): number {
  // Paragraph breaks + bullets + headings each contribute.
  let s = 0;
  const paragraphs = body.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  if (paragraphs.length >= 2) s += 0.4;
  if (paragraphs.length >= 4) s += 0.2;
  if (/^[\s]*[-*•]\s+/m.test(body)) s += 0.2; // bullets
  if (/^#{1,6}\s+/m.test(body) || /^[A-Z][^.\n]+:?$/m.test(body)) s += 0.2; // headings
  return clamp01(s);
}

function scoreTitle(title: string): number {
  if (title.length < 5) return 0;
  if (title.length < 12) return 0.5;
  if (title.length <= 128) return 1;
  // Over-long titles are also a smell (probably the body pasted into the title field).
  return 0.5;
}

function scoreKindSpecific(
  kind: KnowledgeKind,
  body: string,
  metadata: Record<string, unknown>,
): number {
  switch (kind) {
    case "past_performance": {
      let s = 0;
      // Year reference (any 19xx / 20xx in the body or a `year` key in metadata).
      if (/(19|20)\d{2}/.test(body) || stringField(metadata, "year")) s += 0.4;
      // Award value mentioned.
      if (
        /\$[\d,]+|\b(award|contract|value)\b/i.test(body) ||
        stringField(metadata, "value") ||
        stringField(metadata, "awardValue")
      ) {
        s += 0.3;
      }
      // Customer / agency.
      if (
        stringField(metadata, "agency") ||
        stringField(metadata, "customer") ||
        /\b(agency|customer|client|government|federal)\b/i.test(body)
      ) {
        s += 0.3;
      }
      return clamp01(s);
    }
    case "capability": {
      let s = 0;
      // Capabilities benefit from concrete deliverables / methods / results.
      if (/\b(deliver|provide|implement|design|develop|architecture|method)\w*/i.test(body)) s += 0.4;
      if (/\b(result|outcome|impact|saved|reduced|increased|improved)\w*/i.test(body)) s += 0.3;
      // Bulleted lists of services / qualifications.
      if ((body.match(/^[\s]*[-*•]\s+/gm) ?? []).length >= 3) s += 0.3;
      return clamp01(s);
    }
    case "personnel": {
      let s = 0;
      // Resume-shaped signals: education, certifications, years experience.
      if (/\b(years?\s+(?:of\s+)?experience|since\s+\d{4})\b/i.test(body)) s += 0.3;
      if (/\b(certif|clearance|licens|degree|PhD|MBA|BS|MS)\w*/i.test(body)) s += 0.3;
      // A named person / role in metadata.
      if (stringField(metadata, "name") || stringField(metadata, "role")) s += 0.4;
      return clamp01(s);
    }
    case "boilerplate": {
      // Boilerplate is judged by sheer reusability — long-enough body + structure
      // already cover most of it. The kind-specific signal stays neutral.
      return 0.5;
    }
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return 0;
    }
  }
}

function stringField(
  metadata: Record<string, unknown>,
  key: string,
): boolean {
  const v = metadata[key];
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return Number.isFinite(v);
  return false;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
