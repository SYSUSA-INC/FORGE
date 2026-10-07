/**
 * BL-AIX Phase 1g-2 — pure helpers for the Message Batches path: reading
 * the results file, custom ids, and when a batch has waited too long.
 *
 * A batch runs asynchronously at half the token price; most end within
 * the hour, none later than 24 hours, after which unfinished requests
 * come back `expired`. Results are keyed by custom_id and arrive in any
 * order, so nothing here relies on position.
 */

/** Anthropic's custom_id rule. FORGE uses row uuids, which fit. */
const CUSTOM_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isBatchCustomId(id: string): boolean {
  return CUSTOM_ID.test(id);
}

/** One request's outcome from the results file. `message` is the raw Messages API response. */
export type BatchResultLine =
  | { customId: string; type: "succeeded"; message: unknown }
  | { customId: string; type: "errored"; error: string }
  | { customId: string; type: "canceled" | "expired" };

/** The error text inside an `errored` result, however deeply the provider nests it. */
export function batchErrorText(error: unknown): string {
  let e: unknown = error;
  for (let depth = 0; depth < 3 && e && typeof e === "object"; depth++) {
    const o = e as { message?: unknown; type?: unknown; error?: unknown };
    if (typeof o.message === "string" && o.message) return typeof o.type === "string" && o.type !== "error" ? `${o.type}: ${o.message}` : o.message;
    e = o.error;
  }
  return "The provider reported an error for this request.";
}

/**
 * Parse the JSONL results file. Blank and malformed lines are skipped (a
 * request missing from the results is treated as failed by the caller),
 * and an unknown result type counts as an error.
 */
export function parseBatchResults(jsonl: string): BatchResultLine[] {
  const out: BatchResultLine[] = [];
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: { custom_id?: unknown; result?: { type?: unknown; message?: unknown; error?: unknown } };
    try {
      row = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof row.custom_id !== "string" || !row.result) continue;
    const customId = row.custom_id;
    const type = row.result.type;
    if (type === "succeeded") out.push({ customId, type, message: row.result.message });
    else if (type === "canceled" || type === "expired") out.push({ customId, type });
    else out.push({ customId, type: "errored", error: type === "errored" ? batchErrorText(row.result.error) : `Unknown result type ${String(type)}.` });
  }
  return out;
}

/** What a request that did not succeed tells the log. */
export function batchFailureText(line: BatchResultLine | undefined): string {
  if (!line) return "Missing from the batch results.";
  if (line.type === "errored") return line.error;
  if (line.type === "expired") return "The batch expired before this request ran.";
  if (line.type === "canceled") return "The batch was canceled.";
  return "";
}

/** A batch still unread this long after submission is given up on (the provider expires work at 24 hours). */
export const BATCH_GIVE_UP_MS = 26 * 60 * 60_000;

export function batchGivenUp(submittedAt: Date, now: Date): boolean {
  return now.getTime() - submittedAt.getTime() > BATCH_GIVE_UP_MS;
}

/** Nightly work goes through batches unless switched off; only Anthropic serves them. */
export function batchingEnabled(env: Record<string, string | undefined>, provider: string): boolean {
  return provider === "anthropic" && (env.AI_BATCH_NIGHTLY ?? "").trim().toLowerCase() !== "off";
}
