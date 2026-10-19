/**
 * BL-STAB-2f — what one server action can be sent. Next refuses a request
 * body over 1 MB (FORGE doesn't raise `serverActions.bodySizeLimit`: files
 * go to storage instead), counted in UTF-16 units of the encoded
 * arguments; Vercel cuts a body off at ~4.5 MB before the function runs.
 * Either way the browser gets an error it can't explain, so text is
 * measured before it is sent. A UTF-8 byte count of the JSON is never
 * below Next's count, so these checks are conservative. Pure; client-safe.
 */
import { utf8ByteLength } from "@/lib/upload-policy";

/** Next's default `serverActions.bodySizeLimit` (1 MB). */
export const ACTION_BODY_LIMIT_BYTES = 1024 * 1024;

/** One text argument's share, leaving room for the others. */
export const TEXT_ACTION_MAX_BYTES = 900_000;

/** Pasted text the GSA, eBuy and Q&A readers take at once. */
export const PASTE_MAX_CHARS = 200_000;

/** What an opportunity created from a pasted email keeps of it (its first activity). */
export const PASTE_KEPT_CHARS = 50_000;

/** A value's size once encoded for a server action, in UTF-8 bytes of its JSON. */
export function encodedBytes(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value) ?? "");
}

/**
 * Null when pasted text can be sent and read; else what to tell the person.
 * `maxChars` is what the server reads (it refuses more); `advice` says how
 * to split it.
 */
export function pasteRefusal(text: string, maxChars: number, advice: string): string | null {
  if (text.length > maxChars) {
    return `This is ${text.length.toLocaleString("en-US")} characters; FORGE reads up to ${maxChars.toLocaleString("en-US")} at a time. ${advice}`;
  }
  if (encodedBytes(text) > TEXT_ACTION_MAX_BYTES) return `This text is too large to send at once. ${advice}`;
  return null;
}

/**
 * Items split into consecutive runs whose encoded size stays within
 * `maxBytes` (an item larger than that travels alone), in order; no
 * empty runs.
 */
export function chunkByBytes<T>(items: readonly T[], maxBytes: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  // The run's own JSON: "[", the items with a comma between each, "]".
  let size = 2;
  for (const item of items) {
    const bytes = encodedBytes(item);
    if (current.length > 0 && size + 1 + bytes > maxBytes) {
      chunks.push(current);
      current = [];
      size = 2;
    }
    size += (current.length > 0 ? 1 : 0) + bytes;
    current.push(item);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
