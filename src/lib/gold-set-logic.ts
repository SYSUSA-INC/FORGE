/**
 * BL-AIX Phase 1e — the rules of the extraction gold set, kept pure so
 * they are unit-tested: what a gold annotation is, how a document's review
 * progress reads, and when a document can be approved as gold.
 *
 * A gold document is a public SAM.gov RFP. Its annotations are what a
 * correct extraction must find:
 *   requirement  — a "shall / must / will" obligation on the offeror;
 *   page_limit   — a page or format limit (value: "25 pages, 12 pt");
 *   eval_factor  — a Section M factor, in order (position 1 = most
 *                  important), with its relative importance in `value`.
 */

export const GOLD_KINDS = ["requirement", "page_limit", "eval_factor"] as const;
export type GoldKind = (typeof GOLD_KINDS)[number];

export const GOLD_ITEM_STATUSES = ["proposed", "approved", "rejected"] as const;
export type GoldItemStatus = (typeof GOLD_ITEM_STATUSES)[number];

export const GOLD_DOC_STATUSES = ["draft", "in_review", "approved"] as const;
export type GoldDocStatus = (typeof GOLD_DOC_STATUSES)[number];

export const GOLD_KIND_LABEL: Record<GoldKind, string> = {
  requirement: "Requirements",
  page_limit: "Page and format limits",
  eval_factor: "Section M evaluation factors",
};

/** Text kept per document; a 300-page RFP is about 1M characters. */
export const GOLD_MAX_TEXT_CHARS = 2_000_000;
/** Attachments downloaded per notice, and the size of each. */
export const GOLD_MAX_FILES = 15;
export const GOLD_MAX_FILE_BYTES = 25 * 1024 * 1024;

export function isGoldKind(v: unknown): v is GoldKind {
  return typeof v === "string" && (GOLD_KINDS as readonly string[]).includes(v);
}

export function isGoldItemStatus(v: unknown): v is GoldItemStatus {
  return typeof v === "string" && (GOLD_ITEM_STATUSES as readonly string[]).includes(v);
}

export type GoldItemInput = { kind: GoldKind; ref: string; text: string; value: string; position: number };

/** Trim and bound an annotation; null with a reason when it is not usable. */
export function cleanGoldItem(input: {
  kind: unknown;
  ref?: unknown;
  text?: unknown;
  value?: unknown;
  position?: unknown;
}): { ok: true; item: GoldItemInput } | { ok: false; error: string } {
  if (!isGoldKind(input.kind)) return { ok: false, error: "Unknown annotation kind." };
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const text = str(input.text, 4000);
  if (text.length < 3) return { ok: false, error: "Write the requirement, limit or factor text." };
  const position = Number.isFinite(Number(input.position)) ? Math.max(0, Math.min(999, Math.trunc(Number(input.position)))) : 0;
  return {
    ok: true,
    item: {
      kind: input.kind,
      ref: str(input.ref, 64),
      text,
      value: str(input.value, 200),
      position: input.kind === "eval_factor" ? position : 0,
    },
  };
}

export type GoldProgressRow = { kind: string; status: string };

export type GoldProgress = {
  total: number;
  proposed: number;
  approved: number;
  rejected: number;
  byKind: Record<GoldKind, { approved: number; proposed: number }>;
};

export function goldProgress(rows: GoldProgressRow[]): GoldProgress {
  const byKind = Object.fromEntries(GOLD_KINDS.map((k) => [k, { approved: 0, proposed: 0 }])) as GoldProgress["byKind"];
  let proposed = 0;
  let approved = 0;
  let rejected = 0;
  for (const r of rows) {
    if (r.status === "approved") approved += 1;
    else if (r.status === "rejected") rejected += 1;
    else proposed += 1;
    if (isGoldKind(r.kind) && r.status !== "rejected") byKind[r.kind][r.status === "approved" ? "approved" : "proposed"] += 1;
  }
  return { total: rows.length, proposed, approved, rejected, byKind };
}

/**
 * A document becomes gold only when every annotation has been decided and
 * at least one requirement is approved. Page limits and evaluation factors
 * may legitimately be absent (an RFI has neither).
 */
export function canApproveGoldDoc(p: GoldProgress): { ok: true } | { ok: false; reason: string } {
  if (p.proposed > 0) return { ok: false, reason: `${p.proposed} annotation${p.proposed === 1 ? " is" : "s are"} still waiting for review.` };
  if (p.byKind.requirement.approved === 0) return { ok: false, reason: "Approve at least one requirement first." };
  return { ok: true };
}

/** Attachments joined into one text, each under a header naming the file, bounded. */
export function joinGoldFiles(files: { name: string; text: string }[]): { text: string; truncated: boolean } {
  const joined = files
    .filter((f) => f.text.trim())
    .map((f) => `===== ${f.name} =====\n${f.text.trim()}`)
    .join("\n\n");
  return joined.length > GOLD_MAX_TEXT_CHARS
    ? { text: joined.slice(0, GOLD_MAX_TEXT_CHARS), truncated: true }
    : { text: joined, truncated: false };
}

export type TextHit = { at: number; snippet: string };

/** Case-insensitive matches of `query` in `text`, each with surrounding context, for checking an annotation against the RFP. */
export function findInText(text: string, query: string, limit = 25, context = 160): TextHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return [];
  const lower = text.toLowerCase();
  const hits: TextHit[] = [];
  for (let at = lower.indexOf(q); at !== -1 && hits.length < limit; at = lower.indexOf(q, at + q.length)) {
    const start = Math.max(0, at - context);
    const end = Math.min(text.length, at + q.length + context);
    hits.push({ at, snippet: `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}` });
  }
  return hits;
}
